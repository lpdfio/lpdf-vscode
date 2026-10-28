import { describe, expect, it } from 'vitest';
import { ENTROPY_BYTES, renderRequest, type IWasmEngine, type IWasmModule, type RenderRequest } from './worker';
import { PERMISSIONS, permissionsFromAllowed, type EncryptionRequest } from './encryption';

/** An engine that records what it is asked, and can be made to fail. */
function fakeEngine(failRender = false): { module: IWasmModule; calls: unknown[][]; freed: () => number } {
  const calls: unknown[][] = [];
  let freed = 0;
  class Fake implements IWasmEngine {
    load_font(name: string): void { calls.push(['load_font', name]); }
    load_image(name: string): void { calls.push(['load_image', name]); }
    load_markdown_styles(src: string, xml: string): void { calls.push(['load_markdown_styles', src, xml]); }
    set_encryption(user: string, owner: string, permissions: string, algorithm: string, entropy: Uint8Array): void {
      calls.push(['set_encryption', user, owner, permissions, algorithm, entropy]);
    }
    render_pdf(): Uint8Array {
      calls.push(['render_pdf']);
      if (failRender) { throw new Error('bad xml'); }
      return new Uint8Array([37, 80, 68, 70]);
    }
    free(): void { freed++; }
  }
  return { module: { LpdfEngine: Fake }, calls, freed: () => freed };
}

function encryption(overrides: Partial<EncryptionRequest> = {}): EncryptionRequest {
  return {
    userPassword: 'open',
    ownerPassword: 'owner',
    permissions: permissionsFromAllowed(PERMISSIONS.filter(p => p.key !== 'copy').map(p => p.key)),
    algorithm: 'aes-256',
    ...overrides,
  };
}

function request(extra: Partial<RenderRequest> = {}): RenderRequest {
  return { id: '1', xml: '<lpdf/>', jsonData: null, assets: { fonts: new Map(), images: new Map() }, ...extra };
}

const names = (calls: unknown[][]) => calls.map(call => call[0]);

describe('renderRequest', () => {
  it('gives the engine the files of Markdown rules the document names before it renders', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({
      assets: { fonts: new Map(), images: new Map(), markdownStyles: new Map([['styles.xml', '<markdown-styles/>']]) },
    }));
    expect(calls).toEqual([['load_markdown_styles', 'styles.xml', '<markdown-styles/>'], ['render_pdf']]);
  });

  it('renders without encryption when none is asked for', () => {
    const { module, calls } = fakeEngine();
    expect(Array.from(renderRequest(module, request()))).toEqual([37, 80, 68, 70]);
    expect(names(calls)).toEqual(['render_pdf']);
  });

  it('gives the engine the passwords, the flags and the algorithm before it renders', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: encryption() }));

    expect(names(calls)).toEqual(['set_encryption', 'render_pdf']);
    const [, user, owner, permissions, algorithm] = calls[0];
    expect([user, owner, algorithm]).toEqual(['open', 'owner', 'aes-256']);
    expect(JSON.parse(permissions as string)).toMatchObject({ copy: false, print: true, modify: true });
  });

  it('sends 32 random bytes for AES-256, different for each render', () => {
    const first = fakeEngine();
    const second = fakeEngine();
    renderRequest(first.module, request({ encryption: encryption() }));
    renderRequest(second.module, request({ encryption: encryption() }));

    const a = first.calls[0][5] as Uint8Array;
    const b = second.calls[0][5] as Uint8Array;
    expect(ENTROPY_BYTES).toBe(32);
    expect(a).toHaveLength(32);
    expect(b).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('sends no random bytes for RC4-128', () => {
    const { module, calls } = fakeEngine();
    renderRequest(module, request({ encryption: encryption({ algorithm: 'rc4-128' }) }));
    expect(calls[0][4]).toBe('rc4-128');
    expect(calls[0][5]).toHaveLength(0);
  });

  it('loads the assets before it encrypts and renders', () => {
    const { module, calls } = fakeEngine();
    const assets = { fonts: new Map([['serif', new Uint8Array(1)]]), images: new Map([['logo', new Uint8Array(1)]]) };
    renderRequest(module, request({ assets, encryption: encryption() }));
    expect(names(calls)).toEqual(['load_font', 'load_image', 'set_encryption', 'render_pdf']);
  });

  it('frees the engine after a render and after a failed one', () => {
    const ok = fakeEngine();
    renderRequest(ok.module, request());
    expect(ok.freed()).toBe(1);

    const failing = fakeEngine(true);
    expect(() => renderRequest(failing.module, request({ encryption: encryption() }))).toThrow('bad xml');
    expect(failing.freed()).toBe(1);
  });

  it('refuses an engine from before AES-256 rather than encrypt with RC4-128 unasked', () => {
    class Old implements Pick<IWasmEngine, 'load_font' | 'load_image' | 'render_pdf' | 'free'> {
      rendered = false;
      load_font(): void {}
      load_image(): void {}
      // Three arguments, as the engine took them before AES-256.
      set_encryption(_user: string, _owner: string, _permissions: string): void {}
      render_pdf(): Uint8Array { this.rendered = true; return new Uint8Array(0); }
      free(): void {}
    }
    expect(() => renderRequest({ LpdfEngine: Old as unknown as IWasmModule['LpdfEngine'] }, request({ encryption: encryption() })))
      .toThrow(/older than the encrypted export needs/);
  });

  it('renders on an engine from before AES-256 when nothing is encrypted', () => {
    class Old {
      load_font(): void {}
      load_image(): void {}
      set_encryption(_user: string, _owner: string, _permissions: string): void {}
      render_pdf(): Uint8Array { return new Uint8Array([1]); }
      free(): void {}
    }
    expect(Array.from(renderRequest({ LpdfEngine: Old as unknown as IWasmModule['LpdfEngine'] }, request()))).toEqual([1]);
  });

  it('returns a buffer of its own, not the engine\'s', () => {
    const engineBytes = new Uint8Array([1, 2, 3]);
    class Shared implements IWasmEngine {
      load_font(): void {}
      load_image(): void {}
      set_encryption(): void {}
      render_pdf(): Uint8Array { return engineBytes; }
      free(): void { engineBytes.fill(0); }
    }
    const bytes = renderRequest({ LpdfEngine: Shared }, request());
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
