import * as vscode from 'vscode';
import * as path from 'node:path';
import { isLpdfDocument, ensureSchemaAssociation } from './schema';
import { registerCodegenCommands } from './codegen';
import { previewPdf, renderForUri } from './preview';
import { exportPdf } from './export';
import { disposeRenderWorker } from './engine';

class LpdfCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!isLpdfDocument(doc)) { return []; }
    // isLpdfDocument already confirmed <lpdf\b is within the first 512 chars — search only there.
    const head = doc.getText().substring(0, 512);
    const idx = head.search(/<lpdf\b/);
    if (idx === -1) { return []; }
    const pos = doc.positionAt(idx);
    const range = new vscode.Range(pos, pos);
    return [
      new vscode.CodeLens(range, { title: '▶ Preview PDF', command: 'lpdf.previewPdf' }),
      new vscode.CodeLens(range, { title: '⬇ Export PDF',  command: 'lpdf.exportPdf'  }),
    ];
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const xsdPath = path.join(context.extensionPath, 'schema', 'lpdf.xsd');

  // Soft recommendation for the Red Hat XML extension (needed for XSD validation).
  // Shown at most once; respects the user's explicit dismissal via globalState.
  void (async () => {
    const XML_EXT_ID      = 'redhat.vscode-xml';
    const DISMISSED_KEY   = 'xmlExtDismissed';
    if (!vscode.extensions.getExtension(XML_EXT_ID) && !context.globalState.get<boolean>(DISMISSED_KEY)) {
      const choice = await vscode.window.showInformationMessage(
        'LPDF: XML schema validation requires the Red Hat XML extension.',
        'Install', 'Dismiss',
      );
      if (choice === 'Install') {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', XML_EXT_ID);
      } else if (choice === 'Dismiss') {
        await context.globalState.update(DISMISSED_KEY, true);
      }
    }
  })();

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = 'LPDF ◆';
  statusBar.tooltip = 'LPDF document — click to preview';
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
    vscode.commands.registerCommand('lpdf.previewPdf', (uri?: vscode.Uri) => previewPdf(context, uri)),
    vscode.commands.registerCommand('lpdf.exportPdf',  (uri?: vscode.Uri) => exportPdf(uri)),
  );
  registerCodegenCommands(context);

  // CodeLens
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'xml' }, new LpdfCodeLensProvider()),
  );

  // Schema association + status bar refresh
  let _statusDebounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      refreshStatusBar(editor);
      if (editor) {
        ensureSchemaAssociation(editor.document, xsdPath);
        if (isLpdfDocument(editor.document)) {
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
