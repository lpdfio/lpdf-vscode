import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { renderPdf, LpdfRenderError, cancelRender } from './engine';
import { loadRenderInput } from './render-input';
import { isMarkdownUri } from './markdown';
import { ScrollSync } from './scroll-sync';
import { documentStem, resolveLpdfDocument } from './utils';
import { trace } from './trace';
import { buildViewerHtml } from './viewer-html';

/**
 * Build the webview HTML for the Lpdf PDF viewer, the PDF.js viewer in `media/viewer/`, substituting
 * all resource URIs and CSP values. Shared between the XML-preview panel and the direct PDF viewer.
 */
export function buildWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
  const viewerDir = vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer');
  return buildViewerHtml({
    viewerHtml: fs.readFileSync(path.join(viewerDir.fsPath, 'web', 'viewer.html'), 'utf8'),
    viewerRoot: webview.asWebviewUri(viewerDir).toString(),
    cspSource: webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
  });
}

let previewPanel: vscode.WebviewPanel | undefined;
let previewUri: vscode.Uri | undefined;
let renderGeneration = 0;
// Per-URI cache of last successfully rendered XML content.
// Keyed by URI string so switching between files doesn't pollute the stale-check.
const _lastRendered = new Map<string, string>();
// Per-URI asset warnings last shown, so re-rendering on every save doesn't repeat them.
const _lastWarnings = new Map<string, string>();
// Ready-handshake state: the webview signals 'ready' once its message listener is registered.
// Any message sent before that point is queued and flushed on 'ready'.
let _webviewReady = false;
let _pendingMessage: Record<string, unknown> | undefined;
let _panelCreatedAt = 0;
// Watchers on the files the document being shown was made from: its template, its files of rules, its
// images and fonts. An edit of any of them renders the preview again.
let _dependencyWatchers: vscode.FileSystemWatcher[] = [];

function disposeDependencyWatchers(): void {
  for (const watcher of _dependencyWatchers) { watcher.dispose(); }
  _dependencyWatchers = [];
}

/** Watches `files`, in place of the files watched before, and renders `uri` again when one of them changes. */
function watchDependencies(context: vscode.ExtensionContext, uri: vscode.Uri, files: readonly string[]): void {
  disposeDependencyWatchers();
  for (const file of new Set(files)) {
    const watcher = vscode.workspace.createFileSystemWatcher(file);
    // Only while this document is the one the preview shows: the panel may have moved on to another.
    const again = (): void => { if (previewUri?.toString() === uri.toString()) { void renderForUri(context, uri, 'data'); } };
    watcher.onDidChange(again);
    watcher.onDidCreate(again);
    watcher.onDidDelete(again);
    _dependencyWatchers.push(watcher);
  }
}

// Keeps the editor and the preview of a .md file at the same place; see scroll-sync.ts.
const _scrollSync = new ScrollSync({
  scrollPreviewTo: position => {
    postToWebview({ type: 'scrollToPosition', position });
  },
  revealLine: line => {
    const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document.uri.toString() === previewUri?.toString());
    if (!editor) { return; }
    const start = new vscode.Position(line, 0);
    editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.AtTop);
  },
});

/**
 * The editor of the file the preview shows has scrolled: the preview follows to the place of the line at its
 * top. A cursor that moves out of view scrolls the editor, so it is followed too. Only a .md file is followed,
 * and only once its preview has an outline, and not while the preview is behind another tab, where the page
 * has no layout to scroll.
 * @param editor The editor that scrolled.
 * @param line The line at its top, counting from 0.
 */
export function followEditor(editor: vscode.TextEditor, line: number): void {
  if (!previewPanel?.visible || editor.document.uri.toString() !== previewUri?.toString()) { return; }
  _scrollSync.editorMoved(editor.document, line);
}

/** Send a message to the webview. Queues it if the webview hasn't signalled ready yet. */
function postToWebview(msg: Record<string, unknown>): void {
  if (!previewPanel) { return; }
  if (_webviewReady) {
    previewPanel.webview.postMessage(msg).then(
      () => { trace(`→ webview: ${msg.type}`); },
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
      trace(`webview not ready, queuing: ${msg.type} (replaces: ${_pendingMessage?.type ?? 'none'})`);
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

// Moving a tab to another editor group closes it and opens it again, so a closed tab is only
// acted on after this delay, once a reopened tab, if any, has appeared.
const PREVIEW_CLOSE_DELAY_MS = 250;
let _closePreviewTimer: ReturnType<typeof setTimeout> | undefined;

function isTextTabFor(tab: vscode.Tab, uri: string): boolean {
  return tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri;
}

/**
 * Closes the preview when the XML file it shows is closed, so the panel isn't left showing a
 * document that is no longer open. Only a closed tab counts: a preview started from the
 * Explorer for a file with no tab must survive unrelated tab changes.
 * @param closed The tabs a tab-change event reports as closed.
 */
export function closePreviewWhenSourceCloses(closed: readonly vscode.Tab[]): void {
  if (!previewPanel || !previewUri) { return; }
  const shown = previewUri.toString();
  if (!closed.some(tab => isTextTabFor(tab, shown))) { return; }

  clearTimeout(_closePreviewTimer);
  _closePreviewTimer = setTimeout(() => {
    const stillOpen = vscode.window.tabGroups.all.some(group => group.tabs.some(tab => isTextTabFor(tab, shown)));
    // The panel may have moved on to another file in the meantime; only close it for this one.
    if (!stillOpen && previewUri?.toString() === shown) { previewPanel?.dispose(); }
  }, PREVIEW_CLOSE_DELAY_MS);
}

/** What the preview's webview posts. */
interface WebviewMessage {
  type: string;
  level?: string;
  message?: string;
  pdfBase64?: string;
  titles?: string[];
  at?: number;
}

function ensurePanel(context: vscode.ExtensionContext): void {
  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const mediaUri = vscode.Uri.joinPath(context.extensionUri, 'media');
  _panelCreatedAt = Date.now();
  trace('panel created, waiting for the webview');
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
    trace('preview panel disposed');
    cancelRender();
    previewPanel = undefined;
    previewUri = undefined;
    disposeDependencyWatchers();
    _lastRendered.clear();
    _lastWarnings.clear();
    _webviewReady = false;
    _pendingMessage = undefined;
    _scrollSync.reset();
  });
  previewPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    // Relay console messages from the webview: errors to the extension host console, the rest to the trace.
    if (msg.type === 'log') {
      if (msg.level === 'error') { console.error('[lpdf webview]', msg.message); }
      else { trace(`webview: ${msg.message}`); }
      return;
    }
    // Webview signals that its message listener is fully registered.
    if (msg.type === 'ready') {
      trace(`webview ready +${Date.now() - _panelCreatedAt}ms after the panel was created`);
      _webviewReady = true;
      if (_pendingMessage && previewPanel) {
        const pending = _pendingMessage;
        _pendingMessage = undefined;
        const tFlush = Date.now();
        previewPanel.webview.postMessage(pending).then(
          () => { trace(`flushed ${pending.type} +${Date.now() - tFlush}ms`); },
          (err: unknown) => { console.error('[lpdf] flush postMessage failed:', err); },
        );
      }
      return;
    }
    // Where the author scrolls the preview to, for the .md file it follows (see lpdf-headings.mjs).
    if (msg.type === 'outline') {
      _scrollSync.outlineChanged(msg.titles ?? []);
      return;
    }
    if (msg.type === 'position') {
      const source = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === previewUri?.toString());
      if (source && msg.at !== undefined) { _scrollSync.previewMoved(source, msg.at); }
      return;
    }
    if (msg.type !== 'download' || !previewUri || !msg.pdfBase64) { return; }
    const xmlDir = path.dirname(previewUri.fsPath);
    const defaultName = documentStem(previewUri.fsPath) + '.pdf';
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
  if (isNewFile) { _scrollSync.reset(); }
  const generation = ++renderGeneration;
  const file = path.basename(uri.fsPath);
  const t0 = Date.now();

  trace(`doRender start gen=${generation} file=${file} isNewFile=${isNewFile} webviewReady=${_webviewReady}`);

  const doc = await vscode.workspace.openTextDocument(uri);
  const xml = doc.getText();
  trace(`doRender text opened +${Date.now() - t0}ms gen=${generation} xmlBytes=${xml.length}`);
  if (generation !== renderGeneration || !previewPanel) {
    trace(`doRender stale after opening the text gen=${generation}`);
    return;
  }

  const pdfName = documentStem(uri.fsPath) + '.pdf';

  previewPanel.title = `${pdfName} — Preview`;
  // Show loading overlay. If the webview isn't ready yet this gets queued and
  // will be superseded by updatePdf/showError when that arrives.
  postToWebview({ type: 'showLoading' });

  try {
    // A .md file is wrapped in its template here; any other document is the engine's input as it is.
    const input = await loadRenderInput(context, uri, xml);
    const { assets, warnings } = input;
    const tWasm = Date.now();
    trace(`doRender engine start +${tWasm - t0}ms gen=${generation}`);
    const bytes = await renderPdf(input.xml, input.jsonData, assets);
    trace(`doRender engine done +${Date.now() - t0}ms gen=${generation} pdfBytes=${bytes.byteLength} engineMs=${Date.now() - tWasm}`);
    if (generation !== renderGeneration || !previewPanel) {
      trace(`doRender stale after the engine gen=${generation} current=${renderGeneration}`);
      return;
    }
    _lastRendered.set(uri.toString(), xml);
    watchDependencies(context, uri, input.files);
    const warningText = warnings.join(' ');
    if (warningText && warningText !== _lastWarnings.get(uri.toString())) {
      vscode.window.showWarningMessage(`Lpdf: ${warningText}`);
    }
    _lastWarnings.set(uri.toString(), warningText);
    const tB64 = Date.now();
    const pdfBase64 = Buffer.from(bytes).toString('base64');
    trace(`doRender base64 +${Date.now() - t0}ms gen=${generation} base64Len=${pdfBase64.length} encodeMs=${Date.now() - tB64}`);
    // Only pass zoom/scroll for new files; re-renders of the same file preserve the webview's state.
    const msg: Record<string, unknown> = { type: 'updatePdf', pdfBase64, filename: pdfName };
    if (isNewFile) { msg.zoom = 'fit'; }
    // The headings of a .md file are the PDF's bookmarks, and the viewer tells where it is among them.
    if (isMarkdownUri(uri)) { msg.followHeadings = true; }
    postToWebview(msg);
    trace(`doRender posted +${Date.now() - t0}ms gen=${generation}`);
  } catch (e) {
    if (generation !== renderGeneration || !previewPanel) {
      trace(`doRender stale after an error gen=${generation}`);
      return;
    }
    const message = e instanceof LpdfRenderError ? e.message : String(e);
    console.error(`[lpdf] doRender error gen=${generation}:`, message);
    postToWebview({ type: 'showError', message });
    vscode.window.showErrorMessage(`Lpdf: ${message}`);
  }
}
