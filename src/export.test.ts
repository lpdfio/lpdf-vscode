import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  doc: { uri: { fsPath: '/work/invoice.xml' }, getText: () => '<lpdf/>' } as unknown,
  encryption: undefined as unknown,
  saveTo: undefined as undefined | { fsPath: string },
  setting: undefined as unknown,
  askForEncryption: vi.fn(),
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
    getConfiguration: () => ({ get: () => state.setting }),
    fs: { writeFile: (...args: unknown[]) => state.write(...args) },
  },
}));
vi.mock('./encryption-prompt', () => ({ askForEncryption: (...args: unknown[]) => state.askForEncryption(...args) }));
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

import { exportEncryptedPdf, exportPdf } from './export';

const secrets = { store: vi.fn(), get: vi.fn(), delete: vi.fn() };
const memento = { update: vi.fn(), get: vi.fn(), keys: () => [] as string[] };
const context = { secrets, globalState: memento, workspaceState: memento } as never;

const request = { userPassword: 'hunter2-open', ownerPassword: 'hunter2-owner', algorithm: 'aes-256', permissions: { print: true } };

beforeEach(() => {
  for (const mock of [state.askForEncryption, state.renderPdf, state.saveDialog, state.write, state.info, state.error,
    secrets.store, secrets.get, secrets.delete, memento.update, memento.get]) { mock.mockReset(); }
  state.doc = { uri: { fsPath: '/work/invoice.xml' }, getText: () => '<lpdf/>' };
  state.setting = undefined;
  state.askForEncryption.mockResolvedValue(request);
  state.saveDialog.mockResolvedValue({ fsPath: '/out/invoice-encrypted.pdf' });
  state.renderPdf.mockResolvedValue(new Uint8Array([1]));
});

describe('exportEncryptedPdf', () => {
  it('asks what to protect, then where to save, then renders with it and writes the file', async () => {
    await exportEncryptedPdf(context);

    expect(state.askForEncryption).toHaveBeenCalledWith('aes-256');
    expect(state.renderPdf).toHaveBeenCalledWith('<lpdf/>', null, expect.anything(), request);
    expect(state.write).toHaveBeenCalledOnce();
    expect(state.askForEncryption.mock.invocationCallOrder[0]).toBeLessThan(state.saveDialog.mock.invocationCallOrder[0]);
  });

  it('offers the document\'s name with -encrypted.pdf, so it does not overwrite a plain export', async () => {
    await exportEncryptedPdf(context);
    expect(state.saveDialog.mock.calls[0][0].defaultUri.fsPath).toBe('/work/invoice-encrypted.pdf');
  });

  it('uses the cipher the setting names', async () => {
    state.setting = 'rc4-128';
    await exportEncryptedPdf(context);
    expect(state.askForEncryption).toHaveBeenCalledWith('rc4-128');
  });

  it('writes nothing when the prompts are cancelled, and does not even ask where to save', async () => {
    state.askForEncryption.mockResolvedValue(undefined);
    await exportEncryptedPdf(context);

    expect(state.saveDialog).not.toHaveBeenCalled();
    expect(state.renderPdf).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it('writes nothing when the save dialog is cancelled', async () => {
    state.saveDialog.mockResolvedValue(undefined);
    await exportEncryptedPdf(context);

    expect(state.renderPdf).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it('says it was encrypted without repeating a password', async () => {
    await exportEncryptedPdf(context);
    const message = state.info.mock.calls[0][0] as string;
    expect(message).toContain('invoice-encrypted.pdf');
    expect(message).toContain('AES-256');
    expect(message).not.toContain('hunter2');
  });

  it('keeps the passwords out of secret storage and every memento', async () => {
    await exportEncryptedPdf(context);
    for (const mock of [secrets.store, secrets.get, secrets.delete, memento.update]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('shows the error and writes nothing when the render fails', async () => {
    state.renderPdf.mockRejectedValue(new Error('bad xml'));
    await exportEncryptedPdf(context);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith('Lpdf: Error: bad xml');
  });

  it('does nothing when there is no Lpdf document', async () => {
    state.doc = undefined;
    await exportEncryptedPdf(context);
    expect(state.askForEncryption).not.toHaveBeenCalled();
  });
});

describe('exportPdf', () => {
  it('still renders without encryption, and never asks for passwords', async () => {
    state.saveDialog.mockResolvedValue({ fsPath: '/out/invoice.pdf' });
    await exportPdf(context);

    expect(state.askForEncryption).not.toHaveBeenCalled();
    expect(state.renderPdf).toHaveBeenCalledWith('<lpdf/>', null, expect.anything(), undefined);
    expect(state.saveDialog.mock.calls[0][0].defaultUri.fsPath).toBe('/work/invoice.pdf');
    expect(state.info.mock.calls[0][0]).toBe('Lpdf: Saved invoice.pdf');
  });
});
