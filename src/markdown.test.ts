import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const openDocuments = vi.hoisted(() => [] as { uri: { toString(): string }; languageId: string }[]);

vi.mock('vscode', () => {
  class Uri {
    readonly scheme = 'file';
    constructor(readonly fsPath: string) {}
    static file(fsPath: string): Uri { return new Uri(fsPath); }
    static parse(text: string): Uri { return new Uri(text.replace(/^file:\/\//, '')); }
    toString(): string { return `file://${this.fsPath}`; }
  }
  return {
    Uri,
    EventEmitter: class { event = () => ({ dispose() {} }); fire(): void {} },
    workspace: {
      textDocuments: openDocuments,
      getWorkspaceFolder: () => undefined,
      fs: { readFile: async (uri: { fsPath: string }) => fs.promises.readFile(uri.fsPath) },
    },
    window: {},
  };
});
vi.mock('./engine', () => ({ LpdfRenderError: class extends Error {} }));

import * as vscode from 'vscode';
import {
  getLinkedDocumentUri, getLinkedMarkdownUri, getLinkedStylesUri, isMarkdownDocument, isMarkdownUri, loadMarkdownRenderInput,
  setLinkedDocumentUri, setLinkedStylesUri,
} from './markdown';
import { loadRenderInput } from './render-input';

/** A workspaceState that keeps its values in memory. */
function memento(): { get: <T>(key: string) => T | undefined; update: (key: string, value: unknown) => Promise<void>; keys: () => string[] } {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => { if (value === undefined) { values.delete(key); } else { values.set(key, value); } },
    keys: () => [...values.keys()],
  };
}

let folder: string;
let context: vscode.ExtensionContext;

const uriOf = (name: string): vscode.Uri => vscode.Uri.file(path.join(folder, name));

beforeAll(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-markdown-')); });
afterAll(() => { fs.rmSync(folder, { recursive: true, force: true }); });
beforeEach(() => { context = { workspaceState: memento() } as unknown as vscode.ExtensionContext; });

const STYLES = '<markdown-styles><h1 color="#ff0000"/></markdown-styles>';
const DOCUMENT = '<lpdf version="1"><document size="letter"><section><markdown><markdown-content data-value="markdown"/></markdown></section></document></lpdf>';

describe('which files are Markdown', () => {
  beforeEach(() => { openDocuments.length = 0; });

  const open = (name: string, languageId: string): vscode.TextDocument => {
    const doc = { uri: uriOf(name), languageId } as vscode.TextDocument;
    openDocuments.push(doc);
    return doc;
  };

  it('are those named .md or .markdown, in any case', () => {
    for (const name of ['notes.md', 'README.markdown', 'NOTES.MD']) {
      expect(isMarkdownUri(uriOf(name)), name).toBe(true);
    }
  });

  it('are those the editor shows as Markdown, whatever they are named', () => {
    const license = open('LICENSE', 'markdown');
    expect(isMarkdownUri(license.uri)).toBe(true);
    expect(isMarkdownDocument(license)).toBe(true);
  });

  it('are not other files, or the same name when it is not open in Markdown mode', () => {
    expect(isMarkdownUri(uriOf('LICENSE'))).toBe(false);
    expect(isMarkdownDocument(open('notes.txt', 'plaintext'))).toBe(false);
  });

  it('are rendered as Markdown, not read as XML, when they are named otherwise', async () => {
    fs.writeFileSync(path.join(folder, 'LICENSE'), '# License\n');
    const license = open('LICENSE', 'markdown');

    const input = await loadRenderInput(context, license.uri, '# License\n');

    expect(input.xml).toContain('<markdown');
    expect(JSON.parse(input.jsonData ?? '{}')).toEqual({ markdown: '# License\n' });
  });
});

describe('a .md file with nothing linked', () => {
  it('is wrapped in the default template, with its text as the data', async () => {
    const input = await loadMarkdownRenderInput(context, uriOf('plain.md'), '# Title\n');
    expect(input.xml).toContain('size="a4"');
    expect(JSON.parse(input.jsonData ?? '{}')).toEqual({ markdown: '# Title\n' });
    expect(input.files).toEqual([]);
  });
});

describe('a .md file with styles linked', () => {
  it('is wrapped in the default template naming the styles, which are read and watched', async () => {
    const styles = path.join(folder, 'brand-styles.xml');
    fs.writeFileSync(styles, STYLES);
    await setLinkedStylesUri(context, uriOf('styled.md'), vscode.Uri.file(styles));

    const input = await loadMarkdownRenderInput(context, uriOf('styled.md'), '# Title\n');

    expect(input.xml).toContain(`<markdown-styles src="${styles}"/>`);
    expect(input.xml).toContain('size="a4"');
    expect(input.assets.markdownStyles?.get(styles)).toBe(STYLES);
    expect(input.files).toContain(styles);
  });

  it('is an error that names the file when the styles are not there', async () => {
    await setLinkedStylesUri(context, uriOf('gone.md'), uriOf('missing-styles.xml'));
    await expect(loadMarkdownRenderInput(context, uriOf('gone.md'), '# Title\n')).rejects.toThrow(/missing-styles\.xml/);
  });

  it('goes back to the default styles when they are unlinked', async () => {
    await setLinkedStylesUri(context, uriOf('styled.md'), uriOf('brand-styles.xml'));
    await setLinkedStylesUri(context, uriOf('styled.md'), undefined);
    expect(getLinkedStylesUri(context, uriOf('styled.md'))).toBeUndefined();
  });
});

describe('a .md file with an Lpdf document linked', () => {
  it('is wrapped in the document, which is watched', async () => {
    const document = path.join(folder, 'report.xml');
    fs.writeFileSync(document, DOCUMENT);
    await setLinkedDocumentUri(context, uriOf('report.md'), vscode.Uri.file(document));

    const input = await loadMarkdownRenderInput(context, uriOf('report.md'), '# Title\n');

    expect(input.xml).toContain('size="letter"');
    expect(JSON.parse(input.jsonData ?? '{}')).toEqual({ markdown: '# Title\n' });
    expect(input.files).toContain(document);
  });

  it('is rendered through the document even when styles are linked too', async () => {
    const document = path.join(folder, 'both.xml');
    fs.writeFileSync(document, DOCUMENT);
    await setLinkedDocumentUri(context, uriOf('both.md'), vscode.Uri.file(document));
    await setLinkedStylesUri(context, uriOf('both.md'), uriOf('ignored-styles.xml'));

    const input = await loadMarkdownRenderInput(context, uriOf('both.md'), '# Title\n');

    expect(input.xml).toContain('size="letter"');
    expect(input.xml).not.toContain('ignored-styles.xml');
  });
});

describe('the link between a .md file and an Lpdf document', () => {
  it('is found from either end', async () => {
    await setLinkedDocumentUri(context, uriOf('a.md'), uriOf('a.xml'));
    expect(getLinkedDocumentUri(context, uriOf('a.md'))?.fsPath).toBe(uriOf('a.xml').fsPath);
    expect(getLinkedMarkdownUri(context, uriOf('a.xml'))?.fsPath).toBe(uriOf('a.md').fsPath);
  });

  it('is one to one: a second .md file takes the document from the first', async () => {
    await setLinkedDocumentUri(context, uriOf('first.md'), uriOf('shared.xml'));
    await setLinkedDocumentUri(context, uriOf('second.md'), uriOf('shared.xml'));
    expect(getLinkedDocumentUri(context, uriOf('first.md'))).toBeUndefined();
    expect(getLinkedMarkdownUri(context, uriOf('shared.xml'))?.fsPath).toBe(uriOf('second.md').fsPath);
  });

  it('is one to one: linking a .md file to another document lets the first one go', async () => {
    await setLinkedDocumentUri(context, uriOf('a.md'), uriOf('one.xml'));
    await setLinkedDocumentUri(context, uriOf('a.md'), uriOf('two.xml'));
    expect(getLinkedMarkdownUri(context, uriOf('one.xml'))).toBeUndefined();
    expect(getLinkedMarkdownUri(context, uriOf('two.xml'))?.fsPath).toBe(uriOf('a.md').fsPath);
  });

  it('is gone from both ends when the .md file is unlinked', async () => {
    await setLinkedDocumentUri(context, uriOf('a.md'), uriOf('a.xml'));
    await setLinkedDocumentUri(context, uriOf('a.md'), undefined);
    expect(getLinkedDocumentUri(context, uriOf('a.md'))).toBeUndefined();
    expect(getLinkedMarkdownUri(context, uriOf('a.xml'))).toBeUndefined();
  });

  it('does not mistake a linked file of styles for a document', async () => {
    await setLinkedStylesUri(context, uriOf('a.md'), uriOf('a.xml'));
    expect(getLinkedMarkdownUri(context, uriOf('a.xml'))).toBeUndefined();
  });
});

describe('an Lpdf document with a .md file linked', () => {
  it('renders the Markdown as its data, and watches the .md file', async () => {
    fs.writeFileSync(path.join(folder, 'body.md'), '# From the file\n');
    await setLinkedDocumentUri(context, uriOf('body.md'), uriOf('page.xml'));

    const input = await loadRenderInput(context, uriOf('page.xml'), DOCUMENT);

    expect(input.xml).toBe(DOCUMENT);
    expect(JSON.parse(input.jsonData ?? '{}')).toEqual({ markdown: '# From the file\n' });
    expect(input.files).toContain(path.join(folder, 'body.md'));
  });

  it('reads the images of the Markdown next to the .md file, not next to the document', async () => {
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.mkdirSync(path.join(folder, 'notes', 'img'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'notes', 'img', 'a.png'), pixel);
    fs.writeFileSync(path.join(folder, 'notes', 'body.md'), '![a](img/a.png)\n');
    await setLinkedDocumentUri(context, vscode.Uri.file(path.join(folder, 'notes', 'body.md')), uriOf('elsewhere.xml'));

    const input = await loadRenderInput(context, uriOf('elsewhere.xml'), DOCUMENT);

    expect(input.xml).toContain('<image name="markdown-image-1" src="img/a.png"/>');
    expect(Buffer.from(input.assets.images.get('markdown-image-1') ?? []).equals(pixel)).toBe(true);
  });

  it('is an error that names the file when the .md file is not there', async () => {
    await setLinkedDocumentUri(context, uriOf('deleted.md'), uriOf('orphan.xml'));
    await expect(loadRenderInput(context, uriOf('orphan.xml'), DOCUMENT)).rejects.toThrow(/deleted\.md/);
  });

  it('is the XML as it is when no .md file is linked', async () => {
    const input = await loadRenderInput(context, uriOf('alone.xml'), DOCUMENT);
    expect(input.xml).toBe(DOCUMENT);
    expect(input.jsonData).toBeNull();
  });
});
