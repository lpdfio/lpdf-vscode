import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAssets, readNearby } from './assets';
import { LpdfRenderError } from './engine';
import {
  defaultTemplate, markdownImageName, prepareMarkdown, starterStyles, starterTemplate, stylePresets, STYLES_FILE_NAME,
  type StylePreset,
} from './markdown-engine';
import type { RenderInput } from './render-input';

const DOCUMENT_KEY_PREFIX = 'lpdf.markdownDocument:';
const STYLES_KEY_PREFIX = 'lpdf.markdownStyles:';

// Fired whenever a link is added, changed or removed, so the CodeLens of both its ends can refresh.
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

function stylesKey(markdownUri: vscode.Uri): string {
  return STYLES_KEY_PREFIX + markdownUri.toString();
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

/** The file of styles linked to a `.md` file, or undefined for the default styles. */
export function getLinkedStylesUri(context: vscode.ExtensionContext, markdownUri: vscode.Uri): vscode.Uri | undefined {
  const stored = context.workspaceState.get<string>(stylesKey(markdownUri));
  return stored ? vscode.Uri.parse(stored) : undefined;
}

/** Links a file of styles to a `.md` file, or with undefined takes the link away. */
export async function setLinkedStylesUri(
  context: vscode.ExtensionContext,
  markdownUri: vscode.Uri,
  stylesUri: vscode.Uri | undefined,
): Promise<void> {
  await context.workspaceState.update(stylesKey(markdownUri), stylesUri?.toString());
  _changeEmitter.fire();
}

/** Asks for a file of styles, and returns it, or undefined when the user cancelled. */
async function chooseStylesFile(markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.dirname(markdownUri.fsPath)),
    filters: { 'Lpdf Markdown styles': ['xml'] },
    openLabel: 'Link Styles',
    title: 'Choose the styles the Markdown file is rendered with',
  });
  return picked?.[0];
}

/** What a menu item stands for: a look to write beside the `.md` file, or the choice of a file of one's own. */
type StylesChoice = vscode.QuickPickItem & { preset?: StylePreset };

/**
 * Asks which styles a `.md` file is rendered with, a look to start from or a file of one's own, and links them.
 * @returns The styles, or undefined when the user cancelled or they could not be written.
 */
export async function promptLinkStylesFile(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const choices: StylesChoice[] = [
    ...stylePresets().map(preset => ({ label: preset.label, description: preset.description, preset })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: 'Choose a file...', description: 'Link an XML file of styles you have' },
  ];
  const choice = await vscode.window.showQuickPick(choices, {
    title: 'Link styles',
    placeHolder: 'A look is written beside the Markdown file, for you to edit',
  });
  if (!choice) { return undefined; }
  if (choice.preset) { return linkStylesPreset(context, markdownUri, choice.preset); }
  const styles = await chooseStylesFile(markdownUri);
  if (!styles) { return undefined; }
  await setLinkedStylesUri(context, markdownUri, styles);
  return styles;
}

/**
 * Writes a look beside a `.md` file as a file of styles of its own and links it to the file. It does not open it:
 * the preview shows the look, and the CodeLens of the styles opens the file to edit. A file that is already there
 * is left as it is, since it may have been edited, and linked.
 * @returns The styles, or undefined when they could not be written.
 */
export async function linkStylesPreset(
  context: vscode.ExtensionContext,
  markdownUri: vscode.Uri,
  preset: StylePreset,
): Promise<vscode.Uri | undefined> {
  const folder = path.dirname(markdownUri.fsPath);
  const fileName = `markdown-styles-${preset.name}.xml`;
  const stylesPath = path.join(folder, fileName);
  const existed = fs.existsSync(stylesPath);
  try {
    if (!existed) { await fs.promises.writeFile(stylesPath, preset.styles); }
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot write the styles to ${folder}: ${(error as Error).message}`);
    return undefined;
  }
  const stylesUri = vscode.Uri.file(stylesPath);
  await setLinkedStylesUri(context, markdownUri, stylesUri);
  if (existed) { void vscode.window.showInformationMessage(`Lpdf: ${fileName} is already there, so it is linked as it is.`); }
  return stylesUri;
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
 * document linked to the file, else the default template with the linked styles, else the default template.
 * @param context The extension, which remembers what is linked to the file.
 * @param uri The `.md` file.
 * @param text Its text, including unsaved edits.
 */
export async function loadMarkdownRenderInput(context: vscode.ExtensionContext, uri: vscode.Uri, text: string): Promise<RenderInput> {
  const documentUri = getLinkedDocumentUri(context, uri);
  if (documentUri) {
    return wrapMarkdown(uri, text, { template: await readText(documentUri), from: documentUri, files: [documentUri.fsPath] });
  }
  const stylesUri = getLinkedStylesUri(context, uri);
  if (stylesUri) {
    // The default template is not a file: its one path, the styles, is absolute.
    return wrapMarkdown(uri, text, { template: starterTemplate(stylesUri.fsPath), from: uri, files: [] });
  }
  return wrapMarkdown(uri, text, { template: null, from: uri, files: [] });
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
 * on the other side. The document is the default template, reading the linked styles if there are
 * any. A file already there is not overwritten.
 * @returns The document, or undefined when it could not be written.
 */
export async function createLpdfDocument(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = path.dirname(markdownUri.fsPath);
  const documentPath = path.join(folder, path.basename(markdownUri.fsPath, path.extname(markdownUri.fsPath)) + '.xml');
  if (fs.existsSync(documentPath)) {
    void vscode.window.showWarningMessage(
      `Lpdf: ${path.basename(documentPath)} is already there. Open it and run Lpdf: Link Markdown File... to render this file through it.`,
    );
    return undefined;
  }
  const stylesUri = getLinkedStylesUri(context, markdownUri);
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

/**
 * Writes the default styles beside a `.md` file, to start from, links them to the file and opens them as a tab in
 * the column of the `.md` file, so that the preview stays visible. A file that is already there is left as it is and
 * linked.
 * @returns The styles, or undefined when they could not be written.
 */
export async function createMarkdownStyles(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = path.dirname(markdownUri.fsPath);
  const stylesPath = path.join(folder, STYLES_FILE_NAME);
  try {
    if (!fs.existsSync(stylesPath)) { await fs.promises.writeFile(stylesPath, starterStyles()); }
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot write the styles to ${folder}: ${(error as Error).message}`);
    return undefined;
  }
  const stylesUri = vscode.Uri.file(stylesPath);
  await setLinkedStylesUri(context, markdownUri, stylesUri);
  await showWithSource(stylesUri, markdownUri);
  return stylesUri;
}
