import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The starters that **Lpdf: New Document** offers. Each is a folder in `templates/`:
 *
 *   templates/<id>/template.json   { "label", "description", "fileName", "order"? }
 *   templates/<id>/document.xml    the document
 *   templates/<id>/document.json   its data, if it has any; saved next to the new document under its
 *                                  name, where the preview and export find data without a link
 *   templates/<id>/assets/...      the fonts and images it names, if any; saved next to the new document under
 *                                  the same relative paths, which is where its <font src> and <image src> look
 *   templates/<id>/preview.png     a picture of it, if there is one; not shown yet
 *
 * Adding a template is adding a folder: nothing else lists them.
 */

/** Thrown for a template folder that is not usable; the message names the folder and what is wrong. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

export interface DocumentTemplate {
  /** The folder's name. */
  id: string;
  /** What the list of templates shows. */
  label: string;
  /** One line under the label. */
  description: string;
  /** The name a new document is offered under, without `.xml`. */
  fileName: string;
  /** Where it goes in the list: lower first; then by label. */
  order: number;
  /** The template's XML. */
  xmlPath: string;
  /** Its data, if it has any. */
  dataPath?: string;
  /** A picture of it, if there is one. */
  previewPath?: string;
  /** The files of its `assets/` folder, if it has one. */
  assets: TemplateAsset[];
}

/** One file of a template's `assets/` folder. */
export interface TemplateAsset {
  /** Where it goes next to the new document, with `/` between folders: `assets/fonts/Brand.ttf`. */
  relativePath: string;
  /** Where it is in the extension. */
  sourcePath: string;
}

const MANIFEST = 'template.json';
const DOCUMENT_XML = 'document.xml';
const DOCUMENT_DATA = 'document.json';
const PREVIEW = 'preview.png';
const ASSETS_FOLDER = 'assets';
const DEFAULT_ORDER = 100;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const LPDF_ROOT = /<lpdf[\s>]/;

/**
 * Reads every template in a folder.
 * @param templatesDir The `templates/` folder of the extension.
 * @returns The templates, in the order the list shows them.
 * @throws {TemplateError} When the folder is missing or a template in it is not usable.
 */
export function loadTemplates(templatesDir: string): DocumentTemplate[] {
  if (!fs.existsSync(templatesDir)) { throw new TemplateError(`The templates folder is missing: ${templatesDir}`); }
  const templates = fs.readdirSync(templatesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadTemplate(path.join(templatesDir, entry.name)));
  return templates.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function loadTemplate(folder: string): DocumentTemplate {
  const id = path.basename(folder);
  const manifestPath = path.join(folder, MANIFEST);
  if (!fs.existsSync(manifestPath)) { throw new TemplateError(`Template ${id}: ${MANIFEST} is missing`); }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new TemplateError(`Template ${id}: ${MANIFEST} is not JSON: ${(error as Error).message}`);
  }
  const text = (key: string): string => {
    const value = manifest[key];
    if (typeof value !== 'string' || value.trim() === '') { throw new TemplateError(`Template ${id}: "${key}" must be a non-empty text`); }
    return value;
  };
  const label = text('label');
  const description = text('description');
  const fileName = text('fileName');
  if (!FILE_NAME.test(fileName)) { throw new TemplateError(`Template ${id}: "fileName" must be a plain name: letters, digits, - and _, without a folder or .xml`); }
  const order = manifest.order ?? DEFAULT_ORDER;
  if (typeof order !== 'number') { throw new TemplateError(`Template ${id}: "order" must be a number`); }

  const xmlPath = path.join(folder, DOCUMENT_XML);
  if (!fs.existsSync(xmlPath)) { throw new TemplateError(`Template ${id}: ${DOCUMENT_XML} is missing`); }
  if (!LPDF_ROOT.test(fs.readFileSync(xmlPath, 'utf8'))) { throw new TemplateError(`Template ${id}: ${DOCUMENT_XML} has no <lpdf> root element`); }

  const dataPath = path.join(folder, DOCUMENT_DATA);
  const hasData = fs.existsSync(dataPath);
  if (hasData) {
    try {
      JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
      throw new TemplateError(`Template ${id}: ${DOCUMENT_DATA} is not JSON: ${(error as Error).message}`);
    }
  }
  const previewPath = path.join(folder, PREVIEW);
  return {
    id, label, description, fileName, order, xmlPath,
    dataPath: hasData ? dataPath : undefined,
    previewPath: fs.existsSync(previewPath) ? previewPath : undefined,
    assets: listAssets(path.join(folder, ASSETS_FOLDER), ASSETS_FOLDER),
  };
}

/** Every file under a template's assets folder, in a stable order; none when it has no such folder. */
function listAssets(folder: string, relative: string): TemplateAsset[] {
  if (!fs.existsSync(folder)) { return []; }
  return fs.readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory()
      ? listAssets(path.join(folder, entry.name), `${relative}/${entry.name}`)
      : [{ relativePath: `${relative}/${entry.name}`, sourcePath: path.join(folder, entry.name) }]);
}
