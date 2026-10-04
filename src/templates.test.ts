import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTemplates, TemplateError } from './templates';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const ENGINE = path.join(__dirname, '..', 'wasm', 'lpdf.js');

let work: string;

function writeTemplate(id: string, manifest: unknown, xml = '<lpdf version="1"></lpdf>', data?: string): void {
  const folder = path.join(work, id);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'template.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, 'document.xml'), xml);
  if (data !== undefined) { fs.writeFileSync(path.join(folder, 'document.json'), data); }
}

const VALID = { label: 'Letter', description: 'A letter', fileName: 'letter' };

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-templates-'));
});

afterEach(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

describe('loadTemplates', () => {
  it('reads a template folder, with its data and without a preview', () => {
    writeTemplate('letter', VALID, undefined, '{"to":"Ada"}');
    const [template] = loadTemplates(work);
    expect(template).toMatchObject({ id: 'letter', label: 'Letter', fileName: 'letter', order: 100 });
    expect(template.dataPath).toBe(path.join(work, 'letter', 'document.json'));
    expect(template.previewPath).toBeUndefined();
  });

  it('leaves the data off a template that has none', () => {
    writeTemplate('blank', VALID);
    expect(loadTemplates(work)[0].dataPath).toBeUndefined();
  });

  it('lists by order, then by label', () => {
    writeTemplate('c', { ...VALID, label: 'Zeta' });
    writeTemplate('b', { ...VALID, label: 'Alpha' });
    writeTemplate('a', { ...VALID, label: 'Last', order: 200 });
    writeTemplate('d', { ...VALID, label: 'First', order: 1 });
    expect(loadTemplates(work).map(template => template.label)).toEqual(['First', 'Alpha', 'Zeta', 'Last']);
  });

  it('ignores loose files next to the template folders', () => {
    writeTemplate('letter', VALID);
    fs.writeFileSync(path.join(work, 'README.md'), 'notes');
    expect(loadTemplates(work)).toHaveLength(1);
  });

  it.each([
    ['a manifest that is not JSON', 'not json'],
    ['a missing label', { description: 'x', fileName: 'x' }],
    ['an empty description', { ...VALID, description: ' ' }],
    ['a file name with a folder in it', { ...VALID, fileName: 'docs/letter' }],
    ['a file name with .xml on it', { ...VALID, fileName: 'letter.xml' }],
    ['an order that is not a number', { ...VALID, order: 'first' }],
  ])('rejects %s, naming the template', (_case, manifest) => {
    writeTemplate('broken', manifest);
    expect(() => loadTemplates(work)).toThrow(TemplateError);
    expect(() => loadTemplates(work)).toThrow(/Template broken/);
  });

  it('rejects a document without an <lpdf> root, and data that is not JSON', () => {
    writeTemplate('noroot', VALID, '<document/>');
    expect(() => loadTemplates(work)).toThrow(/no <lpdf> root/);
    fs.rmSync(path.join(work, 'noroot'), { recursive: true });
    writeTemplate('baddata', VALID, undefined, '{ not json');
    expect(() => loadTemplates(work)).toThrow(/document.json is not JSON/);
  });

  it('rejects a folder without a manifest, and a missing templates folder', () => {
    fs.mkdirSync(path.join(work, 'empty'));
    expect(() => loadTemplates(work)).toThrow(/template.json is missing/);
    expect(() => loadTemplates(path.join(work, 'nowhere'))).toThrow(TemplateError);
  });
});

describe('assets', () => {
  it('lists the files under the assets folder of a template, with the path they go to next to the document', () => {
    writeTemplate('book', VALID);
    fs.mkdirSync(path.join(work, 'book', 'assets', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(work, 'book', 'assets', 'fonts', 'Face.ttf'), 'f');
    fs.writeFileSync(path.join(work, 'book', 'assets', 'logo.png'), 'p');
    const [template] = loadTemplates(work);
    expect(template.assets.map(asset => asset.relativePath)).toEqual(['assets/fonts/Face.ttf', 'assets/logo.png']);
    expect(fs.readFileSync(template.assets[0].sourcePath, 'utf8')).toBe('f');
  });

  it('lists none for a template without an assets folder', () => {
    writeTemplate('letter', VALID);
    expect(loadTemplates(work)[0].assets).toEqual([]);
  });
});

/** The files a document names with src, outside its comments: relative paths only. */
function namedFiles(xml: string): string[] {
  return [...withoutComments(xml).matchAll(/\bsrc="([^"]+)"/g)].map(match => match[1]).filter(src => !/^[a-z]+:|^\//i.test(src));
}

function withoutComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/** A path as the XML writes it, with / between folders. */
function forwardSlashes(src: string): string {
  return src.replace(/\\/g, '/');
}

describe('the templates that ship in the extension', () => {
  const templates = loadTemplates(TEMPLATES_DIR);

  it('are the seven examples, from the letter to the book', () => {
    expect(templates.map(template => template.id)).toEqual([
      'admission-letter', 'resume', 'invoice', 'report', 'installment-contract', 'brochure', 'book',
    ]);
  });

  it('include the invoice with its data', () => {
    const invoice = templates.find(template => template.id === 'invoice');
    expect(invoice).toMatchObject({ label: 'Invoice', fileName: 'invoice' });
    expect(invoice?.dataPath).toBeDefined();
  });

  it('carry every font and image their XML names', () => {
    for (const template of templates) {
      const present = new Set(template.assets.map(asset => asset.relativePath));
      for (const src of namedFiles(fs.readFileSync(template.xmlPath, 'utf8'))) {
        expect(present.has(forwardSlashes(src)), `${template.id}: ${src}`).toBe(true);
      }
    }
  });

  it('carry the licence of every font they embed', () => {
    for (const template of templates) {
      const fonts = template.assets.filter(asset => /\.(ttf|otf)$/i.test(asset.relativePath));
      for (const font of fonts) {
        const folder = path.posix.dirname(font.relativePath);
        const licences = template.assets.filter(asset => path.posix.dirname(asset.relativePath) === folder && /^OFL/i.test(path.posix.basename(asset.relativePath)));
        expect(licences.length, `${template.id}: no licence text beside ${font.relativePath}`).toBeGreaterThan(0);
      }
    }
  });

  // The examples are the source; this guards the copy in the extension against drifting. The folder is
  // beside the extension in the repository, and absent where the extension is built from its own checkout.
  const EXAMPLES_DIR = path.join(__dirname, '..', '..', '..', 'examples');
  describe.skipIf(!fs.existsSync(EXAMPLES_DIR))('against examples/', () => {
    it('are the same files as the examples: run node scripts/sync-examples.mjs from the repository root if this fails', () => {
      for (const folder of fs.readdirSync(EXAMPLES_DIR).filter(name => /^\d+-/.test(name))) {
        const id = folder.replace(/^\d+-/, '');
        const template = templates.find(candidate => candidate.id === id);
        expect(template, `no template for examples/${folder}`).toBeDefined();
        expect(fs.readFileSync(template!.xmlPath).equals(fs.readFileSync(path.join(EXAMPLES_DIR, folder, 'document.xml'))), `${id}: document.xml`).toBe(true);
      }
    });
  });

  it('carry no schema location: the extension finds the schema by the <lpdf> root wherever the file is saved', () => {
    for (const template of templates) {
      expect(fs.readFileSync(template.xmlPath, 'utf8'), template.id).not.toMatch(/schemaLocation/);
    }
  });

  // The engine is downloaded into wasm/ before a build, locally and in CI; without it there is nothing to render with.
  describe.skipIf(!fs.existsSync(ENGINE))('rendered by the engine', () => {
    const { LpdfEngine } = createRequire(__filename)(ENGINE) as {
      LpdfEngine: new (key: string) => { render_pdf(xml: string, data?: string | null): Uint8Array; free(): void };
    };
    // A template's fonts and images are registered by the names its <assets> give them, as the extension does.
    const render = (template: { xmlPath: string; assets: { relativePath: string; sourcePath: string }[] }, data: string | null): Uint8Array => {
      const xml = fs.readFileSync(template.xmlPath, 'utf8');
      const engine = new LpdfEngine('') as unknown as {
        load_font(name: string, bytes: Uint8Array): void; load_image(name: string, bytes: Uint8Array): void;
        render_pdf(xml: string, data?: string | null): Uint8Array; free(): void;
      };
      try {
        const source = (src: string): string => template.assets.find(asset => asset.relativePath === forwardSlashes(src))!.sourcePath;
        const body = withoutComments(xml);
        for (const match of body.matchAll(/<font\s+name="([^"]+)"\s+src="([^"]+)"/g)) { engine.load_font(match[1], fs.readFileSync(source(match[2]))); }
        for (const match of body.matchAll(/<image\s+name="([^"]+)"\s+src="([^"]+)"/g)) { engine.load_image(match[1], fs.readFileSync(source(match[2]))); }
        return engine.render_pdf(xml, data);
      } finally { engine.free(); }
    };
    const pdfHeader = (bytes: Uint8Array): string => Buffer.from(bytes.subarray(0, 5)).toString('latin1');

    it.each(templates.map(template => [template.id, template] as const))('%s renders, with its data and without', (_id, template) => {
      expect(pdfHeader(render(template, null))).toBe('%PDF-');
      if (template.dataPath) {
        expect(pdfHeader(render(template, fs.readFileSync(template.dataPath, 'utf8')))).toBe('%PDF-');
      }
    });

    it.each(templates.filter(template => template.dataPath).map(template => [template.id, template] as const))(
      '%s uses its data: a different value gives a different PDF',
      (_id, template) => {
        const data = fs.readFileSync(template.dataPath as string, 'utf8');
        const changed = data.replace(/"([^"]+)"\s*:\s*"([^"]+)"/, '"$1": "$2, changed"');
        expect(changed).not.toBe(data);
        expect(Buffer.from(render(template, changed)).equals(Buffer.from(render(template, data)))).toBe(false);
      },
    );
  });
});
