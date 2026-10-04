import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sidecarDataPath } from './data';
import { DocumentTemplate, loadTemplates } from './templates';

/** The folder of starters inside the extension; see templates.ts for what goes in it. */
const TEMPLATES_FOLDER = 'templates';

interface TemplateItem extends vscode.QuickPickItem {
  template: DocumentTemplate;
}

/**
 * Registers **Lpdf: New Document...**, which the command palette, File > New File... and a
 * folder's context menu in the Explorer offer.
 */
export function registerNewDocumentCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lpdf.newDocument', (target?: vscode.Uri) => newDocument(context.extensionPath, target)),
  );
}

/**
 * Starts a document from a template: the user picks a template and where to save it; the XML, and
 * the template's data next to it, are written there; the XML opens with its preview beside it.
 * @param extensionPath The extension's folder, which holds the templates.
 * @param target The folder the Explorer's context menu was opened on, if it was; the file's folder for a file.
 * @returns The new document, or undefined when nothing was created.
 */
export async function newDocument(extensionPath: string, target?: vscode.Uri): Promise<vscode.Uri | undefined> {
  let templates: DocumentTemplate[];
  try {
    templates = loadTemplates(path.join(extensionPath, TEMPLATES_FOLDER));
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: ${(error as Error).message}`);
    return undefined;
  }
  const items: TemplateItem[] = templates.map(template => ({ label: template.label, detail: template.description, template }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Lpdf: New Document', placeHolder: 'Choose a template' });
  if (!picked) { return undefined; }
  const { template } = picked;

  const folder = await startFolder(target);
  const xmlUri = await vscode.window.showSaveDialog({
    title: 'Save the new Lpdf document',
    defaultUri: folder
      ? vscode.Uri.joinPath(folder, `${template.fileName}.xml`)
      : vscode.Uri.file(path.join(os.homedir(), `${template.fileName}.xml`)),
    filters: { 'Lpdf XML': ['xml'] },
  });
  if (!xmlUri) { return undefined; }

  // The save dialog has asked about replacing the XML; the data next to it is asked about here.
  const dataUri = template.dataPath
    ? vscode.Uri.joinPath(xmlUri, '..', path.basename(sidecarDataPath(xmlUri.fsPath)))
    : undefined;
  if (dataUri && await exists(dataUri)) {
    const replace = 'Replace';
    const answer = await vscode.window.showWarningMessage(
      `${path.basename(dataUri.fsPath)} is already there. Replace it with the template's data?`,
      { modal: true, detail: 'The new document reads its data from the .json file with the same name.' },
      replace,
    );
    if (answer !== replace) { return undefined; }
  }

  try {
    await vscode.workspace.fs.writeFile(xmlUri, fs.readFileSync(template.xmlPath));
    if (dataUri && template.dataPath) { await vscode.workspace.fs.writeFile(dataUri, fs.readFileSync(template.dataPath)); }
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: could not create ${path.basename(xmlUri.fsPath)}: ${(error as Error).message}`);
    return undefined;
  }

  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(xmlUri));
  await vscode.commands.executeCommand('lpdf.previewPdf', xmlUri);
  return xmlUri;
}

/** The folder the save dialog starts in: the one the Explorer menu was opened on, else the first workspace folder. */
async function startFolder(target?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (target) {
    try {
      const stat = await vscode.workspace.fs.stat(target);
      return stat.type & vscode.FileType.Directory ? target : vscode.Uri.joinPath(target, '..');
    } catch { /* gone since the menu opened; fall back below */ }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
