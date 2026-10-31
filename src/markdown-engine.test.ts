import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultTemplate, markdownImageName, prepareMarkdown, starterStyles, starterTemplate, stylePresets, STYLES_FILE_NAME,
  type MarkdownWasm,
} from './markdown-engine';

// The engine this extension ships: these tests ask it, so that what they say is what a preview does.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasm = require(join(__dirname, '..', 'wasm', 'lpdf.js')) as MarkdownWasm & {
  LpdfEngine: new (key: string) => { render_pdf(xml: string, data: string | null, user: string | null, owner: string | null, skip: boolean, entropy: Uint8Array): Uint8Array; load_image(name: string, bytes: Uint8Array): void; load_markdown_styles(src: string, xml: string): void; free(): void };
};

const PIXEL = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

function render(xml: string, data: string | null, images: Record<string, Uint8Array> = {}, styles: Record<string, string> = {}): string {
  const engine = new wasm.LpdfEngine('');
  try {
    for (const [name, bytes] of Object.entries(images)) { engine.load_image(name, bytes); }
    for (const [src, text] of Object.entries(styles)) { engine.load_markdown_styles(src, text); }
    return Buffer.from(engine.render_pdf(xml, data, null, null, false, new Uint8Array(0))).toString('latin1');
  } finally {
    engine.free();
  }
}

describe('prepareMarkdown', () => {
  it('wraps a file in the default template, with its text and front matter as the data', () => {
    const prepared = prepareMarkdown('---\ntitle: Notes\n---\n\n# Heading\n', null);
    expect(prepared.xml).toContain('<markdown');
    expect(prepared.xml).not.toContain('<image');
    expect(prepared.images).toEqual([]);
    expect(JSON.parse(prepared.jsonData)).toEqual({ markdown: '---\ntitle: Notes\n---\n\n# Heading\n', title: 'Notes' });
  });

  it('wraps it in the template it is given instead', () => {
    const template = '<lpdf version="1"><document><section><markdown><markdown-content data-value="markdown"/></markdown></section></document></lpdf>';
    expect(prepareMarkdown('# A', template).xml).toBe(template);
  });

  it('declares the images of the Markdown as assets, named by their place in the file', () => {
    const prepared = prepareMarkdown('![a](img/a.png) and ![b](b.jpg) and ![again](img/a.png) and ![u](https://x.org/u.png)', null);
    expect(prepared.images).toEqual(['img/a.png', 'b.jpg']);
    expect(prepared.xml).toContain(`<image name="${markdownImageName(0)}" src="img/a.png"/>`);
    expect(prepared.xml).toContain(`<image name="${markdownImageName(1)}" src="b.jpg"/>`);
  });

  it('gives a document the engine renders, with the image where the Markdown wrote it', () => {
    const prepared = prepareMarkdown('# Title\n\n![a chart](img/chart.png)\n', null);
    const pdf = render(prepared.xml, prepared.jsonData, { [markdownImageName(0)]: PIXEL });
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toMatch(/\/Subtype\s*\/Image/);
  });

  it('leaves raw HTML out and keeps the words in it', () => {
    const withHtml = prepareMarkdown('fine\n\n<div>kept</div>\n', null);
    const plain = prepareMarkdown('fine\n\nkept\n', null);
    expect(render(withHtml.xml, withHtml.jsonData)).toBe(render(plain.xml, plain.jsonData));
  });

  it('declares the image of an img tag as well, and renders it', () => {
    const prepared = prepareMarkdown('<p align="center"><img src="img/logo.png" width="120"></p>\n', null);
    expect(prepared.images).toEqual(['img/logo.png']);
    const pdf = render(prepared.xml, prepared.jsonData, { [markdownImageName(0)]: PIXEL });
    expect(pdf).toMatch(/\/Subtype\s*\/Image/);
  });

  it('says what is wrong with a template that is not XML', () => {
    expect(() => prepareMarkdown('![a](a.png)', 'not xml')).toThrow();
  });
});

describe('the style presets', () => {
  it('are a sans look, a serif one and a typewriter one, each with the words that offer it', () => {
    const presets = stylePresets();
    expect(presets.map(preset => preset.name)).toEqual(['sans', 'serif', 'typewriter']);
    for (const preset of presets) {
      expect(preset.label, preset.name).not.toBe('');
      expect(preset.description, preset.name).not.toBe('');
      expect(preset.styles, preset.name).toMatch(/<markdown-styles>/);
    }
  });

  it('render a file, from a styles file beside it, as the default styles do for sans and otherwise for the others', () => {
    const starter = prepareMarkdown('# Title\n\nSome *text*.\n', starterTemplate());
    const plain = render(starter.xml, starter.jsonData, {}, { [STYLES_FILE_NAME]: starterStyles() });
    for (const preset of stylePresets()) {
      const rendered = render(starter.xml, starter.jsonData, {}, { [STYLES_FILE_NAME]: preset.styles });
      if (preset.name === 'sans') { expect(rendered, preset.name).toBe(plain); } else { expect(rendered, preset.name).not.toBe(plain); }
    }
  });
});

describe('the starter template and styles', () => {
  it('reads its styles from the file written beside it', () => {
    const template = starterTemplate();
    expect(template).toContain(`<markdown-styles src="${STYLES_FILE_NAME}"/>`);
    expect(template.indexOf('<markdown-styles')).toBeLessThan(template.indexOf('<markdown-content'));
    expect(starterTemplate('other.xml')).toContain('src="other.xml"');
  });

  it('renders as the default template does, since the styles it names are the default ones', () => {
    const markdown = '# Title\n\nSome *text* with `code`.\n';
    const plain = prepareMarkdown(markdown, null);
    const starter = prepareMarkdown(markdown, starterTemplate());
    const fromDefault = render(plain.xml, plain.jsonData);
    const fromStarter = render(starter.xml, starter.jsonData, {}, { [STYLES_FILE_NAME]: starterStyles() });
    expect(fromStarter).toBe(fromDefault);
  });

  it('is changed by an edit of the styles file', () => {
    const starter = prepareMarkdown('# Title\n', starterTemplate());
    const edited = starterStyles().replace('<h1 ', '<h1 color="#ff0000" ');
    expect(render(starter.xml, starter.jsonData, {}, { [STYLES_FILE_NAME]: edited }))
      .not.toBe(render(starter.xml, starter.jsonData, {}, { [STYLES_FILE_NAME]: starterStyles() }));
  });

  it('is a styles file whose root is markdown-styles, with a rule for each part', () => {
    const styles = starterStyles();
    expect(styles).toMatch(/<markdown-styles>/);
    for (const rule of ['h1', 'p', 'code', 'quote', 'li', 'a', 'table']) { expect(styles).toContain(`<${rule} `); }
  });

  it('names the file of styles it writes', () => {
    expect(STYLES_FILE_NAME).toBe('markdown-styles.xml');
  });

  it('writes the path of the styles as an XML attribute, whatever is in it', () => {
    const template = starterTemplate('C:\\notes & "drafts"\\<a>.xml');
    expect(template).toContain('<markdown-styles src="C:\\notes &amp; &quot;drafts&quot;\\&lt;a>.xml"/>');
    expect(() => prepareMarkdown('# A', template)).not.toThrow();
  });

  it('is the default template with only the styles added', () => {
    expect(starterTemplate().replace(/\s*<markdown-styles[^>]*\/>/, '')).toBe(defaultTemplate());
  });

  it('is the page a .md file is wrapped in by default: A4, a 54pt margin and the page number', () => {
    const template = defaultTemplate();
    expect(template).toContain('size="a4"');
    expect(template).toContain('margin="54pt"');
    expect(template).toContain('Page {page} of {pages}');
  });
});

describe('the engine of the extension', () => {
  it('has the engine the tests above ask', () => {
    expect(readFileSync(join(__dirname, '..', 'wasm', 'lpdf.js'), 'utf8')).toContain('markdown_declare_images');
  });
});
