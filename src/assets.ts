import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LpdfRenderError, type RenderAssets } from './engine';

/** One `<font>` or `<image>` declared in `<assets>`. */
interface AssetDeclaration {
  kind: 'font' | 'image';
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
}

const COMMENT_RE    = /<!--[\s\S]*?-->/g;
const ASSETS_RE     = /<assets\b[^>]*>([\s\S]*?)<\/assets\s*>/g;
// Attribute values may contain '>', so quoted runs are matched whole.
const ASSET_TAG_RE  = /<(font|image)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE_RE  = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY_RE     = /&(amp|lt|gt|quot|apos);/g;
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Two or more characters before the colon, so a Windows drive letter is not a scheme.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Reads the bytes of every font and image the XML declares in `<assets>`, so
 * the extension renders what the SDKs render when they load `src` themselves.
 *
 * A relative `src` is looked up next to the XML file first, then in the root of
 * its workspace folder. The SDKs resolve it against the app's working
 * directory, which is usually the project root.
 *
 * @param xml    The document text, including unsaved edits.
 * @param xmlUri The document's location, used to resolve relative `src` paths.
 * @returns The loaded bytes, and a warning for each custom font with no `src`.
 * @throws LpdfRenderError when an image has no `src`, or any `src` cannot be read.
 *   The engine would reject the image anyway, and a font would silently become
 *   Helvetica.
 */
export async function loadAssets(xml: string, xmlUri: vscode.Uri): Promise<LoadedAssets> {
  const dirs     = searchDirs(xmlUri);
  const fonts    = new Map<string, Uint8Array>();
  const images   = new Map<string, Uint8Array>();
  const warnings: string[] = [];

  for (const asset of parseAssetDeclarations(xml)) {
    if (asset.kind === 'font') {
      if (asset.core) { continue; }
      if (!asset.src) {
        warnings.push(`Font '${asset.name}' has no src, so it renders as Helvetica.`);
        continue;
      }
      fonts.set(asset.key, await readAsset(asset, asset.src, dirs));
    } else {
      if (!asset.src) {
        throw new LpdfRenderError(`image '${asset.name}' has no src. The extension loads images from the file path in src.`);
      }
      images.set(asset.key, await readAsset(asset, asset.src, dirs));
    }
  }

  return { assets: { fonts, images }, warnings };
}

/** Folders a relative `src` resolves against: the XML file's own, then its workspace folder's. */
function searchDirs(xmlUri: vscode.Uri): string[] {
  const dirs: string[] = [];
  if (xmlUri.scheme === 'file') { dirs.push(path.dirname(xmlUri.fsPath)); }
  const root = vscode.workspace.getWorkspaceFolder(xmlUri)?.uri;
  if (root?.scheme === 'file' && !dirs.includes(root.fsPath)) { dirs.push(root.fsPath); }
  return dirs;
}

async function readAsset(asset: AssetDeclaration, src: string, dirs: string[]): Promise<Uint8Array> {
  const label = `${asset.kind} '${asset.name}'`;

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
      return await fs.promises.readFile(file);
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
