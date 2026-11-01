import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTROPY_BYTES, renderRequest, type IWasmEngine, type IWasmModule, type RenderRequest } from './worker';
import type { Passwords } from './encryption';

/** An engine that records what it is asked, and can be made to fail. */
function fakeEngine(failRender = false): { module: IWasmModule; calls: unknown[][]; freed: () => number } {
  const calls: unknown[][] = [];
  let freed = 0;
  class Fake implements IWasmEngine {
    load_font(name: string): void { calls.push(['load_font', name]); }
    load_image(name: string): void { calls.push(['load_image', name]); }
    load_file(name: string): void { calls.push(['load_file', name]); }
    load_profile(name: string): void { calls.push(['load_profile', name]); }
    load_markdown_styles(src: string, xml: string): void { calls.push(['load_markdown_styles', src, xml]); }
    set_created_on(iso: string): void { calls.push(['set_created_on', iso]); }
    render_pdf(
      xml: string, data: string | null, user: string | null, owner: string | null, skip: boolean, entropy: Uint8Array,
    ): Uint8Array {
      calls.push(['render_pdf', xml, data, user, owner, skip, entropy]);
      if (failRender) { throw new Error('bad xml'); }
      return new Uint8Array([37, 80, 68, 70]);
    }
    free(): void { freed++; }
  }
  return { module: { LpdfEngine: Fake }, calls, freed: () => freed };
}

const passwords: Passwords = { userPassword: 'open', ownerPassword: 'owner' };

function request(extra: Partial<RenderRequest> = {}): RenderRequest {
  return { id: '1', xml: '<lpdf/>', jsonData: null, assets: { fonts: new Map(), images: new Map() }, encryption: {}, ...extra };
}

const names = (calls: unknown[][]) => calls.map(call => call[0]);

/** What the engine was asked to render with. */
function renderCall(calls: unknown[][]): unknown[] {
  const call = calls.find(([name]) => name === 'render_pdf');
  if (!call) { throw new Error('The engine was not asked to render'); }
  return call;
}

describe('renderRequest', () => {
  it('gives the engine the files of Markdown rules the document names before it renders', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({
      assets: { fonts: new Map(), images: new Map(), markdownStyles: new Map([['styles.xml', '<markdown-styles/>']]) },
    }));
    expect(names(calls)).toEqual(['load_markdown_styles', 'set_created_on', 'render_pdf']);
    expect(calls[0]).toEqual(['load_markdown_styles', 'styles.xml', '<markdown-styles/>']);
  });

  it('renders with no passwords, no skip and no random bytes when nothing is asked', () => {
    const { module, calls } = fakeEngine();
    expect(Array.from(renderRequest(module, request()))).toEqual([37, 80, 68, 70]);
    const [, xml, data, user, owner, skip, entropy] = renderCall(calls);
    expect([xml, data, user, owner, skip]).toEqual(['<lpdf/>', null, null, null, false]);
    expect(entropy).toHaveLength(0);
  });

  it('asks the engine to skip the encryption for a preview', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: { skipEncryption: true } }));
    expect(renderCall(calls)[5]).toBe(true);
    expect(renderCall(calls)[6]).toHaveLength(0);
  });

  it('gives the engine the passwords with the render', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: { passwords } }));
    const [, , , user, owner, skip] = renderCall(calls);
    expect([user, owner, skip]).toEqual(['open', 'owner', false]);
  });

  it('sends 32 random bytes with the passwords, different for each render', () => {
    const first = fakeEngine();
    const second = fakeEngine();
    renderRequest(first.module, request({ encryption: { passwords } }));
    renderRequest(second.module, request({ encryption: { passwords } }));

    const a = renderCall(first.calls)[6] as Uint8Array;
    const b = renderCall(second.calls)[6] as Uint8Array;
    expect(ENTROPY_BYTES).toBe(32);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('loads the assets before it renders', () => {
    const { module, calls } = fakeEngine();
    const assets = { fonts: new Map([['serif', new Uint8Array(1)]]), images: new Map([['logo', new Uint8Array(1)]]) };
    renderRequest(module, request({ assets, encryption: { passwords } }));
    expect(names(calls)).toEqual(['load_font', 'load_image', 'set_created_on', 'render_pdf']);
  });

  it('loads the files the document carries before it renders', () => {
    const { module, calls } = fakeEngine();
    const assets = { fonts: new Map(), images: new Map(), files: new Map([['invoice.xml', new Uint8Array(1)]]) };
    renderRequest(module, request({ assets, encryption: { passwords } }));
    expect(calls.filter(call => call[0] === 'load_file')).toEqual([['load_file', 'invoice.xml']]);
    expect(names(calls).at(-1)).toBe('render_pdf');
  });

  it('loads the color profiles of the document before it renders', () => {
    const { module, calls } = fakeEngine();
    const assets = { fonts: new Map(), images: new Map(), profiles: new Map([['press', new Uint8Array(1)]]) };
    renderRequest(module, request({ assets }));
    expect(calls.filter(call => call[0] === 'load_profile')).toEqual([['load_profile', 'press']]);
    expect(names(calls).at(-1)).toBe('render_pdf');
  });

  it('dates the render with its time, in UTC to the second, before it renders', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request(), new Date('2026-10-31T16:40:12.345Z'));
    expect(calls.slice(-2)).toEqual([['set_created_on', '2026-10-31T16:40:12Z'], renderCall(calls)]);
  });

  it('dates the render with the time it is made when given none', () => {
    const { module, calls } = fakeEngine();
    const before = Math.floor(Date.now() / 1000) * 1000;
    renderRequest(module, request());
    const after = Date.now();

    const [, iso] = calls.find(([name]) => name === 'set_created_on') ?? [];
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const time = Date.parse(iso as string);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('frees the engine after a render and after a failed one', () => {
    const ok = fakeEngine();
    renderRequest(ok.module, request());
    expect(ok.freed()).toBe(1);

    const failing = fakeEngine(true);
    expect(() => renderRequest(failing.module, request({ encryption: { passwords } }))).toThrow('bad xml');
    expect(failing.freed()).toBe(1);
  });

  it('returns a buffer of its own, not the engine\'s', () => {
    const engineBytes = new Uint8Array([1, 2, 3]);
    class Shared implements IWasmEngine {
      load_font(): void {}
      load_image(): void {}
      load_file(): void {}
      load_profile(): void {}
      load_markdown_styles(): void {}
      set_created_on(): void {}
      render_pdf(): Uint8Array { return engineBytes; }
      free(): void { engineBytes.fill(0); }
    }
    const bytes = renderRequest({ LpdfEngine: Shared }, request());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

// The engine is downloaded into wasm/ before a build, locally and in CI; without it there is nothing to render with.
const ENGINE = path.join(__dirname, '..', 'wasm', 'lpdf.js');

describe.skipIf(!fs.existsSync(ENGINE))('renderRequest on the engine the extension ships', () => {
  const wasm = createRequire(__filename)(ENGINE) as IWasmModule;
  const xml = '<lpdf version="1"><document><output encrypt="aes-256" allow="print"/><section><layout><text>Hello</text></layout></section></document></lpdf>';
  const text = (encryption: RenderRequest['encryption']) => Buffer.from(renderRequest(wasm, request({ xml, encryption }))).toString('latin1');

  it('encrypts a document that asks for it with the passwords of an export', () => {
    expect(text({ passwords })).toContain('/CFM /AESV3');
  });

  it('renders it unencrypted for a preview', () => {
    expect(text({ skipEncryption: true })).not.toContain('/Encrypt');
  });

  it('refuses it with neither, as the engine does', () => {
    expect(() => text({})).toThrow(/no owner password/);
  });

  it('embeds the files the document carries, as the SDKs do', () => {
    const attached = '<lpdf version="1"><document><attachments><file name="invoice.xml" mime="text/xml"/></attachments>'
      + '<section><layout><text>Hello</text></layout></section></document></lpdf>';
    const assets = { fonts: new Map(), images: new Map(), files: new Map([['invoice.xml', new Uint8Array(Buffer.from('<invoice/>'))]]) };
    const pdf = Buffer.from(renderRequest(wasm, request({ xml: attached, assets, encryption: { skipEncryption: false } }))).toString('latin1');
    expect(pdf).toContain('/Type /EmbeddedFile');
    expect(pdf).toContain('/Subtype /text#2Fxml');
  });

  it('renders the brochure template, a PDF/X document, with its fonts, its chart and its press profile', () => {
    const template = path.join(__dirname, '..', 'templates', 'brochure');
    const read = (file: string) => new Uint8Array(fs.readFileSync(path.join(template, file)));
    const assets = {
      fonts: new Map([['display', read('assets/fonts/Radley-Regular.ttf')], ['text', read('assets/fonts/Montserrat-Regular.ttf')]]),
      images: new Map([['chart', read('assets/images/committed-capital.png')]]),
      profiles: new Map([['press', read('assets/profiles/FOGRA39L_coated.icc')]]),
    };
    const xml = fs.readFileSync(path.join(template, 'document.xml'), 'utf8');
    const pdf = Buffer.from(renderRequest(wasm, request({ xml, assets, encryption: { skipEncryption: true } }))).toString('latin1');
    expect(pdf).toContain('/S /GTS_PDFX');
    expect(pdf).toContain('/Info (FOGRA39L Coated)');
    expect(pdf).toContain('/TrimBox');
    expect(pdf).not.toContain('/Annots');
  });

  describe('a document with <output pdfa>', () => {
    // PDF/A embeds every font, so the text is in one of the book template's.
    const font = fs.readFileSync(path.join(__dirname, '..', 'templates', 'book', 'assets', 'fonts', 'CrimsonText-Regular.ttf'));
    const assets = { fonts: new Map([['body', new Uint8Array(font)]]), images: new Map() };
    const archived = '<lpdf version="1"><assets><font name="body" src="CrimsonText-Regular.ttf"/></assets>'
      + '<document font="body"><output pdfa="2b"/><section><layout><text>Hello</text></layout></section></document></lpdf>';
    const now = new Date('2026-10-31T16:40:12.345Z');

    // The encryption each command asks for: preview.ts skips it, and export.ts has no passwords to give here.
    it.each([
      ['the preview', { skipEncryption: true }],
      ['Export PDF', {}],
    ])('renders for %s, dated with the time of the render', (_, encryption) => {
      const pdf = Buffer.from(renderRequest(wasm, request({ xml: archived, assets, encryption }), now)).toString('latin1');
      expect(pdf).toContain('<pdfaid:part>2</pdfaid:part>');
      expect(pdf).toContain('/CreationDate (D:20261031164012Z)');
      expect(pdf).toContain('<xmp:CreateDate>2026-10-31T16:40:12Z</xmp:CreateDate>');
    });
  });

  it('dates a document without PDF/A to the second', () => {
    const pdf = Buffer.from(renderRequest(wasm, request({ xml: '<lpdf version="1"><document><section><layout><text>Hello</text></layout></section></document></lpdf>' }),
      new Date('2026-10-31T16:40:12.345Z'))).toString('latin1');
    // No milliseconds among the digits. An engine that keeps the zone writes the `Z` after them.
    expect(pdf).toMatch(/\/CreationDate \(D:20261031164012Z?\)/);
  });
});
