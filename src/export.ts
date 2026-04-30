import * as vscode from 'vscode';
import * as path from 'node:path';
import { renderPdf, LpdfRenderError } from './engine';
import { resolveLpdfDocument } from './utils';

export async function exportPdf(uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  const xmlDir     = path.dirname(doc.uri.fsPath);
  const defaultName = path.basename(doc.uri.fsPath, '.xml').replace(/\.lpdf$/, '') + '.pdf';
  const defaultUri  = vscode.Uri.file(path.join(xmlDir, defaultName));

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'PDF': ['pdf'] },
  });
  if (!saveUri) { return; }

  const xml = doc.getText();
  try {
    const bytes = await renderPdf(xml);
    await vscode.workspace.fs.writeFile(saveUri, bytes);
    vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}`);
  } catch (e) {
    const msg = e instanceof LpdfRenderError ? e.message : String(e);
    vscode.window.showErrorMessage(`Lpdf: ${msg}`);
  }
}
