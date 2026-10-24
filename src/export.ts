import * as vscode from 'vscode';
import * as path from 'node:path';
import { renderPdf, LpdfRenderError } from './engine';
import { loadAssets } from './assets';
import { getLinkedDataJson } from './data';
import { ALGORITHM_SETTING, algorithmFromSetting, describeEncryption, type EncryptionRequest } from './encryption';
import { askForEncryption } from './encryption-prompt';
import { documentStem, resolveLpdfDocument } from './utils';

export async function exportPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  const saveUri = await askWhereToSave(doc, '.pdf');
  if (!saveUri) { return; }
  await renderAndSave(context, doc, saveUri);
}

/**
 * Exports the document as a PDF protected with passwords and permissions. It asks for them first (see
 * `askForEncryption`), then where to save, and writes nothing if the user cancels at any step.
 */
export async function exportEncryptedPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  const algorithm = algorithmFromSetting(vscode.workspace.getConfiguration('lpdf').get<string>(ALGORITHM_SETTING));
  const encryption = await askForEncryption(algorithm);
  if (!encryption) { return; }

  const saveUri = await askWhereToSave(doc, '-encrypted.pdf');
  if (!saveUri) { return; }
  await renderAndSave(context, doc, saveUri, encryption);
}

/** The save dialog, in the document's folder with the document's name and the given ending. */
function askWhereToSave(doc: vscode.TextDocument, ending: string): Thenable<vscode.Uri | undefined> {
  const xmlDir = path.dirname(doc.uri.fsPath);
  const defaultUri = vscode.Uri.file(path.join(xmlDir, documentStem(doc.uri.fsPath) + ending));
  return vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'PDF': ['pdf'] },
  });
}

async function renderAndSave(
  context: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  saveUri: vscode.Uri,
  encryption?: EncryptionRequest,
): Promise<void> {
  const xml      = doc.getText();
  const jsonData = getLinkedDataJson(context, doc.uri);
  try {
    const { assets, warnings } = await loadAssets(xml, doc.uri);
    const bytes = await renderPdf(xml, jsonData, assets, encryption);
    await vscode.workspace.fs.writeFile(saveUri, bytes);
    const what = encryption ? ` (${describeEncryption(encryption)}; Lpdf cannot recover the passwords)` : '';
    vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}${what}`);
    if (warnings.length > 0) {
      vscode.window.showWarningMessage(`Lpdf: ${warnings.join(' ')}`);
    }
  } catch (e) {
    const msg = e instanceof LpdfRenderError ? e.message : String(e);
    vscode.window.showErrorMessage(`Lpdf: ${msg}`);
  }
}
