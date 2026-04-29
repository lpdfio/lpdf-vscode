import * as vscode from 'vscode';
import * as path from 'node:path';
import { isLpdfDocument, ensureSchemaAssociation } from './schema';
import { registerCodegenCommands } from './codegen';
import { previewPdf, renderForUri } from './preview';
import { exportPdf } from './export';
import { disposeRenderWorker } from './engine';
import { LpdfPdfViewerProvider } from './pdf-viewer';
import {
  getLinkedDataUri,
  getExplicitDataUri,
  setLinkedDataUri,
  promptLinkDataFile,
  onDidChangeDataLinks,
} from './data';

// Tracks active JSON file watchers keyed by XML URI string.
const _dataWatchers = new Map<string, vscode.FileSystemWatcher>();

class LpdfCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _context: vscode.ExtensionContext;
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._emitter.event;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    onDidChangeDataLinks(() => this._emitter.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isLpdfDocument(doc)) { return []; }
    // isLpdfDocument already confirmed <lpdf\b is within the first 512 chars — search only there.
    const head = doc.getText().substring(0, 512);
    const idx = head.search(/<lpdf\b/);
    if (idx === -1) { return []; }
    const pos = doc.positionAt(idx);
    const range = new vscode.Range(pos, pos);

    const linked = getLinkedDataUri(this._context, doc.uri);
    const explicit = getExplicitDataUri(this._context, doc.uri);
    const dataLenses: vscode.CodeLens[] = linked
      ? [
          new vscode.CodeLens(range, {
            title: `◈ ${path.basename(linked.fsPath)}`,
            command: 'lpdf.linkDataFile',
            arguments: [doc.uri],
          }),
          ...(explicit ? [new vscode.CodeLens(range, {
            title: '✕ Unlink',
            command: 'lpdf.unlinkDataFile',
            arguments: [doc.uri],
          })] : []),
        ]
      : [
          new vscode.CodeLens(range, {
            title: '◈ Link Data...',
            command: 'lpdf.linkDataFile',
            arguments: [doc.uri],
          }),
        ];

    return [
      new vscode.CodeLens(range, { title: '▶ Preview PDF', command: 'lpdf.previewPdf' }),
      new vscode.CodeLens(range, { title: '⬇ Export PDF',  command: 'lpdf.exportPdf'  }),
      ...dataLenses,
    ];
  }
}

function setupDataWatcher(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
  jsonUri: vscode.Uri,
): void {
  const key = xmlUri.toString();
  _dataWatchers.get(key)?.dispose();
  const w = vscode.workspace.createFileSystemWatcher(jsonUri.fsPath);
  w.onDidChange(() => { void renderForUri(context, xmlUri, 'data'); });
  w.onDidDelete(async () => {
    teardownDataWatcher(xmlUri);
    await setLinkedDataUri(context, xmlUri, undefined);
    void renderForUri(context, xmlUri, 'data');
  });
  context.subscriptions.push(w);
  _dataWatchers.set(key, w);
}

function teardownDataWatcher(xmlUri: vscode.Uri): void {
  const key = xmlUri.toString();
  _dataWatchers.get(key)?.dispose();
  _dataWatchers.delete(key);
}

/**
 * Sets up a data watcher for xmlUri if one is not already active.
 * Called on preview open and on active-editor switch so that auto-discovered
 * and previously-linked JSON files are watched without any explicit user action.
 */
function ensureDataWatcher(context: vscode.ExtensionContext, xmlUri: vscode.Uri): void {
  if (_dataWatchers.has(xmlUri.toString())) { return; } // already watching
  const jsonUri = getLinkedDataUri(context, xmlUri);
  if (!jsonUri) { return; } // no data file linked or discoverable
  setupDataWatcher(context, xmlUri, jsonUri);
}

export function activate(context: vscode.ExtensionContext): void {
  const xsdPath = path.join(context.extensionPath, 'schema', 'lpdf.xsd');

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = 'Lpdf ◆';
  statusBar.tooltip = 'Lpdf document — click to preview';
  statusBar.command = 'lpdf.previewPdf';
  context.subscriptions.push(statusBar);

  function refreshStatusBar(editor?: vscode.TextEditor): void {
    if (editor && isLpdfDocument(editor.document)) {
      statusBar.show();
    } else {
      statusBar.hide();
    }
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('lpdf.previewPdf', (uri?: vscode.Uri) => {
      const resolvedUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (resolvedUri) { ensureDataWatcher(context, resolvedUri); }
      return previewPdf(context, uri);
    }),
    vscode.commands.registerCommand('lpdf.exportPdf',  (uri?: vscode.Uri) => exportPdf(uri)),
    vscode.commands.registerCommand('lpdf.linkDataFile', async (xmlUri?: vscode.Uri) => {
      const target = xmlUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      const picked = await promptLinkDataFile(context, target);
      if (!picked) { return; }
      setupDataWatcher(context, target, picked);
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.unlinkDataFile', async (xmlUri?: vscode.Uri) => {
      const target = xmlUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      teardownDataWatcher(target);
      await setLinkedDataUri(context, target, undefined);
      void renderForUri(context, target, 'data');
    }),
    vscode.window.registerCustomEditorProvider(
      LpdfPdfViewerProvider.viewType,
      new LpdfPdfViewerProvider(context),
      { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('lpdf.openPdf', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      void vscode.commands.executeCommand('vscode.openWith', target, LpdfPdfViewerProvider.viewType);
    }),
  );
  registerCodegenCommands(context);

  // CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'xml' }, new LpdfCodeLensProvider(context)),
  );

  // Schema association + status bar refresh
  let _statusDebounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      refreshStatusBar(editor);
      if (editor) {
        ensureSchemaAssociation(editor.document, xsdPath);
        if (isLpdfDocument(editor.document)) {
          ensureDataWatcher(context, editor.document.uri);
          renderForUri(context, editor.document.uri, 'switch');
        }
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      // Refresh the status bar when the active file's content changes (e.g. user adds/removes <lpdf).
      // Debounced at 300 ms to avoid thrashing on every keystroke.
      if (event.document !== vscode.window.activeTextEditor?.document) { return; }
      clearTimeout(_statusDebounce);
      _statusDebounce = setTimeout(() => refreshStatusBar(vscode.window.activeTextEditor), 300);
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId !== 'xml') { return; }
      ensureSchemaAssociation(doc, xsdPath);
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (isLpdfDocument(doc)) { renderForUri(context, doc.uri, 'save'); }
    }),
  );

  // Seed state for already-open editors
  for (const editor of vscode.window.visibleTextEditors) {
    ensureSchemaAssociation(editor.document, xsdPath);
  }
  refreshStatusBar(vscode.window.activeTextEditor);
}

export function deactivate(): void {
  disposeRenderWorker();
}
