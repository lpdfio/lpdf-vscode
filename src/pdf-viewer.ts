import * as vscode from 'vscode';
import * as path from 'node:path';
import { buildWebviewHtml } from './preview';
import { trace } from './trace';

/**
 * Custom readonly editor provider for `.pdf` files.
 * Registered with priority "option", so a PDF opens here through "Lpdf: View PDF" or
 * "Open With", or by default once `lpdf.defaultPdfViewer` associates `*.pdf` with it.
 */
export class LpdfPdfViewerProvider implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument> {
  static readonly viewType = 'lpdf.pdfViewer';

  /**
   * @param context The extension context.
   * @param onDidOpenPdf Called each time a PDF opens in this viewer. The extension uses it
   *   to offer making the viewer the default, at the moment the user is looking at it.
   */
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDidOpenPdf: () => void = () => {},
  ) {}

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    this.onDidOpenPdf();
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

    // The page can report that it is ready as soon as its HTML is set, which for a large PDF is
    // before the file has been read. The read starts here and the listener goes in before anything
    // waits for it, so that message is never missed: the page is sent the PDF once it is both ready and read.
    const pdfBase64 = readPdfBase64(document.uri, fileBasename, t0);

    panel.webview.onDidReceiveMessage((msg: { type: string; level?: string; message?: string; pdfBase64?: string }) => {
      if (msg.type === 'log') {
        if (msg.level === 'error') { console.error('[lpdf pdfViewer]', msg.message); }
        else { trace(`pdfViewer webview: ${msg.message}`); }
        return;
      }
      if (msg.type === 'ready') {
        void pdfBase64.then(
          base64 => {
            if (disposed) { return; }
            const tPost = Date.now();
            trace(`pdfViewer post +${tPost - t0}ms (after ready)`);
            return panel.webview.postMessage({ type: 'updatePdf', pdfBase64: base64, filename: fileBasename, zoom: 'fit' }).then(() => {
              trace(`pdfViewer delivered +${Date.now() - t0}ms postMs=${Date.now() - tPost}`);
            });
          },
          (error: unknown) => {
            if (disposed) { return; }
            void panel.webview.postMessage({ type: 'showError', message: `Could not read ${fileBasename}: ${error instanceof Error ? error.message : String(error)}` });
          },
        );
        return;
      }
      if (msg.type === 'download' && msg.pdfBase64) {
        void handleDownload(document.uri, msg.pdfBase64);
      }
    });

    // A file that cannot be read is also reported to VS Code, which says so where the editor was to open.
    await pdfBase64;
  }
}

/** Reads a PDF as base64, which is how the page receives it. */
async function readPdfBase64(uri: vscode.Uri, fileBasename: string, t0: number): Promise<string> {
  trace(`pdfViewer read start file=${fileBasename}`);
  const bytes = await vscode.workspace.fs.readFile(uri);
  trace(`pdfViewer read done +${Date.now() - t0}ms bytes=${bytes.byteLength}`);
  const tB64 = Date.now();
  const pdfBase64 = Buffer.from(bytes).toString('base64');
  trace(`pdfViewer base64 +${Date.now() - t0}ms base64Len=${pdfBase64.length} encodeMs=${Date.now() - tB64}`);
  return pdfBase64;
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
