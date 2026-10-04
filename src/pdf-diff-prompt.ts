import * as path from 'node:path';
import * as vscode from 'vscode';
import { trace } from './trace';

/** The setting that switches the prompt off; "Don't ask again" sets it. */
export const PROMPT_SETTING = 'promptPdfDiff';

const OPEN = 'Open in Lpdf';
const NOT_NOW = 'Not now';
const NEVER = 'Don\'t ask again';

/**
 * The PDF a tab is a text diff of, when it is a change against git: the file on disk compared
 * with a version git holds. That is what a click on a changed PDF in Source Control opens, and for
 * a PDF it shows the file's raw source.
 * @param input A tab's input.
 * @returns The file on disk, or undefined for any other tab. A staged change (git on both sides)
 *          is not one: the visual diff compares HEAD with the file on disk.
 */
export function pdfDiffTarget(input: unknown): vscode.Uri | undefined {
  if (!(input instanceof vscode.TabInputTextDiff)) { return undefined; }
  const { original, modified } = input;
  const isPdf = path.extname(modified.fsPath).toLowerCase() === '.pdf';
  return isPdf && modified.scheme === 'file' && original.scheme === 'git' ? modified : undefined;
}

/**
 * Offers the Lpdf visual diff when a changed PDF opens as a text diff, each time it opens, and not
 * at all once the user chose "Don't ask again" (the `lpdf.promptPdfDiff` setting). A file is not
 * asked about again only while its message is still up. If the user accepts, the text diff closes
 * and the visual diff opens in its place.
 */
export function registerPdfDiffPrompt(context: vscode.ExtensionContext): void {
  const showing = new Set<string>();
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(event => {
      // A preview tab that moves to another file's diff is reported as changed, not opened.
      for (const tab of [...event.opened, ...event.changed]) {
        const file = pdfDiffTarget(tab.input);
        if (!file || showing.has(file.toString())) { continue; }
        if (!vscode.workspace.getConfiguration('lpdf').get<boolean>(PROMPT_SETTING, true)) { return; }
        showing.add(file.toString());
        trace(`pdf diff prompt: ${file.fsPath}`);
        void offerVisualDiff(tab, file).finally(() => showing.delete(file.toString()));
      }
    }),
  );
}

async function offerVisualDiff(tab: vscode.Tab, file: vscode.Uri): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Comparing changes to ${path.basename(file.fsPath)}? Lpdf can show the two versions side by side, with synced scrolling and a table of what differs in their properties.`,
    OPEN,
    NOT_NOW,
    NEVER,
  );
  if (choice === OPEN) {
    // The text diff may have been closed while the message was up; closing it again is then a no-op.
    await vscode.window.tabGroups.close(tab);
    await vscode.commands.executeCommand('lpdf.diffPdf', file);
  } else if (choice === NEVER) {
    await vscode.workspace.getConfiguration('lpdf').update(PROMPT_SETTING, false, vscode.ConfigurationTarget.Global);
  }
}
