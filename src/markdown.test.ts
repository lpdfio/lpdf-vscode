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
  createLpdfDocument, promptLinkStyles, setLinkedDocumentUri, sidecarStylesPath, unlinkStyles,
} from './markdown';
import { defaultTemplate, stylePresets } from './markdown-engine';
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

describe('a .md file with no styles next to it', () => {
  it('is wrapped in the default template, with its text as the data, and watches where its styles would be', async () => {
    const input = await loadMarkdownRenderInput(context, uriOf('plain.md'), '# Title\n');
    expect(input.xml).toContain('size="a4"');
    expect(JSON.parse(input.jsonData ?? '{}')).toEqual({ markdown: '# Title\n' });
    expect(input.files).toEqual([path.join(folder, 'plain.styles.xml')]);
  });
});

describe('the styles of a .md file', () => {
  it('are the .styles.xml next to it, under its name, whatever its extension', () => {
    expect(sidecarStylesPath(path.join('docs', 'notes.md'))).toBe(path.join('docs', 'notes.styles.xml'));
    expect(sidecarStylesPath(path.join('docs', 'README.markdown'))).toBe(path.join('docs', 'README.styles.xml'));
    expect(sidecarStylesPath(path.join('docs', 'LICENSE'))).toBe(path.join('docs', 'LICENSE.styles.xml'));
    expect(sidecarStylesPath(path.join('docs', 'v1.2.md'))).toBe(path.join('docs', 'v1.2.styles.xml'));
  });

  it('are found by that name with no link made: the file is wrapped in the default template naming them, and they are read and watched', async () => {
    const styles = path.join(folder, 'styled.styles.xml');
    fs.writeFileSync(styles, STYLES);

    expect(getLinkedStylesUri(uriOf('styled.md'))?.fsPath).toBe(styles);
    const input = await loadMarkdownRenderInput(context, uriOf('styled.md'), '# Title\n');

    expect(input.xml).toContain(`<markdown-styles src="${styles}"/>`);
    expect(input.xml).toContain('size="a4"');
    expect(input.assets.markdownStyles?.get(styles)).toBe(STYLES);
    expect(input.files).toContain(styles);
  });

  it('are not found under another name: another file\'s, or a file that is not named for the .md file', () => {
    for (const name of ['other.styles.xml', 'mine-styles.xml', 'markdown-styles.xml', 'mine.xml', 'mine.md.xml']) {
      fs.writeFileSync(path.join(folder, name), STYLES);
    }
    expect(getLinkedStylesUri(uriOf('mine.md'))).toBeUndefined();
  });
});

describe('Link Styles', () => {
  beforeEach(() => { Object.values(ui).forEach(fn => fn.mockReset()); });

  const pickPreset = (name: string): void => {
    ui.showQuickPick.mockImplementation(async (choices: { preset?: { name: string } }[]) => choices.find(c => c.preset?.name === name));
  };
  const presetStyles = (name: string): string | undefined => stylePresets().find(p => p.name === name)?.styles;

  it('offers the three looks and nothing else, and says where the look is written', async () => {
    ui.showQuickPick.mockResolvedValue(undefined);
    await promptLinkStyles(uriOf('menu.md'));

    const choices = ui.showQuickPick.mock.calls[0][0] as { label: string; description?: string }[];
    expect(choices.map(c => c.label)).toEqual(['Sans', 'Serif', 'Typewriter']);
    expect(choices[0].description).toBe(stylePresets()[0].description);
    expect(ui.showQuickPick.mock.calls[0][1].placeHolder).toContain('menu.styles.xml');
  });

  it('writes a look next to the file as its styles, which are its link, without opening them over the preview', async () => {
    pickPreset('typewriter');
    const written = path.join(folder, 'look.styles.xml');

    const styles = await promptLinkStyles(uriOf('look.md'));

    expect(styles?.fsPath).toBe(written);
    expect(fs.readFileSync(written, 'utf8')).toBe(presetStyles('typewriter'));
    expect(getLinkedStylesUri(uriOf('look.md'))?.fsPath).toBe(written);
    expect(ui.showTextDocument).not.toHaveBeenCalled();
  });

  it('renders the file with the look, as the styles are read from the file written', async () => {
    pickPreset('serif');
    await promptLinkStyles(uriOf('serif.md'));

    const input = await loadMarkdownRenderInput(context, uriOf('serif.md'), '# Title\n');

    const written = path.join(folder, 'serif.styles.xml');
    expect(input.xml).toContain(`<markdown-styles src="${written}"/>`);
    expect(input.assets.markdownStyles?.get(written)).toContain('Times-Roman');
  });

  it('writes the look over the styles that are there, without asking, and says so in the menu', async () => {
    const written = path.join(folder, 'again.styles.xml');
    fs.writeFileSync(written, '<markdown-styles><h1 color="#123456"/></markdown-styles>');
    pickPreset('serif');

    await promptLinkStyles(uriOf('again.md'));

    expect(ui.showQuickPick.mock.calls[0][1].placeHolder).toContain('is replaced');
    expect(fs.readFileSync(written, 'utf8')).toBe(presetStyles('serif'));
    expect(ui.showWarningMessage).not.toHaveBeenCalled();
    expect(ui.showInformationMessage).not.toHaveBeenCalled();
  });

  it('changes nothing when the user cancels the menu', async () => {
    const before = fs.readdirSync(folder);
    ui.showQuickPick.mockResolvedValue(undefined);

    expect(await promptLinkStyles(uriOf('cancel.md'))).toBeUndefined();

    expect(fs.readdirSync(folder)).toEqual(before);
  });

  it('says so when the styles cannot be written', async () => {
    fs.mkdirSync(path.join(folder, 'blocked.styles.xml'));
    pickPreset('sans');

    expect(await promptLinkStyles(uriOf('blocked.md'))).toBeUndefined();

    expect(ui.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('cannot write the styles'));
  });
});

describe('Unlink Styles', () => {
  beforeEach(() => { Object.values(ui).forEach(fn => fn.mockReset()); });

  it('asks, then deletes the styles next to the file, so that it is rendered with the default ones', async () => {
    const styles = path.join(folder, 'bye.styles.xml');
    fs.writeFileSync(styles, STYLES);
    ui.showWarningMessage.mockResolvedValue('Delete');

    expect(await unlinkStyles(uriOf('bye.md'))).toBe(true);

    expect(ui.showWarningMessage.mock.calls[0][0]).toContain('bye.styles.xml');
    expect(ui.showWarningMessage.mock.calls[0][1]).toMatchObject({ modal: true });
    expect(fs.existsSync(styles)).toBe(false);
    expect(getLinkedStylesUri(uriOf('bye.md'))).toBeUndefined();
    const input = await loadMarkdownRenderInput(context, uriOf('bye.md'), '# Title\n');
    expect(input.xml).not.toContain('<markdown-styles src=');
  });

  it('leaves the styles when the user cancels', async () => {
    const styles = path.join(folder, 'stay.styles.xml');
    fs.writeFileSync(styles, STYLES);
    ui.showWarningMessage.mockResolvedValue(undefined);

    expect(await unlinkStyles(uriOf('stay.md'))).toBe(false);

    expect(fs.readFileSync(styles, 'utf8')).toBe(STYLES);
  });

  it('says so when the styles cannot be deleted', async () => {
    fs.mkdirSync(path.join(folder, 'stuck.styles.xml'));
    ui.showWarningMessage.mockResolvedValue('Delete');

    expect(await unlinkStyles(uriOf('stuck.md'))).toBe(false);

    expect(ui.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('cannot delete'));
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

  it('are a document named after the .md file, linked and opened in the column of the .md file', async () => {
    openIn('named.md', 2);

    const document = await createLpdfDocument(context, uriOf('named.md'));

    expect(document?.fsPath).toBe(path.join(folder, 'named.xml'));
    expect(fs.readFileSync(path.join(folder, 'named.xml'), 'utf8')).toBe(defaultTemplate());
    expect(getLinkedDocumentUri(context, uriOf('named.md'))?.fsPath).toBe(document?.fsPath);
    expect(openedIn()).toBe(2);
  });

  it('are a document that names the styles next to the .md file, when there are', async () => {
    fs.writeFileSync(path.join(folder, 'branded.styles.xml'), STYLES);

    await createLpdfDocument(context, uriOf('branded.md'));

    expect(fs.readFileSync(path.join(folder, 'branded.xml'), 'utf8')).toContain('<markdown-styles src="branded.styles.xml"/>');
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

  it('is rendered through the document even when styles are next to it too', async () => {
    const document = path.join(folder, 'both.xml');
    fs.writeFileSync(document, DOCUMENT);
    fs.writeFileSync(path.join(folder, 'both.styles.xml'), STYLES);
    await setLinkedDocumentUri(context, uriOf('both.md'), vscode.Uri.file(document));

    const input = await loadMarkdownRenderInput(context, uriOf('both.md'), '# Title\n');

    expect(input.xml).toContain('size="letter"');
    expect(input.xml).not.toContain('both.styles.xml');
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
