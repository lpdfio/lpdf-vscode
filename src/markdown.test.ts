import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const openDocuments = vi.hoisted(() => [] as { uri: { toString(): string }; languageId: string }[]);
const visibleEditors = vi.hoisted(() => [] as { document: { uri: { toString(): string } }; viewColumn: number }[]);
const ui = vi.hoisted(() => ({
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showOpenDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showTextDocument: vi.fn(),
}));

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
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ViewColumn: { One: 1, Beside: -2 },
    workspace: {
      textDocuments: openDocuments,
      getWorkspaceFolder: () => undefined,
      openTextDocument: async (uri: unknown) => ({ uri }),
      fs: { readFile: async (uri: { fsPath: string }) => fs.promises.readFile(uri.fsPath) },
    },
    window: { ...ui, visibleTextEditors: visibleEditors },
  };
});
vi.mock('./engine', () => ({ LpdfRenderError: class extends Error {} }));

import * as vscode from 'vscode';
import {
  getLinkedDocumentUri, getLinkedMarkdownUri, getLinkedStylesUri, isMarkdownDocument, isMarkdownUri, loadMarkdownRenderInput,
  createLpdfDocument, createMarkdownStyles, promptLinkStylesFile, setLinkedDocumentUri, setLinkedStylesUri,
} from './markdown';
import { defaultTemplate, starterStyles, stylePresets } from './markdown-engine';
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

describe('Link Styles', () => {
  beforeEach(() => { Object.values(ui).forEach(fn => fn.mockReset()); });

  const pickPreset = (name: string): void => {
    ui.showQuickPick.mockImplementation(async (choices: { preset?: { name: string } }[]) => choices.find(c => c.preset?.name === name));
  };

  it('offers the looks, then the choice of a file of one\'s own', async () => {
    ui.showQuickPick.mockResolvedValue(undefined);
    await promptLinkStylesFile(context, uriOf('menu.md'));

    const choices = ui.showQuickPick.mock.calls[0][0] as { label: string; description?: string; kind?: number }[];
    expect(choices.map(c => c.label)).toEqual(['Sans', 'Serif', 'Typewriter', '', 'Choose a file...']);
    expect(choices[0].description).toBe(stylePresets()[0].description);
    expect(choices[3].kind).toBe(-1);
  });

  it('writes a look beside the file as styles of its own and links them, without opening them over the preview', async () => {
    pickPreset('typewriter');
    const written = path.join(folder, 'markdown-styles-typewriter.xml');

    const styles = await promptLinkStylesFile(context, uriOf('look.md'));

    expect(styles?.fsPath).toBe(written);
    expect(fs.readFileSync(written, 'utf8')).toBe(stylePresets().find(p => p.name === 'typewriter')?.styles);
    expect(getLinkedStylesUri(context, uriOf('look.md'))?.fsPath).toBe(written);
    expect(ui.showTextDocument).not.toHaveBeenCalled();
  });

  it('renders the file with the look, as the styles are read from the file written', async () => {
    pickPreset('serif');
    await promptLinkStylesFile(context, uriOf('serif.md'));

    const input = await loadMarkdownRenderInput(context, uriOf('serif.md'), '# Title\n');

    expect(input.xml).toContain(`<markdown-styles src="${path.join(folder, 'markdown-styles-serif.xml')}"/>`);
    expect(input.assets.markdownStyles?.get(path.join(folder, 'markdown-styles-serif.xml'))).toContain('Times-Roman');
  });

  describe('when the file of the look is already there', () => {
    const edited = '<markdown-styles><h1 color="#123456"/></markdown-styles>';
    const serif = (): string => path.join(folder, 'markdown-styles-serif.xml');
    const present = (name: string, text: string): void => { fs.writeFileSync(path.join(folder, name), text); };

    it('links it without a word when it is the look', async () => {
      pickPreset('serif');
      present('markdown-styles-serif.xml', stylePresets().find(p => p.name === 'serif')?.styles ?? '');

      await promptLinkStylesFile(context, uriOf('same.md'));

      expect(ui.showInformationMessage).not.toHaveBeenCalled();
      expect(getLinkedStylesUri(context, uriOf('same.md'))?.fsPath).toBe(serif());
    });

    it('asks, when it is another, whether to replace it, and replaces it on Replace', async () => {
      pickPreset('serif');
      present('markdown-styles-serif.xml', edited);
      ui.showInformationMessage.mockResolvedValue('Replace');

      await promptLinkStylesFile(context, uriOf('replace.md'));

      expect(ui.showInformationMessage.mock.calls[0][1]).toMatchObject({ modal: true });
      expect(fs.readFileSync(serif(), 'utf8')).toBe(stylePresets().find(p => p.name === 'serif')?.styles);
      expect(getLinkedStylesUri(context, uriOf('replace.md'))?.fsPath).toBe(serif());
    });

    it('leaves it as it is and links it on Keep mine', async () => {
      pickPreset('serif');
      present('markdown-styles-serif.xml', edited);
      ui.showInformationMessage.mockResolvedValue('Keep mine');

      await promptLinkStylesFile(context, uriOf('keep.md'));

      expect(fs.readFileSync(serif(), 'utf8')).toBe(edited);
      expect(getLinkedStylesUri(context, uriOf('keep.md'))?.fsPath).toBe(serif());
    });

    it('changes and links nothing when the user cancels', async () => {
      pickPreset('serif');
      present('markdown-styles-serif.xml', edited);
      ui.showInformationMessage.mockResolvedValue(undefined);

      expect(await promptLinkStylesFile(context, uriOf('cancelled.md'))).toBeUndefined();

      expect(fs.readFileSync(serif(), 'utf8')).toBe(edited);
      expect(getLinkedStylesUri(context, uriOf('cancelled.md'))).toBeUndefined();
    });
  });

  it('links the file the user chooses, when they choose one', async () => {
    ui.showQuickPick.mockImplementation(async (choices: { preset?: unknown }[]) => choices.find(c => !c.preset && (c as { label: string }).label !== ''));
    ui.showOpenDialog.mockResolvedValue([uriOf('mine.xml')]);

    const styles = await promptLinkStylesFile(context, uriOf('own.md'));

    expect(styles?.fsPath).toBe(uriOf('mine.xml').fsPath);
    expect(getLinkedStylesUri(context, uriOf('own.md'))?.fsPath).toBe(uriOf('mine.xml').fsPath);
  });

  it('changes nothing when the user cancels the menu or the dialog', async () => {
    const before = fs.readdirSync(folder);
    ui.showQuickPick.mockResolvedValue(undefined);
    expect(await promptLinkStylesFile(context, uriOf('cancel.md'))).toBeUndefined();

    ui.showQuickPick.mockImplementation(async (choices: { preset?: unknown; label: string }[]) => choices.find(c => !c.preset && c.label !== ''));
    ui.showOpenDialog.mockResolvedValue(undefined);
    expect(await promptLinkStylesFile(context, uriOf('cancel.md'))).toBeUndefined();

    expect(getLinkedStylesUri(context, uriOf('cancel.md'))).toBeUndefined();
    expect(fs.readdirSync(folder)).toEqual(before);
  });
});

describe('the files written for a .md file', () => {
  beforeEach(() => {
    Object.values(ui).forEach(fn => fn.mockReset());
    visibleEditors.length = 0;
  });

  /** The .md file is open in a column, as it is when its preview is on the other side. */
  const openIn = (name: string, viewColumn: number): void => {
    visibleEditors.push({ document: { uri: uriOf(name) }, viewColumn });
  };
  const openedIn = (): unknown => (ui.showTextDocument.mock.calls[0][1] as { viewColumn: number }).viewColumn;

  it('are the default styles, linked and opened as a tab in the column of the .md file, not over its preview', async () => {
    openIn('written.md', 3);

    const styles = await createMarkdownStyles(context, uriOf('written.md'));

    expect(styles?.fsPath).toBe(path.join(folder, 'markdown-styles.xml'));
    expect(fs.readFileSync(path.join(folder, 'markdown-styles.xml'), 'utf8')).toBe(starterStyles());
    expect(getLinkedStylesUri(context, uriOf('written.md'))?.fsPath).toBe(styles?.fsPath);
    expect(openedIn()).toBe(3);
  });

  it('are a document named after the .md file, linked and opened in the column of the .md file', async () => {
    openIn('named.md', 2);

    const document = await createLpdfDocument(context, uriOf('named.md'));

    expect(document?.fsPath).toBe(path.join(folder, 'named.xml'));
    expect(fs.readFileSync(path.join(folder, 'named.xml'), 'utf8')).toBe(defaultTemplate());
    expect(getLinkedDocumentUri(context, uriOf('named.md'))?.fsPath).toBe(document?.fsPath);
    expect(openedIn()).toBe(2);
  });

  it('open in the first column when the .md file is not open in an editor', async () => {
    await createLpdfDocument(context, uriOf('closed.md'));
    expect(openedIn()).toBe(1);
  });

  it('are not written over a document that is already there', async () => {
    fs.writeFileSync(path.join(folder, 'taken.xml'), '<lpdf/>');

    expect(await createLpdfDocument(context, uriOf('taken.md'))).toBeUndefined();

    expect(fs.readFileSync(path.join(folder, 'taken.xml'), 'utf8')).toBe('<lpdf/>');
    expect(ui.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('already there'));
    expect(ui.showTextDocument).not.toHaveBeenCalled();
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
