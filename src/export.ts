import * as vscode from 'vscode';
import * as path from 'node:path';
import { renderPdf, LpdfRenderError } from './engine';
import { loadAssets } from './assets';
import { getLinkedDataJson } from './data';
import { resolveLpdfDocument } from './utils';

export async function exportPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  const xmlDir     = path.dirname(doc.uri.fsPath);
  const defaultName = path.basename(doc.uri.fsPath, '.xml') + '.pdf';
  const defaultUri  = vscode.Uri.file(path.join(xmlDir, defaultName));

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'PDF': ['pdf'] },
  });
  if (!saveUri) { return; }

  const xml      = doc.getText();
  const jsonData = getLinkedDataJson(context, doc.uri);
  try {
    const { assets, warnings } = await loadAssets(xml, doc.uri);
    const bytes = await renderPdf(xml, jsonData, assets);
    await vscode.workspace.fs.writeFile(saveUri, bytes);
    vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}`);
    if (warnings.length > 0) {
      vscode.window.showWarningMessage(`Lpdf: ${warnings.join(' ')}`);
    }
  } catch (e) {
    const msg = e instanceof LpdfRenderError ? e.message : String(e);
    vscode.window.showErrorMessage(`Lpdf: ${msg}`);
  }
}
