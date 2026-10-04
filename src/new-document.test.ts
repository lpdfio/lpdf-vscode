import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeUri = { fsPath: string; path: string; scheme: string };

const fileUri = (fsPath: string): FakeUri => ({ fsPath, path: fsPath, scheme: 'file' });

const ui = {
  showQuickPick: vi.fn(),
  showSaveDialog: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showTextDocument: vi.fn(),
  executeCommand: vi.fn(),
};

vi.mock('vscode', () => ({
  EventEmitter: class { event = () => ({ dispose() {} }); fire(): void {} },
  Uri: {
    file: (fsPath: string) => fileUri(fsPath),
    joinPath: (base: FakeUri, ...parts: string[]) => fileUri(path.join(base.fsPath, ...parts)),
  },
  FileType: { File: 1, Directory: 2 },
  window: {
    showQuickPick: (...args: unknown[]) => ui.showQuickPick(...args),
    showSaveDialog: (...args: unknown[]) => ui.showSaveDialog(...args),
    showWarningMessage: (...args: unknown[]) => ui.showWarningMessage(...args),
    showErrorMessage: (...args: unknown[]) => ui.showErrorMessage(...args),
    showTextDocument: (...args: unknown[]) => ui.showTextDocument(...args),
  },
  commands: { executeCommand: (...args: unknown[]) => ui.executeCommand(...args) },
  workspace: {
    workspaceFolders: undefined as unknown,
    openTextDocument: async (uri: FakeUri) => ({ uri }),
    fs: {
      stat: async (uri: FakeUri) => ({ type: fs.statSync(uri.fsPath).isDirectory() ? 2 : 1 }),
      writeFile: async (uri: FakeUri, bytes: Uint8Array) => fs.writeFileSync(uri.fsPath, bytes),
    },
  },
}));

import { sidecarDataPath } from './data';
import { newDocument } from './new-document';

const EXTENSION = path.join(__dirname, '..');
const TEMPLATE_XML = fs.readFileSync(path.join(EXTENSION, 'templates', 'invoice', 'document.xml'), 'utf8');
const TEMPLATE_DATA = fs.readFileSync(path.join(EXTENSION, 'templates', 'invoice', 'document.json'), 'utf8');

let work: string;

/** Picks the first template in the list, and saves under `name` in the work folder. */
function choose(name: string): void {
  ui.showQuickPick.mockImplementation(async (items: unknown[]) => items[0]);
  ui.showSaveDialog.mockResolvedValue(fileUri(path.join(work, name)));
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-new-document-'));
  for (const mock of Object.values(ui)) { mock.mockReset(); }
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe('newDocument', () => {
  it('offers the templates by label, with their description', async () => {
    await newDocument(EXTENSION);
    const [items] = ui.showQuickPick.mock.calls[0] as [{ label: string; detail: string }[]];
    expect(items[0]).toMatchObject({ label: 'Invoice with data', detail: expect.stringContaining('JSON') });
  });

  it('writes the XML and its data next to it under the same name, then opens it with the preview', async () => {
    choose('acme.xml');
    const created = await newDocument(EXTENSION);
    expect(created?.fsPath).toBe(path.join(work, 'acme.xml'));
    expect(fs.readFileSync(path.join(work, 'acme.xml'), 'utf8')).toBe(TEMPLATE_XML);
    expect(fs.readFileSync(path.join(work, 'acme.json'), 'utf8')).toBe(TEMPLATE_DATA);
    expect(ui.showTextDocument).toHaveBeenCalled();
    expect(ui.executeCommand).toHaveBeenCalledWith('lpdf.previewPdf', created);
  });

  it('puts the data where the preview and export look for it without a link', async () => {
    choose('acme.xml');
    await newDocument(EXTENSION);
    expect(fs.existsSync(sidecarDataPath(path.join(work, 'acme.xml')))).toBe(true);
  });

  it('offers the template\'s file name in the folder of the Explorer item it was started from', async () => {
    fs.writeFileSync(path.join(work, 'notes.txt'), 'x');
    ui.showQuickPick.mockImplementation(async (items: unknown[]) => items[0]);
    await newDocument(EXTENSION, fileUri(work) as never);
    expect(ui.showSaveDialog.mock.calls[0][0].defaultUri.fsPath).toBe(path.join(work, 'invoice.xml'));
    await newDocument(EXTENSION, fileUri(path.join(work, 'notes.txt')) as never);
    expect(ui.showSaveDialog.mock.calls[1][0].defaultUri.fsPath).toBe(path.join(work, 'invoice.xml'));
  });

  it('asks before replacing a data file that is already there, and leaves it when told not to', async () => {
    fs.writeFileSync(path.join(work, 'acme.json'), '{"mine":true}');
    choose('acme.xml');
    ui.showWarningMessage.mockResolvedValue(undefined);
    expect(await newDocument(EXTENSION)).toBeUndefined();
    expect(ui.showWarningMessage.mock.calls[0][0]).toContain('acme.json');
    expect(fs.readFileSync(path.join(work, 'acme.json'), 'utf8')).toBe('{"mine":true}');
    expect(fs.existsSync(path.join(work, 'acme.xml'))).toBe(false);

    ui.showWarningMessage.mockResolvedValue('Replace');
    await newDocument(EXTENSION);
    expect(fs.readFileSync(path.join(work, 'acme.json'), 'utf8')).toBe(TEMPLATE_DATA);
  });

  it('creates nothing when the list or the save dialog is closed', async () => {
    ui.showQuickPick.mockResolvedValue(undefined);
    expect(await newDocument(EXTENSION)).toBeUndefined();
    expect(ui.showSaveDialog).not.toHaveBeenCalled();

    ui.showQuickPick.mockImplementation(async (items: unknown[]) => items[0]);
    ui.showSaveDialog.mockResolvedValue(undefined);
    expect(await newDocument(EXTENSION)).toBeUndefined();
    expect(fs.readdirSync(work)).toEqual([]);
  });

  it('says what is wrong when the templates cannot be read', async () => {
    expect(await newDocument(work)).toBeUndefined();
    expect(ui.showErrorMessage.mock.calls[0][0]).toMatch(/^Lpdf: The templates folder is missing/);
    expect(ui.showQuickPick).not.toHaveBeenCalled();
  });
});
