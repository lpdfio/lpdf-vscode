import * as vscode from 'vscode';
import * as path from 'node:path';
import { renderPdf, LpdfRenderError } from './engine';
import { loadRenderInput } from './render-input';
import { cipherName, requestedCipher } from './encryption';
import { askForPasswords } from './encryption-prompt';
import { documentStem, resolveLpdfDocument } from './utils';

/**
 * Exports the document as a PDF. A document that asks for encryption in its `<output>` is encrypted as it asks,
 * with the passwords asked for first (see `askForPasswords`); one that doesn't is saved as it renders. Nothing is
 * written if the user cancels at any step.
 */
export async function exportPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  try {
    const { xml, jsonData, assets, warnings } = await loadRenderInput(context, doc.uri, doc.getText());
    const cipher = requestedCipher(xml);
    const passwords = cipher === undefined ? undefined : await askForPasswords(cipher);
    if (cipher !== undefined && passwords === undefined) { return; }

    const saveUri = await askWhereToSave(doc);
    if (!saveUri) { return; }

    const bytes = await renderPdf(xml, jsonData, assets, { passwords });
    await vscode.workspace.fs.writeFile(saveUri, bytes);
    const what = cipher === undefined ? '' : ` (encrypted with ${cipherName(cipher)}, as its <output> asks; Lpdf cannot recover the passwords)`;
    vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}${what}`);
    if (warnings.length > 0) {
      vscode.window.showWarningMessage(`Lpdf: ${warnings.join(' ')}`);
    }
  } catch (e) {
    const msg = e instanceof LpdfRenderError ? e.message : String(e);
    vscode.window.showErrorMessage(`Lpdf: ${msg}`);
  }
}

/** The save dialog, in the document's folder with the document's name. */
function askWhereToSave(doc: vscode.TextDocument): Thenable<vscode.Uri | undefined> {
  const xmlDir = path.dirname(doc.uri.fsPath);
  const defaultUri = vscode.Uri.file(path.join(xmlDir, documentStem(doc.uri.fsPath) + '.pdf'));
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'PDF': ['pdf'] },
  });
}
