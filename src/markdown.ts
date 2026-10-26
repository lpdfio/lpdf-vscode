import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAssets, readNearby } from './assets';
import { markdownImageName, prepareMarkdown, starterStyles, starterTemplate, STYLES_FILE_NAME, TEMPLATE_FILE_NAME } from './markdown-engine';
import type { RenderInput } from './render-input';

const TEMPLATE_KEY_PREFIX = 'lpdf.markdownTemplate:';

/** Whether a file is Markdown, by its extension. */
export function isMarkdownUri(uri: vscode.Uri): boolean {
  return /\.(?:md|markdown)$/i.test(uri.fsPath);
}

/** Whether a document is Markdown, by its language or its file name. */
export function isMarkdownDocument(doc: vscode.TextDocument): boolean {
  return doc.languageId === 'markdown' || isMarkdownUri(doc.uri);
}

function templateKey(markdownUri: vscode.Uri): string {
  return TEMPLATE_KEY_PREFIX + markdownUri.toString();
}

/** The template linked to a `.md` file with **Lpdf: Link Markdown Template...**, or undefined for the default one. */
export function getLinkedTemplateUri(context: vscode.ExtensionContext, markdownUri: vscode.Uri): vscode.Uri | undefined {
  const stored = context.workspaceState.get<string>(templateKey(markdownUri));
  return stored ? vscode.Uri.parse(stored) : undefined;
}

/** Links a template to a `.md` file, or with undefined takes the link away. */
export async function setLinkedTemplateUri(
  context: vscode.ExtensionContext,
  markdownUri: vscode.Uri,
  templateUri: vscode.Uri | undefined,
): Promise<void> {
  await context.workspaceState.update(templateKey(markdownUri), templateUri?.toString());
}

/** Asks which XML file is the template of a `.md` file, and links it. Returns it, or undefined when the user cancelled. */
export async function promptLinkTemplateFile(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.dirname(markdownUri.fsPath)),
    filters: { 'Lpdf template': ['xml'] },
    openLabel: 'Link Template',
    title: 'Choose the template the Markdown file is rendered in',
  });
  const template = picked?.[0];
  if (!template) { return undefined; }
  await setLinkedTemplateUri(context, markdownUri, template);
  return template;
}

/** The text of a template: its open editor's, with unsaved edits, or else the file's. */
async function readTemplate(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
  if (open) { return open.getText(); }
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

/**
 * What a `.md` file renders from: the text and the front matter as the data of its template, the template
 * with the images of the Markdown declared in it, and the files they and the template name.
 * @param context The extension, which remembers the template linked to the file.
 * @param uri The `.md` file.
 * @param text Its text, including unsaved edits.
 */
export async function loadMarkdownRenderInput(context: vscode.ExtensionContext, uri: vscode.Uri, text: string): Promise<RenderInput> {
  const templateUri = getLinkedTemplateUri(context, uri);
  const template = templateUri ? await readTemplate(templateUri) : null;
  const prepared = prepareMarkdown(text, template);

  // The template names its own files, and means them next to itself: the logo of a branded template is
  // beside it, not beside the Markdown. The default template names none.
  const loaded = template !== null && templateUri
    ? await loadAssets(template, templateUri)
    : { assets: { fonts: new Map(), images: new Map(), markdownStyles: new Map() }, warnings: [] as string[], files: [] as string[] };

  // The images of the Markdown are named as the Markdown writes them: next to the .md file.
  const files = [...loaded.files];
  for (const [index, src] of prepared.images.entries()) {
    const { bytes, file } = await readNearby(`image '${src}'`, src, uri);
    loaded.assets.images.set(markdownImageName(index), bytes);
    files.push(file);
  }
  if (templateUri) { files.push(templateUri.fsPath); }

  return { xml: prepared.xml, jsonData: prepared.jsonData, assets: loaded.assets, warnings: loaded.warnings, files };
}

/**
 * Writes the default template and the default styles beside a `.md` file, to start from, links the template
 * to the file, and opens it. A file that is already there is left as it is.
 * @returns The template, or undefined when it could not be written.
 */
export async function createMarkdownTemplate(context: vscode.ExtensionContext, markdownUri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const folder = path.dirname(markdownUri.fsPath);
  const templatePath = path.join(folder, TEMPLATE_FILE_NAME);
  const stylesPath = path.join(folder, STYLES_FILE_NAME);
  try {
    if (!fs.existsSync(templatePath)) { await fs.promises.writeFile(templatePath, starterTemplate(STYLES_FILE_NAME)); }
    if (!fs.existsSync(stylesPath))   { await fs.promises.writeFile(stylesPath, starterStyles()); }
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: cannot write the template to ${folder}: ${(error as Error).message}`);
    return undefined;
  }
  const templateUri = vscode.Uri.file(templatePath);
  await setLinkedTemplateUri(context, markdownUri, templateUri);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(templateUri), { preview: false, viewColumn: vscode.ViewColumn.Beside });
  return templateUri;
}
