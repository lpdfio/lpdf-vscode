import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => {
  class Uri {
    constructor(readonly fsPath: string) {}
    static file(fsPath: string): Uri { return new Uri(fsPath); }
    static parse(text: string): Uri { return new Uri(text.replace(/^file:\/\//, '')); }
    toString(): string { return `file://${this.fsPath}`; }
  }
  return { Uri, EventEmitter: class { event = () => ({ dispose() {} }); fire(): void {} }, window: {} };
});

import * as vscode from 'vscode';
import { getLinkedDataJson, getLinkedDataUri, setLinkedDataUri, sidecarDataPath, unlinkDataUri } from './data';

/** A workspaceState that keeps its values in memory. */
function memento(): { get: <T>(key: string) => T | undefined; update: (key: string, value: unknown) => Promise<void> } {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => { if (value === undefined) { values.delete(key); } else { values.set(key, value); } },
  };
}

let folder: string;
let context: vscode.ExtensionContext;

const uriOf = (name: string): vscode.Uri => vscode.Uri.file(path.join(folder, name));
const write = (name: string, text: string): void => fs.writeFileSync(path.join(folder, name), text);

beforeAll(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-data-')); });
afterAll(() => { fs.rmSync(folder, { recursive: true, force: true }); });
beforeEach(() => { context = { workspaceState: memento() } as unknown as vscode.ExtensionContext; });

describe('the data of an XML document', () => {
  it('is the .data.json next to it, under its name', () => {
    expect(sidecarDataPath(path.join('docs', 'invoice.xml'))).toBe(path.join('docs', 'invoice.data.json'));
  });

  it('is found by that name with no link made, and read', () => {
    write('found.data.json', '{"a":1}');

    expect(getLinkedDataUri(context, uriOf('found.xml'))?.fsPath).toBe(path.join(folder, 'found.data.json'));
    expect(getLinkedDataJson(context, uriOf('found.xml'))).toBe('{"a":1}');
  });

  it('is not found under the old name, a .json with no .data in it', () => {
    write('old.json', '{"a":1}');

    expect(getLinkedDataUri(context, uriOf('old.xml'))).toBeUndefined();
    expect(getLinkedDataJson(context, uriOf('old.xml'))).toBeNull();
  });

  it('is the file linked to the document, whatever it is named, in place of the one by name', async () => {
    write('linked.data.json', '{"by":"name"}');
    write('mine.json', '{"by":"link"}');
    await setLinkedDataUri(context, uriOf('linked.xml'), uriOf('mine.json'));

    expect(getLinkedDataUri(context, uriOf('linked.xml'))?.fsPath).toBe(path.join(folder, 'mine.json'));
    expect(getLinkedDataJson(context, uriOf('linked.xml'))).toBe('{"by":"link"}');
  });

  it('is none once the document is unlinked, until a file is linked again', async () => {
    write('off.data.json', '{"a":1}');

    await unlinkDataUri(context, uriOf('off.xml'));
    expect(getLinkedDataUri(context, uriOf('off.xml'))).toBeUndefined();

    await setLinkedDataUri(context, uriOf('off.xml'), uriOf('off.data.json'));
    expect(getLinkedDataUri(context, uriOf('off.xml'))?.fsPath).toBe(path.join(folder, 'off.data.json'));
  });
});
