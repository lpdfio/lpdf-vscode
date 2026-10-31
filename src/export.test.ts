import { beforeEach, describe, expect, it, vi } from 'vitest';

const ENCRYPTED = '<lpdf version="1"><document><output encrypt="rc4-128" allow="print"/><section/></document></lpdf>';

const state = {
  doc: { uri: { fsPath: '/work/invoice.xml' }, getText: () => '<lpdf/>' } as unknown,
  askForPasswords: vi.fn(),
  renderPdf: vi.fn(),
  saveDialog: vi.fn(),
  write: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  EventEmitter: class { event = () => ({ dispose() {} }); fire(): void {} },
  window: {
    showSaveDialog: (...args: unknown[]) => state.saveDialog(...args),
    showInformationMessage: (...args: unknown[]) => state.info(...args),
    showWarningMessage: vi.fn(),
    showErrorMessage: (...args: unknown[]) => state.error(...args),
  },
  workspace: {
    textDocuments: [],
    getConfiguration: () => ({ get: () => undefined }),
    fs: { writeFile: (...args: unknown[]) => state.write(...args) },
  },
}));
vi.mock('./encryption-prompt', () => ({ askForPasswords: (...args: unknown[]) => state.askForPasswords(...args) }));
vi.mock('./engine', () => ({
  renderPdf: (...args: unknown[]) => state.renderPdf(...args),
  LpdfRenderError: class extends Error {},
}));
vi.mock('./assets', () => ({ loadAssets: async () => ({ assets: { fonts: new Map(), images: new Map() }, warnings: [] }) }));
vi.mock('./data', () => ({ getLinkedDataJson: () => null }));
vi.mock('./utils', () => ({
  documentStem: (fsPath: string) => fsPath.replace(/^.*\//, '').replace(/\.xml$/, ''),
  resolveLpdfDocument: async () => state.doc,
}));

import { exportPdf } from './export';

const secrets = { store: vi.fn(), get: vi.fn(), delete: vi.fn() };
const memento = { update: vi.fn(), get: vi.fn(), keys: () => [] as string[] };
const context = { secrets, globalState: memento, workspaceState: memento } as never;

const passwords = { userPassword: 'hunter2-open', ownerPassword: 'hunter2-owner' };

function encryptedDocument(): void {
  state.doc = { uri: { fsPath: '/work/invoice.xml' }, getText: () => ENCRYPTED };
}

beforeEach(() => {
  for (const mock of [state.askForPasswords, state.renderPdf, state.saveDialog, state.write, state.info, state.error,
    secrets.store, secrets.get, secrets.delete, memento.update, memento.get]) { mock.mockReset(); }
  state.doc = { uri: { fsPath: '/work/invoice.xml' }, getText: () => '<lpdf/>' };
  state.askForPasswords.mockResolvedValue(passwords);
  state.saveDialog.mockResolvedValue({ fsPath: '/out/invoice.pdf' });
  state.renderPdf.mockResolvedValue(new Uint8Array([1]));
});

describe('exportPdf of a document that does not ask for encryption', () => {
  it('saves it as it renders, and never asks for passwords', async () => {
    await exportPdf(context);

    expect(state.askForPasswords).not.toHaveBeenCalled();
    expect(state.renderPdf).toHaveBeenCalledWith('<lpdf/>', null, expect.anything(), { passwords: undefined });
    expect(state.saveDialog.mock.calls[0][0].defaultUri.fsPath).toBe('/work/invoice.pdf');
    expect(state.info.mock.calls[0][0]).toBe('Lpdf: Saved invoice.pdf');
  });

  it('shows the error and writes nothing when the render fails', async () => {
    state.renderPdf.mockRejectedValue(new Error('bad xml'));
    await exportPdf(context);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith('Lpdf: Error: bad xml');
  });

  it('does nothing when there is no Lpdf document', async () => {
    state.doc = undefined;
    await exportPdf(context);
    expect(state.saveDialog).not.toHaveBeenCalled();
  });
});

describe('exportPdf of a document that asks for encryption in its <output>', () => {
  beforeEach(encryptedDocument);

  it('asks for the passwords with its cipher, then where to save, then renders with them and writes the file', async () => {
    await exportPdf(context);

    expect(state.askForPasswords).toHaveBeenCalledWith('rc4-128');
    expect(state.renderPdf).toHaveBeenCalledWith(ENCRYPTED, null, expect.anything(), { passwords });
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.askForPasswords.mock.invocationCallOrder[0]).toBeLessThan(state.saveDialog.mock.invocationCallOrder[0]);
  });

  it('writes nothing when the passwords are cancelled, and does not even ask where to save', async () => {
    state.askForPasswords.mockResolvedValue(undefined);
    await exportPdf(context);

    expect(state.saveDialog).not.toHaveBeenCalled();
    expect(state.renderPdf).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it('writes nothing when the save dialog is cancelled', async () => {
    state.saveDialog.mockResolvedValue(undefined);
    await exportPdf(context);

    expect(state.renderPdf).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it('says it was encrypted, with its cipher, without repeating a password', async () => {
    await exportPdf(context);
    const message = state.info.mock.calls[0][0] as string;
    expect(message).toContain('invoice.pdf');
    expect(message).toContain('RC4-128');
    expect(message).not.toContain('hunter2');
  });

  it('refuses a cipher the engine doesn\'t know before it asks for any password', async () => {
    state.doc = { uri: { fsPath: '/work/invoice.xml' }, getText: () => ENCRYPTED.replace('rc4-128', 'aes-128') };
    await exportPdf(context);

    expect(state.error.mock.calls[0][0]).toContain('encrypt="aes-128"');
    expect(state.askForPasswords).not.toHaveBeenCalled();
    expect(state.saveDialog).not.toHaveBeenCalled();
    expect(state.renderPdf).not.toHaveBeenCalled();
  });

  it('keeps the passwords out of secret storage and every memento', async () => {
    await exportPdf(context);
    for (const mock of [secrets.store, secrets.get, secrets.delete, memento.update]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });
});
