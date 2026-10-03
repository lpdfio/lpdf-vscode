import { describe, expect, it } from 'vitest';
import { buildPdfjsCsp } from './pdfjs-csp';

const policy = buildPdfjsCsp({ cspSource: 'https://file.example', nonce: 'abc123' });

describe('buildPdfjsCsp', () => {
    it('allows nothing by default', () => {
        expect(policy.startsWith(`default-src 'none'; `)).toBe(true);
    });

    it('allows scripts only from the webview and the page nonce, with WebAssembly for the image decoders', () => {
        expect(policy).toContain(`script-src https://file.example 'nonce-abc123' 'wasm-unsafe-eval'`);
    });

    it('allows workers only from blob urls', () => {
        expect(policy).toContain('worker-src blob:;');
    });

    it('allows images, fonts and fetches from the webview, and blobs and data uris', () => {
        expect(policy).toContain('img-src https://file.example blob: data:');
        expect(policy).toContain('font-src https://file.example data:');
        expect(policy).toContain('connect-src https://file.example blob: data:');
    });

    it('allows no base address and no form posts', () => {
        expect(policy).toContain(`base-uri 'none'`);
        expect(policy).toContain(`form-action 'none'`);
    });
});
