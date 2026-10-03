import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.join(__dirname, '..', 'media', 'pdf-diff.html'), 'utf8');

/** The page's own CSS, without its comments. */
const css = (/<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the diff view page', () => {
    it('loads the stylesheet that it shares with the viewer', () => {
        expect(page).toContain('<link rel="stylesheet" href="__VIEWER_HREF__lpdf-theme.css">');
    });

    it('has no colour of its own, so it looks as the viewer does', () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    });

    it('takes the colours of the header and of the area behind the pages from the shared stylesheet', () => {
        expect(css).toMatch(/#toolbar \{[^}]*background: var\(--lpdf-header-bg\)/);
        expect(css).toMatch(/\.pane-scroll \{[^}]*background: var\(--lpdf-desk-bg\)/);
        expect(css).toMatch(/\.pane-label \{[^}]*background: var\(--lpdf-header-bg\)/);
    });

    it('takes no colour from the theme variables of VS Code, which would make it differ from the viewer', () => {
        expect(css).not.toMatch(/--vscode-(?!font-family)/);
    });

    it('tells the page whether the VS Code theme is light or dark, which the shared colours follow', () => {
        expect(css).toContain('body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }');
    });

    it('removes the padding that VS Code puts on a webview body, so the header and the panes run edge to edge', () => {
        expect(css).toContain('html body { padding: 0; }');
    });

    it('has the zoom controls of the viewer: minus, a field to type a zoom in, plus, a divider and the fit button', () => {
        const order = ['id="btn-zoom-out"', 'id="zoom-input"', 'id="btn-zoom-in"', 'class="separator"', 'id="btn-fit"'];
        const positions = order.map(marker => page.indexOf(marker));
        expect(positions.every(position => position > 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('draws its buttons with the icons of the shared stylesheet', () => {
        for (const icon of ['minus', 'plus', 'fit-width', 'fit-page']) {
            expect(css).toContain(`mask-image: var(--lpdf-icon-${icon});`);
        }
    });

    it('has no dropdown of zoom levels any more', () => {
        expect(page).not.toContain('<select');
    });

    it('has an info button at the right of the header, which opens the document properties', () => {
        expect(page).toMatch(/<div id="toolbar-right">\s*<button class="tool" id="btn-info" type="button" title="Document properties"/);
        expect(css).toMatch(/#toolbar-right \{[^}]*justify-content: flex-end;/);
        expect(page).toContain(`infoButton.addEventListener('click'`);
        expect(page).toContain('infoDialog.showModal();');
    });

    it('draws the info button with the info icon of the viewer, which is in the folder that the viewer is in', () => {
        // The address is relative to the viewer folder, which the page knows as viewerRoot.
        const icon = /\$\{viewerRoot\}([\w/.-]+\.svg)/.exec(page)?.[1];
        expect(icon).toBe('web/images/secondaryToolbarButton-documentProperties.svg');
        expect(fs.existsSync(path.join(__dirname, '..', 'media', 'viewer', icon ?? ''))).toBe(true);
        expect(css).toContain('mask-image: var(--info-icon);');
    });

    it('shows the properties in a dialog with a column for HEAD and one for the working copy, and a Close button', () => {
        const dialog = /<dialog id="info-dialog"[\s\S]*?<\/dialog>/.exec(page)?.[0] ?? '';
        expect(dialog).toContain('<th scope="col">HEAD</th><th scope="col">Working copy</th>');
        expect(dialog).toContain('<tbody id="info-body"></tbody>');
        expect(dialog).toContain('id="info-close"');
    });

    it('dresses the dialog as the viewer dresses its own: the header background, border, shadow, backdrop and buttons', () => {
        expect(css).toMatch(/#info-dialog \{[^}]*background-color: var\(--lpdf-header-bg\);/);
        expect(css).toMatch(/#info-dialog \{[^}]*border: 1px solid var\(--lpdf-dialog-border\);[^}]*box-shadow: var\(--lpdf-dialog-shadow\);/);
        expect(css).toMatch(/#info-dialog::backdrop \{[^}]*background-color: var\(--lpdf-dialog-backdrop\);/);
        expect(css).toMatch(/\.secondary-button \{[^}]*background-color: var\(--lpdf-dialog-button-bg\);/);
        expect(css).toMatch(/\.info-table tr\.changed > \* \{[^}]*background-color: var\(--lpdf-changed-bg\);/);
    });

    it('passes the name of the file to the dialog, which the documents themselves do not know', () => {
        expect(page).toContain('loadDiff(msg.oldBase64, msg.newBase64, msg.filename)');
    });

    it('sizes its header as the viewer does: 36px, with buttons of 32px and icons of 18px', () => {
        expect(css).toMatch(/#toolbar \{[^}]*height: 36px;/);
        expect(css).toMatch(/\.tool \{[^}]*width: 32px; height: 32px;/);
        expect(css).toMatch(/\.tool::before \{[^}]*width: 18px; height: 18px;/);
    });

    it('keeps each pane label above its scrolling area, not inside it, so the label does not scroll sideways', () => {
        const pane = /<div class="diff-pane">\s*<div class="pane-label">[\s\S]*?<\/div>\s*<div class="pane-scroll" id="left-pane">/.exec(page);
        expect(pane).not.toBeNull();
        expect(css).toMatch(/\.pane-scroll \{[^}]*overflow: auto;/);
        expect(css).toMatch(/\.diff-pane \{[^}]*overflow: hidden;/);
    });

    it('listens for the wheel with a handler that may cancel it, which a pinch needs to stop the page zooming', () => {
        expect(page).toMatch(/document\.addEventListener\('wheel',[\s\S]*?\{ passive: false \}\);/);
    });

    it('zooms a pinch only when the gesture is one, and leaves a plain wheel turn to scroll', () => {
        expect(page).toMatch(/if \(!isZoomGesture\(event\)\) \{ return; \}/);
    });

    it('draws the pages again at the new zoom only once the zoom has settled', () => {
        expect(page).toContain('const SETTLE_MS = 150;');
        expect(page).toContain('clearTimeout(settleTimer);');
    });

    it('shows each page as a blank sheet that casts the page shadow, with the canvas inside it, not the other way round', () => {
        expect(css).toMatch(/\.page-slot \{[^}]*background: var\(--lpdf-page-bg\); box-shadow: var\(--lpdf-page-shadow\);/);
        expect(css).toMatch(/\.page-slot \{[^}]*position: relative;/);
        expect(css).toMatch(/\.page-slot canvas \{[^}]*position: absolute;/);
        expect(css).not.toMatch(/(^|\})\s*canvas \{/);
    });

    it('draws only the pages in or near the view, which an observer of each pane tells it', () => {
        expect(page).toContain(`import { canvasRatio, DRAW_MARGIN, fitsWhole, planPages, REDRAW_MARGIN, visibleRegion } from '__VIEWER_URI__lpdf-diff-pages.mjs';`);
        expect(page).toMatch(/new IntersectionObserver\([\s\S]*?\{ root: side\.pane, rootMargin: `\$\{NEAR_VIEW_PERCENT\}% 0px` \}\);/);
        expect(page).toContain('planPages({ wanted, drawn: side.drawn, target })');
    });

    it('gives the memory of a page that has left the view back at once, and the page its resources', () => {
        expect(page).toMatch(/function clearSlot\(slot\) \{[^}]*canvas\.width = 0; canvas\.height = 0;/);
        expect(page).toContain('side.pages[index].cleanup();');
    });

    it('limits the size of every canvas, whatever the zoom and the screen', () => {
        expect(page).toContain('canvasRatio(region.width, region.height, window.devicePixelRatio || 1)');
    });

    it('draws nothing while the zoom is still changing, but waits for it to settle', () => {
        expect(page).toContain('if (settleTimer !== undefined) { return; }');
        expect(page).toMatch(/settleTimer = setTimeout\(async \(\) => \{[\s\S]*?settleTimer = undefined;[\s\S]*?finish\(\);/);
    });

    it('draws a page too large for one canvas only where it is in view, and again as a scroll leaves it', () => {
        expect(page).toContain('fitsWhole(box.width, box.height, deviceRatio)');
        expect(page).toContain('visibleRegion(view, box, REDRAW_MARGIN)');
        expect(page).toContain('visibleRegion(side.pane.getBoundingClientRect(), box, DRAW_MARGIN)');
        expect(page).toMatch(/offsetX: -region\.left \* ratio, offsetY: -region\.top \* ratio/);
        expect(page).toMatch(/side\.pane\.addEventListener\('scroll', \(\) => \{[\s\S]*?requestAnimationFrame/);
    });

    it('places a canvas by percentages of its sheet, so it follows the sheet while the zoom changes', () => {
        expect(page).toContain('left:   `${region.left / box.width * 100}%`');
        expect(page).toContain('height: `${region.height / box.height * 100}%`');
    });

    it('zooms over the range of the full viewer, not a range relative to the fit', () => {
        expect(page).toContain('clampScale(scale)');
        expect(page).not.toContain('clampScale(scale, fitWidthScale)');
    });

    it('does not draw every page of a document, as it once did', () => {
        expect(page).not.toMatch(/for \(let p = 1; p <= \w+\.numPages; p\+\+\)/);
        expect(page).not.toContain('renderAll');
    });

    it('keeps a fit a fit when the pane changes size', () => {
        expect(page).toContain('new ResizeObserver(');
        expect(page).toContain(`if (fitMode !== 'manual')`);
    });
});
