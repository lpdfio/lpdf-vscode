import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAssets, readNearby } from './assets';
import { LpdfRenderError } from './engine';
import {
  defaultTemplate, markdownImageName, prepareMarkdown, starterTemplate, stylePresets, type StylePreset,
} from './markdown-engine';
import type { RenderInput } from './render-input';

const DOCUMENT_KEY_PREFIX = 'lpdf.markdownDocument:';

// Fired whenever a link is added, changed or removed, so the CodeLens of both its ends can refresh. A file of styles
// is its own link, so it is fired when one is written or deleted here; the CodeLens also watches for one made elsewhere.
const _changeEmitter = new vscode.EventEmitter<void>();
export const onDidChangeMarkdownLinks: vscode.Event<void> = _changeEmitter.event;

/**
 * Whether a file is Markdown: by its extension, or, when it is open, by the language the editor shows it in, so
 * that a file such as LICENSE that is Markdown by the user's settings is rendered as Markdown, not read as XML.
 */
export function isMarkdownUri(uri: vscode.Uri): boolean {
  if (/\.(?:md|markdown)$/i.test(uri.fsPath)) { return true; }
  const wanted = uri.toString();
  return vscode.workspace.textDocuments.some(doc => doc.languageId === 'markdown' && doc.uri.toString() === wanted);
}

/** Whether a document is Markdown, by its language or its file name. */
export function isMarkdownDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'markdown' || isMarkdownUri(doc.uri);
}

function documentKey(markdownUri: vscode.Uri): string {
  return DOCUMENT_KEY_PREFIX + markdownUri.toString();
}

/** The Lpdf document a `.md` file is rendered through, or undefined for the default one. */
export function getLinkedDocumentUri(context: vscode.ExtensionContext, markdownUri: vscode.Uri): vscode.Uri | undefined {
  const stored = context.workspaceState.get<string>(documentKey(markdownUri));
  return stored ? vscode.Uri.parse(stored) : undefined;
}

/** The `.md` file that is the body of an Lpdf document, or undefined when it has none. */
export function getLinkedMarkdownUri(context: vscode.ExtensionContext, documentUri: vscode.Uri): vscode.Uri | undefined {
  const wanted = documentUri.toString();
  for (const key of context.workspaceState.keys()) {
    if (key.startsWith(DOCUMENT_KEY_PREFIX) && context.workspaceState.get<string>(key) === wanted) {
      return vscode.Uri.parse(key.slice(DOCUMENT_KEY_PREFIX.length));
    }
  }
  return undefined;
}

/**
 * Links a `.md` file and an Lpdf document, one to one: each has the other and no more. A `.md` file linked to
 * another document, and another `.md` file linked to this document, are let go. With undefined the `.md` file
 * goes back to the default one.
 */
export async function setLinkedDocumentUri(
  context: vscode.ExtensionContext,
  markdownUri: vscode.Uri,
  documentUri: vscode.Uri | undefined,
): Promise<void> {
  const taken = documentUri ? getLinkedMarkdownUri(context, documentUri) : undefined;
  if (taken && taken.toString() !== markdownUri.toString()) {
    await context.workspaceState.update(documentKey(taken), undefined);
  }
  await context.workspaceState.update(documentKey(markdownUri), documentUri?.toString());
  _changeEmitter.fire();
}

/** The path of a file named like a `.md` file, with another extension, in its folder. */
function beside(markdownPath: string, extension: string): string {
  return path.join(path.dirname(markdownPath), path.basename(markdownPath, path.extname(markdownPath)) + extension);
}

/**
 * Where the styles of a `.md` file are: a `.styles.xml` file next to it, under the same name, as the data of an XML
 * file is its `.data.json`. The file is the link: it is found by its name, so it goes where the folder goes.
 * @param markdownPath The `.md` file.
 * @returns The path of its `.styles.xml`.
 */
export function sidecarStylesPath(markdownPath: string): string {
  return beside(markdownPath, '.styles.xml');
}

/** The file of styles of a `.md` file, or undefined for the default styles: the one next to it, when there is one. */
export function getLinkedStylesUri(markdownUri: vscode.Uri): vscode.Uri | undefined {
  const stylesPath = sidecarStylesPath(markdownUri.fsPath);
  return fs.existsSync(stylesPath) ? vscode.Uri.file(stylesPath) : undefined;
}

/** What a menu item stands for: a look to write next to the `.md` file. */
type StylesChoice = vscode.QuickPickItem & { preset: StylePreset };

/**
 * Asks which look a `.md` file is rendered with, and writes it next to the file as its styles. A file that is there
 * is written over without a question: the author edits the styles from then on, and links another look by choosing
 * it, so the menu says when it replaces a file.
 * @returns The styles, or undefined when the user cancelled or they could not be written.
 */
export async function promptLinkStyles(markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const stylesPath = sidecarStylesPath(markdownUri.fsPath);
  const name = path.basename(stylesPath);
  const choices: StylesChoice[] = stylePresets().map(preset => ({ label: preset.label, description: preset.description, preset }));
  const choice = await vscode.window.showQuickPick(choices, {
    title: 'Link styles',
    placeHolder: fs.existsSync(stylesPath) ? `${name} is replaced by the look you choose` : `The look is written to ${name}, for you to edit`,
  });
  return choice ? writeStyles(stylesPath, choice.preset) : undefined;
}

/**
 * Writes a look as the styles of a `.md` file, over the file that is there. It does not open it: the preview shows
 * the look, and the CodeLens of the styles opens the file to edit.
 * @returns The styles, or undefined when they could not be written.
 */
async function writeStyles(stylesPath: string, preset: StylePreset): Promise<vscode.Uri | undefined> {
  try {
    await fs.promises.writeFile(stylesPath, preset.styles);
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot write the styles to ${path.dirname(stylesPath)}: ${(error as Error).message}`);
    return undefined;
  }
  _changeEmitter.fire();
  return vscode.Uri.file(stylesPath);
}

const DELETE = 'Delete';

/**
 * Takes the styles away from a `.md` file: asks, then deletes the file next to it, which is the link. A file that
 * stayed but was not used would leave the author wondering why their styles do nothing.
 * @returns Whether the styles are gone, which is not so when the user cancelled or the file could not be deleted.
 */
export async function unlinkStyles(markdownUri: vscode.Uri): Promise<boolean> {
  const stylesPath = sidecarStylesPath(markdownUri.fsPath);
  const name = path.basename(stylesPath);
  const answer = await vscode.window.showWarningMessage(
    `Lpdf: Delete ${name}?`,
    { modal: true, detail: `${path.basename(markdownUri.fsPath)} is then rendered with the default styles. What you changed in ${name} is lost.` },
    DELETE,
  );
  if (answer !== DELETE) { return false; }
  try {
    await fs.promises.rm(stylesPath, { force: true });
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot delete ${stylesPath}: ${(error as Error).message}`);
    return false;
  }
  _changeEmitter.fire();
  return true;
}

/** Asks which `.md` file is the body of an Lpdf document, and links it. Returns it, or undefined when the user cancelled. */
export async function promptLinkMarkdownFile(context: vscode.ExtensionContext, documentUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.dirname(documentUri.fsPath)),
    filters: { Markdown: ['md', 'markdown'] },
    openLabel: 'Link Markdown',
    title: 'Choose the Markdown file that is the body of the document',
  });
  const markdown = picked?.[0];
  if (!markdown) { return undefined; }
  await setLinkedDocumentUri(context, markdown, documentUri);
  return markdown;
}

/** The text of a file: its open editor's, with unsaved edits, or else the file's. */
async function readText(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
  if (open) { return open.getText(); }
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch (error) {
    throw new LpdfRenderError(`cannot read ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What a `.md` file is wrapped in, and where the paths that wrapper writes are looked up from. */
interface Wrapper {
  /** The text of the template, or null for the default one. */
  template: string | null;
  /** The file the template's relative paths (images, fonts, styles) are written next to. */
  from: vscode.Uri;
  /** The files the template itself was read from, which the preview watches. */
  files: string[];
}

/** The text of a `.md` file wrapped in `wrapper`, with the files and images that takes. */
async function wrapMarkdown(markdownUri: vscode.Uri, markdown: string, wrapper: Wrapper): Promise<RenderInput> {
  const prepared = prepareMarkdown(markdown, wrapper.template);

  // The template names its own files, and means them next to itself: the logo of a branded template is
  // beside it, not beside the Markdown. The default template names none.
  const loaded = wrapper.template !== null
    ? await loadAssets(wrapper.template, wrapper.from)
    : { assets: { fonts: new Map(), images: new Map(), markdownStyles: new Map() }, warnings: [] as string[], files: [] as string[] };

  // The images of the Markdown are named as the Markdown writes them: next to the .md file.
  const files = [...loaded.files, ...wrapper.files];
  for (const [index, src] of prepared.images.entries()) {
    const { bytes, file } = await readNearby(`image '${src}'`, src, markdownUri);
    loaded.assets.images.set(markdownImageName(index), bytes);
    files.push(file);
  }

  return { xml: prepared.xml, jsonData: prepared.jsonData, assets: loaded.assets, warnings: loaded.warnings, files };
}

/**
 * What a `.md` file renders from: the text and the front matter as the data of its wrapper, the wrapper with
 * the images of the Markdown declared in it, and the files they and the wrapper name. The wrapper is the Lpdf
 * document linked to the file, else the default template with the styles next to the file, else the default template.
 * @param context The extension, which remembers the Lpdf document linked to the file.
 * @param uri The `.md` file.
 * @param text Its text, including unsaved edits.
 */
export async function loadMarkdownRenderInput(context: vscode.ExtensionContext, uri: vscode.Uri, text: string): Promise<RenderInput> {
  const documentUri = getLinkedDocumentUri(context, uri);
  if (documentUri) {
    return wrapMarkdown(uri, text, { template: await readText(documentUri), from: documentUri, files: [documentUri.fsPath] });
  }
  const stylesUri = getLinkedStylesUri(uri);
  if (stylesUri) {
    // The default template is not a file: its one path, the styles, is absolute.
    return wrapMarkdown(uri, text, { template: starterTemplate(stylesUri.fsPath), from: uri, files: [] });
  }
  // Watched though it is not there, so that styles written next to the file are rendered when they appear.
  return wrapMarkdown(uri, text, { template: null, from: uri, files: [sidecarStylesPath(uri.fsPath)] });
}

/**
 * What an Lpdf document renders from when a `.md` file is linked to it: the document, with the Markdown as its
 * data. It is the same input as the `.md` file's own, seen from the document.
 * @param documentUri The Lpdf document.
 * @param documentText Its text, including unsaved edits.
 * @param markdownUri The `.md` file linked to it.
 * @throws LpdfRenderError when the `.md` file cannot be read.
 */
export async function loadLinkedMarkdownRenderInput(
  documentUri: vscode.Uri,
  documentText: string,
  markdownUri: vscode.Uri,
): Promise<RenderInput> {
  const markdown = await readText(markdownUri);
  return wrapMarkdown(markdownUri, markdown, { template: documentText, from: documentUri, files: [markdownUri.fsPath] });
}

/** The path of a file as an XML `src` next to `folder`: relative with `/`, or absolute where there is no relative one. */
function srcFrom(folder: string, file: string): string {
  const relative = path.relative(folder, file);
  return path.isAbsolute(relative) ? file : relative.split(path.sep).join('/');
}

/**
 * Opens a file in the column of the source file it was written for, as a tab, so that the preview, which is in the
 * other column, stays visible: the sources are on one side to edit and the PDF on the other.
 */
async function showWithSource(uri: vscode.Uri, source: vscode.Uri): Promise<void> {
  const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === source.toString());
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false, viewColumn: editor?.viewColumn ?? vscode.ViewColumn.One });
}

/**
 * Writes an Lpdf document beside a `.md` file, named after it, to set the page and wrap the Markdown in, links
 * the two and opens the document as a tab beside the `.md` file's, in its column, so that the preview stays visible
 * on the other side. The document is the default template, reading the styles next to the `.md` file if there are
 * any. A file already there is not overwritten.
 * @returns The document, or undefined when it could not be written.
 */
export async function createLpdfDocument(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = path.dirname(markdownUri.fsPath);
  const documentPath = beside(markdownUri.fsPath, '.xml');
  if (fs.existsSync(documentPath)) {
    void vscode.window.showWarningMessage(
      `Lpdf: ${path.basename(documentPath)} is already there. Open it and run Lpdf: Link Markdown File... to render this file through it.`,
    );
    return undefined;
  }
  const stylesUri = getLinkedStylesUri(markdownUri);
  try {
    await fs.promises.writeFile(documentPath, stylesUri ? starterTemplate(srcFrom(folder, stylesUri.fsPath)) : defaultTemplate());
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot write the document to ${folder}: ${(error as Error).message}`);
    return undefined;
  }
  const documentUri = vscode.Uri.file(documentPath);
  await setLinkedDocumentUri(context, markdownUri, documentUri);
  await showWithSource(documentUri, markdownUri);
  return documentUri;
}
