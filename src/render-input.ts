import * as vscode from 'vscode';
import { loadAssets } from './assets';
import { getLinkedDataJson } from './data';
import type { RenderAssets } from './engine';
import { getLinkedMarkdownUri, isMarkdownUri, loadLinkedMarkdownRenderInput, loadMarkdownRenderInput } from './markdown';

/** Everything the engine needs to render a document the extension was given, XML or Markdown. */
export interface RenderInput {
  /** The document for the engine: the XML itself, or the template a `.md` file is wrapped in. */
  xml:      string;
  /** The data its `data-*` attributes read, if it has any. */
  jsonData: string | null;
  /** The bytes of its fonts and images and the text of its files of rules. */
  assets:   RenderAssets;
  /** What the user should be told that did not stop the render. */
  warnings: string[];
  /** The files that were read to make the input, which the preview watches. */
  files:    string[];
}

/**
 * Reads what a document renders from. An XML document is the engine's input as it is, with the data linked to it,
 * or with the `.md` file linked to it as its data; a `.md` file is wrapped in a template (see
 * `loadMarkdownRenderInput`).
 * @param context The extension.
 * @param uri The document.
 * @param text Its text, including unsaved edits.
 * @throws LpdfRenderError when a file it names cannot be read.
 */
export async function loadRenderInput(context: vscode.ExtensionContext, uri: vscode.Uri, text: string): Promise<RenderInput> {
  if (isMarkdownUri(uri)) { return loadMarkdownRenderInput(context, uri, text); }
  const markdownUri = getLinkedMarkdownUri(context, uri);
  if (markdownUri) { return loadLinkedMarkdownRenderInput(uri, text, markdownUri); }
  const { assets, warnings, files } = await loadAssets(text, uri);
  return { xml: text, jsonData: getLinkedDataJson(context, uri), assets, warnings, files };
}
