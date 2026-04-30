import * as vscode from 'vscode';
import * as path from 'node:path';
import { buildWebviewHtml } from './preview';

/**
 * Custom readonly editor provider for `.pdf` files.
 * Registered with priority "default" so clicking a PDF in the Explorer opens it here.
 * Users can override via workbench.editorAssociations if they prefer a different viewer.
 */
export class LpdfPdfViewerProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  static readonly viewType = 'lpdf.pdfViewer';

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    // Only handle real file URIs. A non-file scheme (e.g. git:) means VS Code
    // opened this as the base side of a diff view — close that pane immediately.
    if (document.uri.scheme !== 'file') {
      panel.dispose();
      return;
    }

    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };
    panel.webview.html = buildWebviewHtml(this.context, panel.webview);

    const bytes = await vscode.workspace.fs.readFile(document.uri);
    const pdfBase64 = Buffer.from(bytes).toString('base64');
    const filename  = path.basename(document.uri.fsPath);

    panel.webview.onDidReceiveMessage((msg: { type: string; level?: string; message?: string; pdfBase64?: string }) => {
      if (msg.type === 'log') {
        if (msg.level === 'error') { console.error('[lpdf pdfViewer]', msg.message); }
        return;
      }
      if (msg.type === 'ready') {
        void panel.webview.postMessage({ type: 'updatePdf', pdfBase64, filename, zoom: 'fit', scrollX: 0, scrollY: 0 });
        return;
      }
      if (msg.type === 'download' && msg.pdfBase64) {
        void handleDownload(document.uri, msg.pdfBase64);
      }
    });
  }
}

async function handleDownload(sourceUri: vscode.Uri, pdfBase64: string): Promise<void> {
  const dir = path.dirname(sourceUri.fsPath);
  const defaultName = path.basename(sourceUri.fsPath);
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(dir, defaultName)),
    filters: { 'PDF': ['pdf'] },
  });
  if (!saveUri) { return; }
  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(pdfBase64, 'base64'));
  vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}`);
}
