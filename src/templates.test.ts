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

describe('the templates that ship in the extension', () => {
  const templates = loadTemplates(TEMPLATES_DIR);

  it('include the invoice with its data', () => {
    const invoice = templates.find(template => template.id === 'invoice');
    expect(invoice).toMatchObject({ label: 'Invoice with data', fileName: 'invoice' });
    expect(invoice?.dataPath).toBeDefined();
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
    const render = (xml: string, data: string | null): Uint8Array => {
      const engine = new LpdfEngine('');
      try { return engine.render_pdf(xml, data); } finally { engine.free(); }
    };
    const pdfHeader = (bytes: Uint8Array): string => Buffer.from(bytes.subarray(0, 5)).toString('latin1');

    it.each(templates.map(template => [template.id, template] as const))('%s renders, with its data and without', (_id, template) => {
      const xml = fs.readFileSync(template.xmlPath, 'utf8');
      expect(pdfHeader(render(xml, null))).toBe('%PDF-');
      if (template.dataPath) {
        expect(pdfHeader(render(xml, fs.readFileSync(template.dataPath, 'utf8')))).toBe('%PDF-');
      }
    });

    it.each(templates.filter(template => template.dataPath).map(template => [template.id, template] as const))(
      '%s uses its data: a different value gives a different PDF',
      (_id, template) => {
        const xml = fs.readFileSync(template.xmlPath, 'utf8');
        const data = fs.readFileSync(template.dataPath as string, 'utf8');
        const changed = data.replace(/"([^"]+)"\s*:\s*"([^"]+)"/, '"$1": "$2, changed"');
        expect(changed).not.toBe(data);
        expect(Buffer.from(render(xml, changed)).equals(Buffer.from(render(xml, data)))).toBe(false);
      },
    );
  });
});
