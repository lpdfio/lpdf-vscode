import * as vscode from 'vscode';
import * as path from 'node:path';
import { isLpdfDocument } from './schema';

/**
 * The name a document's PDF and preview take from its XML file: the file name without `.xml`
 * and without a trailing `.lpdf`, so `invoice.lpdf.xml` gives `invoice`. A file called just
 * `.lpdf.xml` keeps its `.lpdf` rather than ending up nameless.
 */
export function documentStem(fsPath: string): string {
  return path.basename(fsPath, '.xml').replace(/(?<=.)\.lpdf$/i, '');
}

/**
 * Resolve the target XML document from an explicit URI or the active editor, open it,
 * and validate that it is an XML file whose root element is `<lpdf>`.
 *
 * Returns the opened TextDocument, or undefined (with an error notification already shown)
 * if no Lpdf document could be resolved.
 */
export async function resolveLpdfDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) { return undefined; }
  const doc = await vscode.workspace.openTextDocument(targetUri);
  if (doc.languageId !== 'xml') {
    vscode.window.showErrorMessage('Lpdf: Active file is not an XML document.');
    return undefined;
  }
  // The Explorer menu offers Lpdf commands on every .xml file, since it can't see inside them.
  if (!isLpdfDocument(doc)) {
    vscode.window.showErrorMessage(`Lpdf: ${path.basename(doc.uri.fsPath)} is not an Lpdf document. Its root element must be <lpdf>.`);
    return undefined;
  }
  return doc;
}
