import * as vscode from 'vscode';

/**
 * Resolve the target XML document from an explicit URI or the active editor, open it,
 * and validate that it is an XML file.
 *
 * Returns the opened TextDocument, or undefined (with an error notification already shown)
 * if no valid XML document could be resolved.
 */
export async function resolveLpdfDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) { return undefined; }
  const doc = await vscode.workspace.openTextDocument(targetUri);
  if (doc.languageId !== 'xml') {
    vscode.window.showErrorMessage('LPDF: Active file is not an XML document.');
    return undefined;
  }
  return doc;
}
