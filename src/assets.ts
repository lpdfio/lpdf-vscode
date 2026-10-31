import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LpdfRenderError, type RenderAssets } from './engine';

/**
 * One `<font>` or `<image>` declared in `<assets>`, one file of rules a `<markdown-styles>` names, or one `<file>`
 * the document carries in `<attachments>`.
 */
interface AssetDeclaration {
  kind: 'font' | 'image' | 'markdown-styles' | 'file';
  name: string;
  /** Key the engine looks the bytes up by: `ref`, else `name`. */
  key:  string;
  src:  string | undefined;
  core: string | undefined;
}

/** The bytes to load into the engine, plus what the user should be told about. */
export interface LoadedAssets {
  assets:   RenderAssets;
  /** Declarations the extension can't load but that still render, as Helvetica. */
  warnings: string[];
  /** The files that were read, which the preview watches so that it follows an edit of any of them. */
  files:    string[];
}

const COMMENT_RE    = /<!--[\s\S]*?-->/g;
const ASSETS_RE     = /<assets\b[^>]*>([\s\S]*?)<\/assets\s*>/g;
// Attribute values may contain '>', so quoted runs are matched whole.
const ASSET_TAG_RE  = /<(font|image)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const STYLES_TAG_RE = /<markdown-styles\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTACHMENTS_RE = /<attachments\b[^>]*>([\s\S]*?)<\/attachments\s*>/g;
const FILE_TAG_RE   = /<file\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE_RE  = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY_RE     = /&(amp|lt|gt|quot|apos);/g;
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Two or more characters before the colon, so a Windows drive letter is not a scheme.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Reads the bytes of every font and image the XML declares in `<assets>`, the text of every file of
 * Markdown rules a `<markdown-styles src>` names, and the bytes of every file it carries in `<attachments>`,
 * so the extension renders what the SDKs render when they load `src` themselves.
 *
 * A relative `src` is looked up next to the XML file first, then in the root of
 * its workspace folder. The SDKs resolve it against the app's working
 * directory, which is usually the project root.
 *
 * @param xml    The document text, including unsaved edits.
 * @param xmlUri The document's location, used to resolve relative `src` paths.
 * @returns The loaded bytes, and a warning for each custom font with no `src`.
 * @throws LpdfRenderError when an image or a file has no `src`, or any `src` cannot be read.
 *   The engine would reject the image anyway, and a font would silently become
 *   Helvetica.
 */
export async function loadAssets(xml: string, xmlUri: vscode.Uri): Promise<LoadedAssets> {
  const dirs     = searchDirs(xmlUri);
  const fonts    = new Map<string, Uint8Array>();
  const images   = new Map<string, Uint8Array>();
  const markdownStyles = new Map<string, string>();
  const attached = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const files: string[] = [];

  for (const asset of parseAssetDeclarations(xml)) {
    if (asset.kind === 'font') {
      if (asset.core) { continue; }
      if (!asset.src) {
        warnings.push(`Font '${asset.name}' has no src, so it renders as Helvetica.`);
        continue;
      }
      fonts.set(asset.key, await readAsset(asset, asset.src, dirs, files));
    } else if (asset.kind === 'markdown-styles') {
      markdownStyles.set(asset.key, Buffer.from(await readAsset(asset, asset.src!, dirs, files)).toString('utf8'));
    } else if (asset.kind === 'file') {
      if (!asset.src) {
        throw new LpdfRenderError(`file '${asset.name}' has no src. The extension loads the files a document carries from the file path in src.`);
      }
      attached.set(asset.key, await readAsset(asset, asset.src, dirs, files));
    } else {
      if (!asset.src) {
        throw new LpdfRenderError(`image '${asset.name}' has no src. The extension loads images from the file path in src.`);
      }
      images.set(asset.key, await readAsset(asset, asset.src, dirs, files));
    }
  }

  return { assets: { fonts, images, markdownStyles, files: attached }, warnings, files };
}

/**
 * Reads a file a document names with a relative path, looking where an asset's `src` is looked for: next to
 * the document, then in the root of its workspace folder.
 * @param label What the file is, for the error that says it is not there.
 * @param src The path as written.
 * @param uri The document the path is written in.
 * @returns The bytes, and the file they were read from.
 */
export async function readNearby(label: string, src: string, uri: vscode.Uri): Promise<{ bytes: Uint8Array; file: string }> {
  const files: string[] = [];
  const bytes = await readAsset({ kind: 'image', name: label, key: label, src, core: undefined }, src, searchDirs(uri), files, label);
  return { bytes, file: files[0] };
}

/** Folders a relative `src` resolves against: the XML file's own, then its workspace folder's. */
function searchDirs(xmlUri: vscode.Uri): string[] {
  const dirs: string[] = [];
  if (xmlUri.scheme === 'file') { dirs.push(path.dirname(xmlUri.fsPath)); }
  const root = vscode.workspace.getWorkspaceFolder(xmlUri)?.uri;
  if (root?.scheme === 'file' && !dirs.includes(root.fsPath)) { dirs.push(root.fsPath); }
  return dirs;
}

async function readAsset(asset: AssetDeclaration, src: string, dirs: string[], read: string[], what?: string): Promise<Uint8Array> {
  const label = what ?? `${asset.kind} '${asset.name}'`;

  let candidates: string[];
  if (src.startsWith('file:')) {
    candidates = [vscode.Uri.parse(src).fsPath];
  } else if (URL_SCHEME_RE.test(src)) {
    throw new LpdfRenderError(`${label}: src must be a file path. The extension does not download ${src}`);
  } else if (path.isAbsolute(src)) {
    candidates = [src];
  } else if (dirs.length === 0) {
    throw new LpdfRenderError(`${label}: cannot resolve ${src} until the XML file is saved to a folder.`);
  } else {
    candidates = dirs.map(dir => path.join(dir, src));
  }

  for (const file of candidates) {
    try {
      const bytes = await fs.promises.readFile(file);
      read.push(file);
      return bytes;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new LpdfRenderError(`${label}: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  throw new LpdfRenderError(`${label}: cannot find ${src}. Looked for ${candidates.join(' and ')}.`);
}

function parseAssetDeclarations(xml: string): AssetDeclaration[] {
  const declarations: AssetDeclaration[] = [];
  const source = xml.replace(COMMENT_RE, '');
  for (const block of source.matchAll(ASSETS_RE)) {
    for (const tag of block[1].matchAll(ASSET_TAG_RE)) {
      const attributes = parseAttributes(tag[2]);
      const name = attributes.get('name');
      if (!name) { continue; } // the engine reports the missing name
      declarations.push({
        kind: tag[1] as 'font' | 'image',
        name,
        key:  attributes.get('ref') ?? name,
        src:  attributes.get('src') || undefined,
        core: attributes.get('core'),
      });
    }
  }
  for (const block of source.matchAll(ATTACHMENTS_RE)) {
    for (const tag of block[1].matchAll(FILE_TAG_RE)) {
      const attributes = parseAttributes(tag[1]);
      const name = attributes.get('name');
      if (!name) { continue; } // the engine reports the missing name
      declarations.push({ kind: 'file', name, key: attributes.get('ref') ?? name, src: attributes.get('src') || undefined, core: undefined });
    }
  }
  for (const tag of source.matchAll(STYLES_TAG_RE)) {
    const src = parseAttributes(tag[1]).get('src');
    if (src) { declarations.push({ kind: 'markdown-styles', name: src, key: src, src, core: undefined }); }
  }
  return declarations;
}

function parseAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE_RE)) {
    const value = match[2] ?? match[3];
    attributes.set(match[1], value.replace(ENTITY_RE, (_, entity: string) => XML_ENTITIES[entity]));
  }
  return attributes;
}
