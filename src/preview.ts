import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { renderPdf, LpdfRenderError, cancelRender } from './engine';
import { getLinkedDataJson } from './data';
import { resolveLpdfDocument } from './utils';

/** Log only when `lpdf.trace` is enabled. Errors are always written via console.error. */
function trace(...args: unknown[]): void {
  if (vscode.workspace.getConfiguration('lpdf').get<boolean>('trace', false)) {
    console.log(...args);
  }
}

/**
 * Build the webview HTML for the Lpdf pdf.js viewer, substituting all resource URIs and CSP values.
 * Shared between the XML-preview panel and the direct PDF viewer.
 */
export function buildWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');
  const pdfJsUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'pdf.min.mjs'));
  const workerUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'pdf.worker.min.mjs'));
  const cspSource = webview.cspSource;
  const nonce     = randomBytes(16).toString('hex');
  const htmlPath  = path.join(context.extensionPath, 'media', 'preview.html');
  return fs.readFileSync(htmlPath, 'utf8')
    .replace(/__CSP_SOURCE__/g, cspSource)
    .replace(/__NONCE__/g, nonce)
    .replace('__PDF_JS_URI__', pdfJsUri.toString())
    .replace('__WORKER_URI__', workerUri.toString());
}

let previewPanel: vscode.WebviewPanel | undefined;
let previewUri: vscode.Uri | undefined;
let renderGeneration = 0;
// Per-URI cache of last successfully rendered XML content.
// Keyed by URI string so switching between files doesn't pollute the stale-check.
const _lastRendered = new Map<string, string>();
// Ready-handshake state: the webview signals 'ready' once its message listener is registered.
// Any message sent before that point is queued and flushed on 'ready'.
let _webviewReady = false;
let _pendingMessage: Record<string, unknown> | undefined;

/** Send a message to the webview. Queues it if the webview hasn't signalled ready yet. */
function postToWebview(msg: Record<string, unknown>): void {
  if (!previewPanel) { return; }
  if (_webviewReady) {
    previewPanel.webview.postMessage(msg).then(
      () => { trace(`[lpdf] → webview: ${msg.type}`); },
      (err: unknown) => {
        console.error('[lpdf] postMessage failed:', err);
        vscode.window.showErrorMessage('Lpdf: Failed to communicate with the preview panel. Try reopening it.');
      },
    );
  } else {
    // Content messages (updatePdf, showError) are never superseded by showLoading.
    // showLoading may be replaced by any newer message.
    const isContent = (t: unknown): boolean => t === 'updatePdf' || t === 'showError';
    if (!isContent(_pendingMessage?.type) || isContent(msg.type)) {
      trace(`[lpdf] webview not ready — queuing: ${msg.type} (replaces: ${_pendingMessage?.type ?? 'none'})`);
      _pendingMessage = msg;
    }
  }
}

/**
 * Open or reveal the preview panel, then render the given URI.
 * Called by the "Preview PDF" command and the CodeLens button.
 * uri is passed when invoked from the Explorer context menu; falls back to the active editor.
 */
export async function previewPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
  const doc = await resolveLpdfDocument(uri);
  if (!doc) { return; }

  ensurePanel(context);
  await doRender(context, doc.uri);
}

/**
 * Re-render the panel for a URI if the panel is already open.
 * reason 'switch': only re-renders if the URI differs from what is currently shown.
 * reason 'save':   only re-renders if the document content changed since the last render.
 * reason 'data':   always re-renders (linked JSON file changed or was linked/unlinked).
 */
export async function renderForUri(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  reason: 'switch' | 'save' | 'data',
): Promise<void> {
  if (!previewPanel) { return; }

  if (reason === 'switch' && previewUri?.toString() === uri.toString()) {
    return; // same file already showing — nothing to do
  }

  if (reason === 'save') {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (doc && doc.getText() === _lastRendered.get(uri.toString())) {
      return; // content unchanged since last render
    }
  }

  await doRender(context, uri);
}

function ensurePanel(context: vscode.ExtensionContext): void {
  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');
  previewPanel = vscode.window.createWebviewPanel(
    'lpdfPreview',
    'Lpdf Preview',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaUri],
    },
  );

  previewPanel.webview.html = buildWebviewHtml(context, previewPanel.webview);

  previewPanel.onDidDispose(() => {
    trace('[lpdf] preview panel disposed');
    cancelRender();
    previewPanel = undefined;
    previewUri = undefined;
    _lastRendered.clear();
    _webviewReady = false;
    _pendingMessage = undefined;
  });
  previewPanel.webview.onDidReceiveMessage(async (msg: { type: string; level?: string; message?: string; pdfBase64?: string }) => {
    // Relay console messages from the webview to the extension host debug console.
    if (msg.type === 'log') {
      if (msg.level === 'error') { console.error('[lpdf webview]', msg.message); }
      else { trace('[lpdf webview]', msg.message); }
      return;
    }
    // Webview signals that its message listener is fully registered.
    if (msg.type === 'ready') {
      trace('[lpdf] webview ready — flushing pending:', _pendingMessage?.type ?? 'none');
      _webviewReady = true;
      if (_pendingMessage && previewPanel) {
        const pending = _pendingMessage;
        _pendingMessage = undefined;
        previewPanel.webview.postMessage(pending).then(
          () => { trace(`[lpdf] → webview (flushed): ${pending.type}`); },
          (err: unknown) => { console.error('[lpdf] flush postMessage failed:', err); },
        );
      }
      return;
    }
    if (msg.type !== 'download' || !previewUri || !msg.pdfBase64) { return; }
    const xmlDir = path.dirname(previewUri.fsPath);
    const defaultName = path.basename(previewUri.fsPath, '.xml').replace(/\.lpdf$/, '') + '.pdf';
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(xmlDir, defaultName)),
      filters: { 'PDF': ['pdf'] },
    });
    if (!saveUri) { return; }
    await vscode.workspace.fs.writeFile(saveUri, Buffer.from(msg.pdfBase64, 'base64'));
    vscode.window.showInformationMessage(`Lpdf: Saved ${path.basename(saveUri.fsPath)}`);
  }, undefined, context.subscriptions);
}

async function doRender(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  if (!previewPanel) { return; }

  const isNewFile = previewUri?.toString() !== uri.toString();
  previewUri = uri;
  const generation = ++renderGeneration;
  const file = path.basename(uri.fsPath);

  trace(`[lpdf] doRender start  gen=${generation} file=${file} isNewFile=${isNewFile} webviewReady=${_webviewReady}`);

  const doc = await vscode.workspace.openTextDocument(uri);
  if (generation !== renderGeneration || !previewPanel) {
    trace(`[lpdf] doRender stale after openTextDocument gen=${generation}`);
    return;
  }

  const xml   = doc.getText();
  const title = path.basename(uri.fsPath, '.xml').replace(/\.lpdf$/, '') + ' — Preview';

  previewPanel.title = title;
  // Show loading overlay. If the webview isn't ready yet this gets queued and
  // will be superseded by updatePdf/showError when that arrives.
  postToWebview({ type: 'showLoading' });

  const licenseKey = vscode.workspace.getConfiguration('lpdf').get<string>('licenseKey', '');
  const jsonData = getLinkedDataJson(context, uri);

  try {
    trace(`[lpdf] doRender WASM start gen=${generation}`);
    const bytes = await renderPdf(xml, licenseKey, jsonData);
    trace(`[lpdf] doRender WASM done  gen=${generation} bytes=${bytes.byteLength}`);
    if (generation !== renderGeneration || !previewPanel) {
      trace(`[lpdf] doRender stale after WASM gen=${generation} current=${renderGeneration}`);
      return;
    }
    _lastRendered.set(uri.toString(), xml);
    const pdfBase64 = Buffer.from(bytes).toString('base64');
    const filename  = path.basename(uri.fsPath, '.xml').replace(/\.lpdf$/, '') + '.pdf';
    // Only pass zoom/scroll for new files; re-renders of the same file preserve the webview's state.
    const msg: Record<string, unknown> = { type: 'updatePdf', pdfBase64, filename, watermarked: !licenseKey };
    if (isNewFile) { msg.zoom = 'fit'; msg.scrollX = 0; msg.scrollY = 0; }
    postToWebview(msg);
  } catch (e) {
    if (generation !== renderGeneration || !previewPanel) {
      trace(`[lpdf] doRender stale after error gen=${generation}`);
      return;
    }
    const message = e instanceof LpdfRenderError ? e.message : String(e);
    console.error(`[lpdf] doRender error gen=${generation}:`, message);
    postToWebview({ type: 'showError', message });
    vscode.window.showErrorMessage(`Lpdf: ${message}`);
  }
}
