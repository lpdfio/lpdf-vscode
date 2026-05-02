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
    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };
    panel.webview.html = buildWebviewHtml(this.context, panel.webview);

    // Track disposal — the panel can be disposed while we await async work below.
    let disposed = false;
    panel.onDidDispose(() => { disposed = true; });

    const fileBasename = path.basename(document.uri.fsPath || document.uri.path);
    const t0 = Date.now();
    console.log(`[lpdf perf] pdfViewer readFile START file=${fileBasename}`);
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    console.log(`[lpdf perf] pdfViewer readFile DONE  +${Date.now() - t0}ms bytes=${bytes.byteLength}`);
    const tB64 = Date.now();
    const pdfBase64 = Buffer.from(bytes).toString('base64');
    console.log(`[lpdf perf] pdfViewer base64 encode DONE +${Date.now() - t0}ms base64Len=${pdfBase64.length} encodeMs=${Date.now() - tB64}`);

    if (disposed) { return; }

    panel.webview.onDidReceiveMessage((msg: { type: string; level?: string; message?: string; pdfBase64?: string }) => {
      if (msg.type === 'log') {
        if (msg.level === 'error') { console.error('[lpdf pdfViewer]', msg.message); }
        else { console.log('[lpdf pdfViewer]', msg.message); }
        return;
      }
      if (msg.type === 'ready') {
        const tPost = Date.now();
        console.log(`[lpdf perf] pdfViewer postMessage START +${tPost - t0}ms (after ready)`);
        void panel.webview.postMessage({ type: 'updatePdf', pdfBase64, filename: fileBasename, zoom: 'fit', scrollX: 0, scrollY: 0 }).then(() => {
          console.log(`[lpdf perf] pdfViewer postMessage delivered +${Date.now() - t0}ms postMs=${Date.now() - tPost}`);
        });
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
