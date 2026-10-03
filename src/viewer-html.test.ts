import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildViewerHtml, ViewerHtmlOptions, ViewerMarkupError } from './viewer-html';

const vendoredViewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer', 'web', 'viewer.html'), 'utf8');

function options(overrides: Partial<ViewerHtmlOptions> = {}): ViewerHtmlOptions {
    return {
        viewerHtml: '<html><head></head><body tabindex="0"><div id="outerContainer"></div></body></html>',
        viewerRoot: 'https://file.example/media/viewer',
        cspSource: 'https://file.example',
        nonce: 'abc123',
        ...overrides,
    };
}

describe('buildViewerHtml', () => {
    it('keeps the body markup of the viewer page and its body attributes', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('<body tabindex="0"><div id="outerContainer"></div>');
    });

    it('reuses the whole body of the vendored viewer page', () => {
        const html = buildViewerHtml(options({ viewerHtml: vendoredViewerHtml }));
        expect(html).toContain('id="viewerContainer"');
        expect(html).toContain('id="editorModeButtons"');
    });

    it('does not carry over the head of the viewer page', () => {
        const html = buildViewerHtml(options({ viewerHtml: vendoredViewerHtml }));
        expect(html).not.toContain('PDF.js viewer');
        expect(html).not.toContain('src="viewer.mjs"');
    });

    it('allows scripts only from the webview and the page nonce', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain(`script-src https://file.example 'nonce-abc123' 'wasm-unsafe-eval'`);
        expect(html).toContain('<script type="module" nonce="abc123" src="https://file.example/media/viewer/lpdf-host.mjs">');
    });

    it('allows workers only from blob urls', () => {
        expect(buildViewerHtml(options())).toContain('worker-src blob:;');
    });

    it('loads the viewer files from the viewer root whether or not it ends in a slash', () => {
        for (const viewerRoot of ['https://file.example/media/viewer', 'https://file.example/media/viewer/']) {
            const html = buildViewerHtml(options({ viewerRoot }));
            expect(html).toContain('href="https://file.example/media/viewer/web/viewer.css"');
            expect(html).toContain('href="https://file.example/media/viewer/web/locale/locale.json"');
        }
    });

    it('passes the file locations to the host script as json', () => {
        const html = buildViewerHtml(options());
        const json = /<script type="application\/json" id="lpdf-viewer-config">(.*)<\/script>/.exec(html)?.[1];
        expect(JSON.parse(json ?? '')).toEqual({
            pdfjsUri: 'https://file.example/media/viewer/build/pdf.mjs',
            workerUri: 'https://file.example/media/viewer/build/pdf.worker.mjs',
            viewerUri: 'https://file.example/media/viewer/web/viewer.mjs',
            webRoot: 'https://file.example/media/viewer/web/',
        });
    });

    it('keeps a closing script tag in a location from ending the json block', () => {
        const html = buildViewerHtml(options({ viewerRoot: 'https://file.example/</script><b>' }));
        const block = /<script type="application\/json" id="lpdf-viewer-config">(.*?)<\/script>/.exec(html)?.[1];
        expect(block).toBeDefined();
        expect(block).not.toContain('<');
    });

    it('keeps a quote in a location from ending an html attribute', () => {
        const html = buildViewerHtml(options({ viewerRoot: 'https://file.example/a"b' }));
        expect(html).toContain('href="https://file.example/a&quot;b/web/viewer.css"');
        expect(html).not.toContain('a"b');
    });

    it('hides the print button and the zoom dropdown that the zoom field replaces', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('#printButton, #scaleSelectContainer { display: none !important; }');
    });

    it('takes the window-width classes off the toolbar, so the viewer does not hide controls that still fit', () => {
        expect(vendoredViewerHtml).toContain('hiddenMediumView');
        expect(vendoredViewerHtml).toContain('hiddenSmallView');
        expect(vendoredViewerHtml).toContain('visibleMediumView');
        const html = buildViewerHtml(options({ viewerHtml: vendoredViewerHtml }));
        expect(html).not.toMatch(/hiddenMediumView|hiddenSmallView|visibleMediumView/);
    });

    it('leaves the other classes of an element when it takes the window-width classes off', () => {
        const html = buildViewerHtml(options({ viewerHtml: '<body><div class="toolbarHorizontalGroup hiddenMediumView"></div></body>' }));
        expect(html).toContain('<div class="toolbarHorizontalGroup"></div>');
    });

    it('loads the stylesheet the viewer shares with the diff view, after its own stylesheet', () => {
        const html = buildViewerHtml(options());
        const viewerCss = html.indexOf('href="https://file.example/media/viewer/web/viewer.css"');
        const themeCss = html.indexOf('href="https://file.example/media/viewer/lpdf-theme.css"');
        expect(viewerCss).toBeGreaterThan(-1);
        expect(themeCss).toBeGreaterThan(viewerCss);
    });

    it('takes the colours of the header and of the area behind the pages from that stylesheet', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--toolbar-bg-color: var(--lpdf-header-bg);');
        expect(html).toContain('--body-bg-color: var(--lpdf-desk-bg);');
    });

    it('draws the fit, two page and cover buttons with the icons of that stylesheet', () => {
        const html = buildViewerHtml(options());
        for (const name of ['fit-width', 'fit-page', 'two-page', 'cover']) {
            expect(html).toContain(`mask-image: var(--lpdf-icon-${name});`);
        }
    });

    it('draws the zoom buttons with the minus and plus of that stylesheet, in place of the stock smaller ones', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--toolbarButton-zoomOut-icon: var(--lpdf-icon-minus);');
        expect(html).toContain('--toolbarButton-zoomIn-icon: var(--lpdf-icon-plus);');
    });

    it('draws document properties with the info icon the viewer already has, named by its address', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('url("https://file.example/media/viewer/web/images/secondaryToolbarButton-documentProperties.svg")');
        // The viewer's own variable for this icon holds a relative address, which this page would resolve against itself.
        expect(html).not.toContain('var(--secondaryToolbarButton-documentProperties-icon)');
    });

    it('keeps an address with a quote or a closing style tag from ending the style block', () => {
        const html = buildViewerHtml(options({ viewerRoot: 'https://file.example/a"b</style><i>' }));
        expect(html).not.toContain('</style><i>');
        expect(html).toContain('a\\"b\\3c /style>');
    });

    it('makes the toolbar 36px high with 18px icons, a little above the stock 32px and 16px', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--toolbar-height: 36px;');
        expect(html).toContain('--icon-size: 18px;');
    });

    it('puts one gap between every control of the left, middle and right groups, nested groups included', () => {
        const html = buildViewerHtml(options());
        expect(html).toMatch(/#toolbarViewerLeft, #toolbarViewerMiddle, #toolbarViewerRight,\s*#toolbarViewerLeft > \.toolbarHorizontalGroup, #toolbarViewerMiddle > \.toolbarHorizontalGroup,\s*#toolbarViewerRight > \.toolbarHorizontalGroup \{ gap: 6px; \}/);
    });

    it('leaves the spacing to that gap: no spacer after the sidebar button, no margin around the page count', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('#toolbarContainer #toolbarViewer .toolbarButtonSpacer { display: none; }');
        expect(html).toContain('#toolbarContainer #toolbarViewer #numPages { margin: 0; padding-inline: 0; }');
    });

    it('sets a divider apart from the controls beside it, with 6px more than the gap on each side', () => {
        expect(buildViewerHtml(options())).toContain('#toolbarContainer #toolbarViewer .verticalToolbarSeparator { margin-inline: 6px; }');
    });

    it('colours the current page of the Pages panel in the brand orange, with dark text on its page number', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--image-current-border-color: #d76f04;');
        expect(html).toContain('--image-current-page-number-fg: #15141a;');
    });

    it('rings the current and the hovered page in 2px, from the one width the viewer draws both rings from', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--image-border-width: 2px;');
        // The viewer's own current page ring is drawn from that width, so it is not redrawn here.
        expect(html).not.toContain('--image-current-shadow');
    });

    it('gives the Pages panel the background of the toolbar, for the panel and for its header', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('--sidebar-bg-color: var(--toolbar-bg-color);');
        expect(html).toContain('--header-bg: var(--toolbar-bg-color);');
        expect(html).toContain('--sidebar-backdrop-filter: none;');
    });

    it('makes the header of the Pages panel as high as the toolbar, round buttons of 32px', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('#viewsManager #viewsManagerHeader #viewsManagerTitle { padding-block: calc((var(--toolbar-height) - 32px) / 2); }');
    });

    it('halves the gap between the pages of the Pages panel to 22px', () => {
        expect(buildViewerHtml(options())).toContain('#viewsManager #viewsManagerContent #thumbnailsView { gap: 22px; }');
    });

    it('leaves the colours of the Pages panel to the viewer when the system forces its colours', () => {
        const html = buildViewerHtml(options());
        expect(html).toMatch(/@media not \(forced-colors: active\) \{\s*#viewsManager \{/);
    });

    it('gives the dialogs the background of the toolbar, unless the system forces its colours', () => {
        const html = buildViewerHtml(options());
        expect(html).toMatch(/@media not \(forced-colors: active\) \{\s*dialog \{ background-color: var\(--toolbar-bg-color\); \}/);
    });

    it('casts the page shadow of the diff view from a pseudo-element inside the 9px border of each page, unless the system forces its colours', () => {
        const html = buildViewerHtml(options());
        expect(html).toMatch(/@media not \(forced-colors: active\) \{\s*\.pdfViewer \.page::before \{[^}]*position: absolute; inset: 0; pointer-events: none;\s*box-shadow: var\(--lpdf-page-shadow\);/);
    });

    it('does not show the separator before the unused more button', () => {
        expect(buildViewerHtml(options())).toContain('#toolbarViewerRight > .verticalToolbarSeparator { display: none; }');
    });

    it('lets the left and right toolbar groups share the free space so the middle one is centred', () => {
        const html = buildViewerHtml(options());
        expect(html).toMatch(/#toolbarViewerLeft,\s*#toolbarContainer #toolbarViewer #toolbarViewerRight \{ flex: 1 1 0; \}/);
    });

    it('drops the page buttons, then the page count, then the fit toggle, then the zoom buttons as the toolbar narrows', () => {
        const html = buildViewerHtml(options());
        const widthOf = (selector: string): number => {
            const rule = new RegExp(String.raw`@container \(max-width: (\d+)px\) \{ ${selector} \{ display: none; \} \}`).exec(html);
            if (!rule) { throw new Error(`No narrow-toolbar rule for ${selector}`); }
            return Number(rule[1]);
        };
        const pageButtons = widthOf(String.raw`\.lpdf-pages`);
        const pageCount = widthOf('#numPages');
        const fitToggle = widthOf(String.raw`\.lpdf-fit`);
        const zoomButtons = widthOf('#zoomOutButton, #zoomInButton');
        expect(pageButtons).toBeGreaterThan(pageCount);
        expect(pageCount).toBeGreaterThan(fitToggle);
        expect(fitToggle).toBeGreaterThan(zoomButtons);
    });

    it('sizes the toolbar by its own width, not the window, so an open sidebar counts', () => {
        expect(buildViewerHtml(options())).toContain('#toolbarContainer { container-type: inline-size; }');
    });

    it('lets the viewer shrink with a narrow editor column instead of keeping its 350px minimum', () => {
        expect(buildViewerHtml(options())).toContain('#mainContainer { min-width: 0; }');
    });

    it('gives the toolbar fields a line as high as an icon, less the border, with 2px of padding above and below', () => {
        expect(buildViewerHtml(options())).toContain('font-size: 12px; line-height: calc(var(--icon-size) - 2px); padding-block: 2px;');
    });

    it('sets the height of the toolbar fields outright, 4px more than an icon, as an older Chromium does not follow the line height', () => {
        expect(buildViewerHtml(options())).toMatch(/\.toolbarField \{\s*box-sizing: border-box; height: calc\(var\(--icon-size\) \+ 4px\);/);
    });

    it('sizes the page and zoom boxes by the characters they hold', () => {
        const html = buildViewerHtml(options());
        expect(html).toContain('#pageNumber { width: 4ch; padding-inline: 6px; }');
        expect(html).toContain('#lpdfZoomInput { width: 5.5ch; padding-inline: 2px;');
    });

    it('removes the body padding VS Code adds to a webview, which would overflow the viewer', () => {
        expect(buildViewerHtml(options())).toMatch(/html body \{ padding: 0; \}/);
    });

    it('rejects a viewer page that has no body', () => {
        expect(() => buildViewerHtml(options({ viewerHtml: '<html></html>' }))).toThrow(ViewerMarkupError);
    });
});
