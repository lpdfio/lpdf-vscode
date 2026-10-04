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
      // As VS Code's does, this makes the folders on the way.
      writeFile: async (uri: FakeUri, bytes: Uint8Array) => {
        fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
        fs.writeFileSync(uri.fsPath, bytes);
      },
      readFile: async (uri: FakeUri) => fs.readFileSync(uri.fsPath),
    },
  },
}));

import { sidecarDataPath } from './data';
import { newDocument } from './new-document';

const TEMPLATE_XML = '<lpdf version="1"><document><section><layout><text>Hello</text></layout></section></document></lpdf>';
const TEMPLATE_DATA = '{"name":"Ada"}';
const FONT = Buffer.from([0, 1, 0, 0, 7, 7]);
const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);

let work: string;
/** A stand-in for the extension's folder, with one template that has data and assets, so these tests do not depend on the examples that ship. */
let EXTENSION: string;

function writeTemplate(root: string): void {
  const folder = path.join(root, 'templates', 'starter');
  fs.mkdirSync(path.join(folder, 'assets', 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'template.json'), JSON.stringify({
    label: 'Starter', description: 'A document with data, a font and an image', fileName: 'starter',
  }));
  fs.writeFileSync(path.join(folder, 'document.xml'), TEMPLATE_XML);
  fs.writeFileSync(path.join(folder, 'document.json'), TEMPLATE_DATA);
  fs.writeFileSync(path.join(folder, 'assets', 'fonts', 'Face.ttf'), FONT);
  fs.writeFileSync(path.join(folder, 'assets', 'images', 'logo.png'), IMAGE);
}

/** Picks the first template in the list, and saves under `name` in the work folder. */
function choose(name: string): void {
  ui.showQuickPick.mockImplementation(async (items: unknown[]) => items[0]);
  ui.showSaveDialog.mockResolvedValue(fileUri(path.join(work, name)));
}

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-new-document-'));
  EXTENSION = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-extension-'));
  writeTemplate(EXTENSION);
  for (const mock of Object.values(ui)) { mock.mockReset(); }
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(EXTENSION, { recursive: true, force: true });
});

describe('newDocument', () => {
  it('offers the templates by label, with their description', async () => {
    await newDocument(EXTENSION);
    const [items] = ui.showQuickPick.mock.calls[0] as [{ label: string; detail: string }[]];
    expect(items[0]).toMatchObject({ label: 'Starter', detail: expect.stringContaining('data') });
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
    expect(ui.showSaveDialog.mock.calls[0][0].defaultUri.fsPath).toBe(path.join(work, 'starter.xml'));
    await newDocument(EXTENSION, fileUri(path.join(work, 'notes.txt')) as never);
    expect(ui.showSaveDialog.mock.calls[1][0].defaultUri.fsPath).toBe(path.join(work, 'starter.xml'));
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

  it('puts the fonts and images where the XML names them, in an assets folder next to it', async () => {
    choose('acme.xml');
    await newDocument(EXTENSION);
    expect(fs.readFileSync(path.join(work, 'assets', 'fonts', 'Face.ttf')).equals(FONT)).toBe(true);
    expect(fs.readFileSync(path.join(work, 'assets', 'images', 'logo.png')).equals(IMAGE)).toBe(true);
  });

  it('leaves assets that are there already and the same, without asking', async () => {
    fs.mkdirSync(path.join(work, 'assets', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(work, 'assets', 'fonts', 'Face.ttf'), FONT);
    choose('acme.xml');
    await newDocument(EXTENSION);
    expect(ui.showWarningMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(work, 'assets', 'images', 'logo.png'))).toBe(true);
  });

  it('asks before replacing an asset that differs, and writes nothing when told not to', async () => {
    fs.mkdirSync(path.join(work, 'assets', 'images'), { recursive: true });
    fs.writeFileSync(path.join(work, 'assets', 'images', 'logo.png'), 'mine');
    choose('acme.xml');
    ui.showWarningMessage.mockResolvedValue(undefined);
    expect(await newDocument(EXTENSION)).toBeUndefined();
    expect(ui.showWarningMessage.mock.calls[0][0]).toContain('assets/images/logo.png');
    expect(fs.readFileSync(path.join(work, 'assets', 'images', 'logo.png'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(work, 'acme.xml'))).toBe(false);

    ui.showWarningMessage.mockResolvedValue('Replace');
    await newDocument(EXTENSION);
    expect(fs.readFileSync(path.join(work, 'assets', 'images', 'logo.png')).equals(IMAGE)).toBe(true);
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
