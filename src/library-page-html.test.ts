import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLibraryPageHtml, LibraryPageMarkupError, LibraryPageOptions } from './library-page-html';

const mediaDir = path.join(__dirname, '..', 'media');
const PAGES = ['pdf-diff.html'];

function options(overrides: Partial<LibraryPageOptions> = {}): LibraryPageOptions {
    return {
        pageHtml: `<meta content="__CSP__"><script nonce="__NONCE__">import('__VIEWER_URI__lpdf-pdfjs.mjs');</script>`,
        viewerRoot: 'https://file.example/media/viewer',
        cspSource: 'https://file.example',
        nonce: 'abc123',
        ...overrides,
    };
}

describe('buildLibraryPageHtml', () => {
    it('puts the policy of the webview in the page', () => {
        const html = buildLibraryPageHtml(options());
        expect(html).toContain(`content="default-src 'none'; script-src https://file.example 'nonce-abc123' 'wasm-unsafe-eval';`);
    });

    it('puts the nonce on the page scripts', () => {
        expect(buildLibraryPageHtml(options())).toContain('<script nonce="abc123">');
    });

    it('addresses the files of the viewer folder whether or not its address ends in a slash', () => {
        for (const viewerRoot of ['https://file.example/media/viewer', 'https://file.example/media/viewer/']) {
            const html = buildLibraryPageHtml(options({ viewerRoot }));
            expect(html).toContain(`import('https://file.example/media/viewer/lpdf-pdfjs.mjs')`);
        }
    });

    it('addresses the viewer folder in an HTML attribute too, where a quote is escaped for HTML and not for a string', () => {
        const pageHtml = `${options().pageHtml}<link href="__VIEWER_HREF__lpdf-theme.css">`;
        const html = buildLibraryPageHtml(options({ pageHtml, viewerRoot: 'https://file.example/a"b/viewer' }));
        expect(html).toContain('<link href="https://file.example/a&quot;b/viewer/lpdf-theme.css">');
    });

    it('keeps a quote or a closing script tag in an address from leaving its string', () => {
        const html = buildLibraryPageHtml(options({ viewerRoot: `https://file.example/a'b</script><i>` }));
        expect(html).not.toContain('</script><i>');
        expect(html).toContain(String.raw`a\'b\u003c/script>`);
    });

    it('rejects a page that lacks a placeholder', () => {
        for (const placeholder of ['__CSP__', '__NONCE__', '__VIEWER_URI__']) {
            const pageHtml = options().pageHtml.split(placeholder).join('');
            expect(() => buildLibraryPageHtml(options({ pageHtml }))).toThrow(LibraryPageMarkupError);
        }
    });

    for (const page of PAGES) {
        it(`fills in every placeholder of ${page}, and loads PDF.js through the shared loader`, () => {
            const html = buildLibraryPageHtml(options({ pageHtml: fs.readFileSync(path.join(mediaDir, page), 'utf8') }));
            expect(html).not.toMatch(/__[A-Z_]+__/);
            expect(html).toContain(`from 'https://file.example/media/viewer/lpdf-pdfjs.mjs'`);
            // The loader gets the address of the viewer folder, written in the call or kept in a constant the page also uses.
            const address = String.raw`'https:\/\/file\.example\/media\/viewer\/'`;
            const viaConstant = /loadPdfjsLibrary\(\s*viewerRoot\b/.test(html);
            expect(html).toMatch(viaConstant ? new RegExp(`const viewerRoot = ${address};`) : new RegExp(`loadPdfjsLibrary\\(\\s*${address}`));
            expect(html).toContain('...documentOptions');
        });

        it(`${page} does not start a PDF.js of its own`, () => {
            const html = fs.readFileSync(path.join(mediaDir, page), 'utf8');
            expect(html).not.toMatch(/pdf\.min\.mjs|pdf\.worker\.min\.mjs|createObjectURL/);
        });
    }
});
