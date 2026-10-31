import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ENCRYPTED = '<lpdf version="1"><document><output encrypt="aes-256"/><section/></document></lpdf>';
const PLAIN = '<lpdf version="1"><document><section/></document></lpdf>';

const state = {
  /** The text of each document by its path, as `openTextDocument` gives it. */
  texts: new Map<string, string>(),
  renderPdf: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
};

/** A Uri with what the preview reads of one: its path, and a string that tells two apart. */
function uri(fsPath: string): { fsPath: string; toString(): string } {
  return { fsPath, toString: () => `file://${fsPath}` };
}

const panel = {
  title: '',
  visible: true,
  reveal: vi.fn(),
  onDidDispose: vi.fn(),
  webview: {
    html: '',
    cspSource: 'csp',
    asWebviewUri: (target: { fsPath: string }) => ({ toString: () => target.fsPath }),
    onDidReceiveMessage: vi.fn(),
    postMessage: vi.fn(async () => true),
  },
};

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }),
    file: (fsPath: string) => ({ fsPath }),
  },
  ViewColumn: { Beside: -2 },
  TabInputText: class {},
  window: {
    createWebviewPanel: () => panel,
    showWarningMessage: (...args: unknown[]) => state.warning(...args),
    showErrorMessage: (...args: unknown[]) => state.error(...args),
    visibleTextEditors: [],
  },
  workspace: {
    textDocuments: [],
    openTextDocument: async (target: { fsPath: string }) => ({ getText: () => state.texts.get(target.fsPath) ?? '' }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
  },
}));
vi.mock('./engine', () => ({
  renderPdf: (...args: unknown[]) => state.renderPdf(...args),
  cancelRender: () => {},
  LpdfRenderError: class extends Error {},
}));
vi.mock('./render-input', () => ({
  loadRenderInput: async (_context: unknown, _uri: unknown, text: string) =>
    ({ xml: text, jsonData: null, assets: { fonts: new Map(), images: new Map() }, warnings: [], files: [] }),
}));
vi.mock('./markdown', () => ({ isMarkdownUri: () => false }));
vi.mock('./trace', () => ({ trace: () => {} }));
vi.mock('./viewer-html', () => ({ buildViewerHtml: () => '<html></html>' }));
vi.mock('./utils', () => ({
  documentStem: (fsPath: string) => path.basename(fsPath, '.xml'),
  resolveLpdfDocument: async (target: { fsPath: string }) => ({ uri: target }),
}));

import { previewPdf } from './preview';
import { PREVIEW_NOT_ENCRYPTED } from './encryption';

const context = { extensionUri: { fsPath: path.join(__dirname, '..') }, subscriptions: [] } as never;

beforeEach(() => {
  state.renderPdf.mockReset();
  state.renderPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  state.warning.mockReset();
  state.error.mockReset();
});

describe('the preview', () => {
  it('renders a document that asks for encryption unencrypted, and says so', async () => {
    state.texts.set('/work/statement.xml', ENCRYPTED);
    await previewPdf(context, uri('/work/statement.xml') as never);

    expect(state.renderPdf).toHaveBeenCalledWith(ENCRYPTED, null, expect.anything(), { skipEncryption: true });
    expect(state.warning).toHaveBeenCalledWith(`Lpdf: ${PREVIEW_NOT_ENCRYPTED}`);
    expect(state.error).not.toHaveBeenCalled();
  });

  it('says it once, not on every render of the same document', async () => {
    state.texts.set('/work/statement.xml', ENCRYPTED);
    await previewPdf(context, uri('/work/statement.xml') as never);
    expect(state.warning).not.toHaveBeenCalled();
  });

  it('renders a document that does not ask for encryption as it is, and says nothing about encryption', async () => {
    state.texts.set('/work/invoice.xml', PLAIN);
    await previewPdf(context, uri('/work/invoice.xml') as never);

    expect(state.renderPdf).toHaveBeenCalledWith(PLAIN, null, expect.anything(), { skipEncryption: true });
    expect(state.warning).not.toHaveBeenCalled();
  });
});
