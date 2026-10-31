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
    load_markdown_styles(src: string, xml: string): void { calls.push(['load_markdown_styles', src, xml]); }
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

describe('renderRequest', () => {
  it('gives the engine the files of Markdown rules the document names before it renders', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({
      assets: { fonts: new Map(), images: new Map(), markdownStyles: new Map([['styles.xml', '<markdown-styles/>']]) },
    }));
    expect(names(calls)).toEqual(['load_markdown_styles', 'render_pdf']);
    expect(calls[0]).toEqual(['load_markdown_styles', 'styles.xml', '<markdown-styles/>']);
  });

  it('renders with no passwords, no skip and no random bytes when nothing is asked', () => {
    const { module, calls } = fakeEngine();
    expect(Array.from(renderRequest(module, request()))).toEqual([37, 80, 68, 70]);
    const [, xml, data, user, owner, skip, entropy] = calls[0];
    expect([xml, data, user, owner, skip]).toEqual(['<lpdf/>', null, null, null, false]);
    expect(entropy).toHaveLength(0);
  });

  it('asks the engine to skip the encryption for a preview', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: { skipEncryption: true } }));
    expect(calls[0][5]).toBe(true);
    expect(calls[0][6]).toHaveLength(0);
  });

  it('gives the engine the passwords with the render', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: { passwords } }));
    const [, , , user, owner, skip] = calls[0];
    expect([user, owner, skip]).toEqual(['open', 'owner', false]);
  });

  it('sends 32 random bytes with the passwords, different for each render', () => {
    const first = fakeEngine();
    const second = fakeEngine();
    renderRequest(first.module, request({ encryption: { passwords } }));
    renderRequest(second.module, request({ encryption: { passwords } }));

    const a = first.calls[0][6] as Uint8Array;
    const b = second.calls[0][6] as Uint8Array;
    expect(ENTROPY_BYTES).toBe(32);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('loads the assets before it renders', () => {
    const { module, calls } = fakeEngine();
    const assets = { fonts: new Map([['serif', new Uint8Array(1)]]), images: new Map([['logo', new Uint8Array(1)]]) };
    renderRequest(module, request({ assets, encryption: { passwords } }));
    expect(names(calls)).toEqual(['load_font', 'load_image', 'render_pdf']);
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
      load_markdown_styles(): void {}
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
});
