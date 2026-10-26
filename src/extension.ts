import * as vscode from 'vscode';
import * as path from 'node:path';
import { isLpdfDocument, startSchemaAssociations } from './schema';
import { LPDF_HEAD_SCAN_BYTES } from './constants';
import { registerCodegenCommands } from './codegen';
import { registerHoverProvider } from './hover-provider';
import { registerNewDocumentCommand } from './new-document';
import { registerPdfDiffPrompt } from './pdf-diff-prompt';
import { previewPdf, renderForUri, closePreviewWhenSourceCloses } from './preview';
import { exportEncryptedPdf, exportPdf } from './export';
import {
  createLpdfDocument,
  createMarkdownStyles,
  getLinkedDocumentUri,
  getLinkedMarkdownUri,
  getLinkedStylesUri,
  isMarkdownDocument,
  onDidChangeMarkdownLinks,
  promptLinkMarkdownFile,
  promptLinkStylesFile,
  setLinkedDocumentUri,
  setLinkedStylesUri,
} from './markdown';
import { disposeRenderWorker } from './engine';
import { LpdfPdfViewerProvider } from './pdf-viewer';
import { initTrace } from './trace';
import { diffPdf } from './pdf-diff';
import {
  getLinkedDataUri,
  setLinkedDataUri,
  unlinkDataUri,
  promptLinkDataFile,
  onDidChangeDataLinks,
} from './data';

// Tracks active JSON file watchers keyed by XML URI string.
const _dataWatchers = new Map<string, vscode.FileSystemWatcher>();

// A plain space leaves only a hairline between a codicon and its label in CodeLens. An en
// space and a no-break space are not collapsed, so together they give a visible gap.
const LENS_ICON_GAP = '\u2002\u00A0';

/** A CodeLens title: the named codicon, a gap, then the label. */
function lensTitle(icon: string, label: string): string {
  return `$(${icon})${LENS_ICON_GAP}${label}`;
}

/** A file's name for a CodeLens title: CodeLens renders $(name) as a codicon, so the backslash keeps a "$(" literal. */
function lensFileName(uri: vscode.Uri): string {
  return path.basename(uri.fsPath).replace(/\$\(/g, '\\$(');
}

/** The pair of lenses that show a linked file, which opens it, and unlink it. */
function linkedLenses(range: vscode.Range, icon: string, file: vscode.Uri, openCommand: string, unlinkCommand: string, owner: vscode.Uri): vscode.CodeLens[] {
  return [
    new vscode.CodeLens(range, { title: lensTitle(icon, lensFileName(file)), command: openCommand, arguments: [file] }),
    new vscode.CodeLens(range, { title: lensTitle('close', 'Unlink'), command: unlinkCommand, arguments: [owner] }),
  ];
}

class LpdfCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _context: vscode.ExtensionContext;
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._emitter.event;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    onDidChangeDataLinks(() => this._emitter.fire());
    onDidChangeMarkdownLinks(() => this._emitter.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isLpdfDocument(doc)) { return []; }
    const text = doc.getText();
    // Scan only the head of the document for the <lpdf root element.
    const head = text.substring(0, LPDF_HEAD_SCAN_BYTES);
    const idx = head.search(/<lpdf\b/);
    if (idx === -1) { return []; }
    const pos = doc.positionAt(idx);
    const range = new vscode.Range(pos, pos);

    // A document that holds a <markdown> can take its text from a .md file; that file is then its data.
    const markdown = getLinkedMarkdownUri(this._context, doc.uri);
    const linked = getLinkedDataUri(this._context, doc.uri);
    let dataLenses: vscode.CodeLens[] = [];
    if (markdown) {
      dataLenses = linkedLenses(range, 'markdown', markdown, 'vscode.open', 'lpdf.unlinkMarkdownFile', doc.uri);
    } else {
      dataLenses = linked
        ? [
            new vscode.CodeLens(range, {
              title: lensTitle('database', lensFileName(linked)),
              command: 'lpdf.linkDataFile',
              arguments: [doc.uri],
            }),
            new vscode.CodeLens(range, {
              title: lensTitle('close', 'Unlink'),
              command: 'lpdf.unlinkDataFile',
              arguments: [doc.uri],
            }),
          ]
        : [
            new vscode.CodeLens(range, {
              title: lensTitle('database', 'Link Data...'),
              command: 'lpdf.linkDataFile',
              arguments: [doc.uri],
            }),
          ];
      if (/<markdown\b/.test(text)) {
        dataLenses.push(new vscode.CodeLens(range, {
          title: lensTitle('markdown', 'Link Markdown...'),
          command: 'lpdf.linkMarkdownFile',
          arguments: [doc.uri],
        }));
      }
    }

    return [
      new vscode.CodeLens(range, { title: lensTitle('play', 'Preview PDF'),          command: 'lpdf.previewPdf' }),
      new vscode.CodeLens(range, { title: lensTitle('share', 'Export PDF'),          command: 'lpdf.exportPdf'  }),
      new vscode.CodeLens(range, { title: lensTitle('bracket-dot', 'Generate code'), command: 'lpdf.generateHere', arguments: [doc.uri] }),
      ...dataLenses,
    ];
  }
}

/** The lenses of a `.md` file: preview and export, then its styles, or the Lpdf document it is rendered through. */
class MarkdownCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _context: vscode.ExtensionContext;
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._emitter.event;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    onDidChangeMarkdownLinks(() => this._emitter.fire());
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isMarkdownDocument(doc)) { return []; }
    const range = new vscode.Range(0, 0, 0, 0);

    const lenses = [
      new vscode.CodeLens(range, { title: lensTitle('play', 'Preview PDF'), command: 'lpdf.previewPdf' }),
      new vscode.CodeLens(range, { title: lensTitle('share', 'Export PDF'), command: 'lpdf.exportPdf' }),
    ];
    // The styles are named by the Lpdf document, once there is one, so they are linked only without it.
    const document = getLinkedDocumentUri(this._context, doc.uri);
    if (document) {
      return [...lenses, ...linkedLenses(range, 'file-code', document, 'vscode.open', 'lpdf.unlinkLpdfDocument', doc.uri)];
    }
    const styles = getLinkedStylesUri(this._context, doc.uri);
    const stylesLenses = styles
      ? linkedLenses(range, 'symbol-color', styles, 'vscode.open', 'lpdf.unlinkMarkdownStyles', doc.uri)
      : [new vscode.CodeLens(range, { title: lensTitle('symbol-color', 'Link Styles...'), command: 'lpdf.linkMarkdownStyles', arguments: [doc.uri] })];
    return [
      ...lenses,
      ...stylesLenses,
      new vscode.CodeLens(range, { title: lensTitle('file-code', 'Create Lpdf Document'), command: 'lpdf.createLpdfDocument', arguments: [doc.uri] }),
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

// ---------- PDF default-viewer helpers ----------

const PDF_ASSOC_GLOB = '*.pdf';

// The lpdf.defaultPdfViewer value last applied to the user's editor associations. The
// extension only activates when an XML file opens, so the setting can change while it isn't
// running; comparing against this catches that on the next activation without rewriting
// user settings on every start.
const PDF_VIEWER_APPLIED_KEY = 'pdfViewerApplied';

/**
 * Brings the user's `workbench.editorAssociations` in line with `lpdf.defaultPdfViewer`,
 * but only when the setting differs from what was last applied. Anyone who changes the
 * `*.pdf` association themselves, e.g. through VS Code's "Configure default editor",
 * keeps their choice until they change `lpdf.defaultPdfViewer` again.
 *
 * Reads and writes the user-level value only. The merged value also holds the open
 * workspace's own associations, and writing that back would copy them into every other
 * workspace.
 */
async function syncPdfViewerAssociation(context: vscode.ExtensionContext): Promise<void> {
  const enable = vscode.workspace.getConfiguration('lpdf').get<boolean>('defaultPdfViewer', false);
  if (enable === context.globalState.get<boolean>(PDF_VIEWER_APPLIED_KEY, false)) { return; }

  const config  = vscode.workspace.getConfiguration();
  const current = config.inspect<Record<string, string>>('workbench.editorAssociations')?.globalValue ?? {};
  const ours    = current[PDF_ASSOC_GLOB] === LpdfPdfViewerProvider.viewType;
  // Disabling leaves another viewer's *.pdf entry alone; only ours is removed.
  if (enable !== ours) {
    const updated = { ...current };
    if (enable) {
      updated[PDF_ASSOC_GLOB] = LpdfPdfViewerProvider.viewType;
    } else {
      delete updated[PDF_ASSOC_GLOB];
    }
    // Undefined removes the setting rather than leaving an empty object in the user's file.
    await config.update(
      'workbench.editorAssociations',
      Object.keys(updated).length > 0 ? updated : undefined,
      vscode.ConfigurationTarget.Global,
    );
  }
  await context.globalState.update(PDF_VIEWER_APPLIED_KEY, enable);
}

/** Logs a failure to change the default PDF viewer; the viewer itself still works through "Open With". */
function reportPdfViewerError(e: unknown): void {
  console.error('[lpdf] could not update the default PDF viewer:', e);
}

// Set before the first await, so two triggers in quick succession show one prompt.
let _pdfViewerPromptAsked = false;

/**
 * Offers, once per machine, to make the Lpdf viewer the default for PDF files.
 *
 * Only called in context: when an lpdf document is on screen, or when a PDF opens in the
 * Lpdf viewer. The extension also activates for every other XML file (pom.xml, .csproj),
 * and asking about PDFs there would come out of nowhere. Skipped when the viewer is
 * already the default.
 */
async function promptPdfViewerOptIn(context: vscode.ExtensionContext): Promise<void> {
  if (_pdfViewerPromptAsked || context.globalState.get<boolean>('pdfViewerPromptShown')) { return; }
  if (vscode.workspace.getConfiguration('lpdf').get<boolean>('defaultPdfViewer', false)) { return; }
  _pdfViewerPromptAsked = true;
  await context.globalState.update('pdfViewerPromptShown', true);
  const choice = await vscode.window.showInformationMessage(
    'Open PDF files with the Lpdf viewer by default?',
    'Enable',
    'Not now',
  );
  if (choice === 'Enable') {
    await vscode.workspace.getConfiguration('lpdf').update('defaultPdfViewer', true, vscode.ConfigurationTarget.Global);
    // The configuration listener also fires for this; the sync is a no-op the second time.
    await syncPdfViewerAssociation(context);
  }
}

// -------------------------------------------------

/**
 * Whether the styles of a `.md` file can be linked: not while it is rendered through an Lpdf document, which
 * names the styles itself, in a `<markdown-styles>`. Says so when they cannot.
 */
async function canChangeStyles(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<boolean> {
  const document = getLinkedDocumentUri(context, markdownUri);
  if (!document) { return true; }
  void vscode.window.showInformationMessage(
    `Lpdf: This Markdown file is rendered through ${path.basename(document.fsPath)}, which names its styles in a <markdown-styles>. Unlink the document to link styles here.`,
  );
  return false;
}

export function activate(context: vscode.ExtensionContext): void {
  initTrace(context);
  const xsdPath = path.join(context.extensionPath, 'schema', 'lpdf.xsd');

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = 'Lpdf ◆';
  statusBar.tooltip = 'Lpdf document — click to preview';
  statusBar.command = 'lpdf.previewPdf';
  context.subscriptions.push(statusBar);

  /**
   * Updates what depends on the active editor holding an lpdf document: the status bar
   * item, the `lpdf.isLpdfDocument` context key that shows the editor-title button, and the
   * one-time PDF viewer prompt, which is only asked once an lpdf document is on screen.
   * Runs on start, on editor switch, and after typing, so a new file counts as soon as its
   * <lpdf> root is typed.
   */
  function refreshLpdfContext(editor?: vscode.TextEditor): void {
    const isLpdf = !!editor && isLpdfDocument(editor.document);
    void vscode.commands.executeCommand('setContext', 'lpdf.isLpdfDocument', isLpdf);
    if (isLpdf) {
      statusBar.show();
      promptPdfViewerOptIn(context).catch(reportPdfViewerError);
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
    vscode.commands.registerCommand('lpdf.exportPdf',  (uri?: vscode.Uri) => exportPdf(context, uri)),
    vscode.commands.registerCommand('lpdf.exportEncryptedPdf', (uri?: vscode.Uri) => exportEncryptedPdf(context, uri)),
    vscode.commands.registerCommand('lpdf.linkDataFile', async (xmlUri?: vscode.Uri) => {
      const target = xmlUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      const picked = await promptLinkDataFile(context, target);
      if (!picked) { return; }
      setupDataWatcher(context, target, picked);
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.linkMarkdownStyles', async (markdownUri?: vscode.Uri) => {
      const target = markdownUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !(await canChangeStyles(context, target))) { return; }
      if (!await promptLinkStylesFile(context, target)) { return; }
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.unlinkMarkdownStyles', async (markdownUri?: vscode.Uri) => {
      const target = markdownUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      if (!getLinkedStylesUri(context, target)) {
        void vscode.window.showInformationMessage('Lpdf: This Markdown file has no styles linked: it renders with the default ones.');
        return;
      }
      await setLinkedStylesUri(context, target, undefined);
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.createMarkdownStyles', async (markdownUri?: vscode.Uri) => {
      const target = markdownUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !(await canChangeStyles(context, target))) { return; }
      if (await createMarkdownStyles(context, target)) { void renderForUri(context, target, 'data'); }
    }),
    vscode.commands.registerCommand('lpdf.createLpdfDocument', async (markdownUri?: vscode.Uri) => {
      const target = markdownUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      if (getLinkedDocumentUri(context, target)) {
        void vscode.window.showInformationMessage('Lpdf: This Markdown file already has an Lpdf document: unlink it first to write another.');
        return;
      }
      if (await createLpdfDocument(context, target)) { void renderForUri(context, target, 'data'); }
    }),
    vscode.commands.registerCommand('lpdf.unlinkLpdfDocument', async (markdownUri?: vscode.Uri) => {
      const target = markdownUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      if (!getLinkedDocumentUri(context, target)) {
        void vscode.window.showInformationMessage('Lpdf: This Markdown file has no Lpdf document linked: it renders in the default one.');
        return;
      }
      await setLinkedDocumentUri(context, target, undefined);
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.linkMarkdownFile', async (documentUri?: vscode.Uri) => {
      const target = documentUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      if (!await promptLinkMarkdownFile(context, target)) { return; }
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.unlinkMarkdownFile', async (documentUri?: vscode.Uri) => {
      const target = documentUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      const markdown = getLinkedMarkdownUri(context, target);
      if (!markdown) {
        void vscode.window.showInformationMessage('Lpdf: This document has no Markdown file linked.');
        return;
      }
      await setLinkedDocumentUri(context, markdown, undefined);
      void renderForUri(context, target, 'data');
    }),
    vscode.commands.registerCommand('lpdf.unlinkDataFile', async (xmlUri?: vscode.Uri) => {
      const target = xmlUri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      teardownDataWatcher(target);
      await unlinkDataUri(context, target);
      void renderForUri(context, target, 'data');
    }),
    vscode.window.registerCustomEditorProvider(
      LpdfPdfViewerProvider.viewType,
      new LpdfPdfViewerProvider(context, () => { promptPdfViewerOptIn(context).catch(reportPdfViewerError); }),
      { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('lpdf.openPdf', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) { return; }
      void vscode.commands.executeCommand('vscode.openWith', target, LpdfPdfViewerProvider.viewType);
    }),
    vscode.commands.registerCommand('lpdf.diffPdf', (uri?: vscode.Uri) => diffPdf(context, uri)),
  );
  registerCodegenCommands(context);
  registerNewDocumentCommand(context);
  registerPdfDiffPrompt(context);

  // CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'xml' }, new LpdfCodeLensProvider(context)),
    vscode.languages.registerCodeLensProvider({ language: 'markdown' }, new MarkdownCodeLensProvider(context)),
  );

  // Hover with the signature of the tag or attribute under the cursor, read from the same XSD.
  registerHoverProvider(context, xsdPath);

  // Schema validation for every open lpdf document, registered in memory through Red Hat XML.
  // Logged rather than shown: preview and export work without validation, and Red Hat XML
  // reports its own start-up failures.
  startSchemaAssociations(context, xsdPath).catch((e: unknown) => {
    console.error('[lpdf] schema validation unavailable:', e);
  });

  // Status bar refresh
  let _statusDebounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      refreshLpdfContext(editor);
      if (editor && isLpdfDocument(editor.document)) {
        ensureDataWatcher(context, editor.document.uri);
        renderForUri(context, editor.document.uri, 'switch');
      } else if (editor && isMarkdownDocument(editor.document)) {
        renderForUri(context, editor.document.uri, 'switch');
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(event => closePreviewWhenSourceCloses(event.closed)),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document !== vscode.window.activeTextEditor?.document) { return; }
      clearTimeout(_statusDebounce);
      _statusDebounce = setTimeout(() => refreshLpdfContext(vscode.window.activeTextEditor), 300);
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (isLpdfDocument(doc) || isMarkdownDocument(doc)) { renderForUri(context, doc.uri, 'save'); }
    }),
  );

  refreshLpdfContext(vscode.window.activeTextEditor);

  // PDF default-viewer. On start this only writes if lpdf.defaultPdfViewer changed while the
  // extension wasn't running; after that, only when the setting changes.
  syncPdfViewerAssociation(context).catch(reportPdfViewerError);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lpdf.defaultPdfViewer')) {
        syncPdfViewerAssociation(context).catch(reportPdfViewerError);
      }
    }),
  );
  // The opt-in prompt is not shown here: activation happens for any XML file. It waits for
  // an lpdf document on screen (refreshLpdfContext) or a PDF in the Lpdf viewer.
}

export function deactivate(): void {
  disposeRenderWorker();
}
