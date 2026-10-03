// The simplified header of the full viewer, with VS Code's default webview styles around the page.
import { createChecker, fixturePdf, shotPath, startEnvironment, wait } from './support.mjs';

const env = await startEnvironment();
const VSCODE_DEFAULT_STYLES = `<style id="_defaultStyles">
html { scrollbar-color: #424242 #1e1e1e; }
body { background-color: transparent; color: #ccc; font-family: "Segoe UI", sans-serif; font-size: 13px; margin: 0; padding: 0 20px; }
img, video { max-width: 100%; max-height: 100%; }
a:focus, input:focus, select:focus, textarea:focus { outline: 1px solid -webkit-focus-ring-color; outline-offset: -1px; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background-color: #79797966; }
</style>`;
const pages = await env.serve(env.viewerHtml.replace('<head>', `<head>\n${VSCODE_DEFAULT_STYLES}`));
const b64 = fixturePdf('bench_m.pdf');
const browser = env.browser;
const problems = [];
const { check, finish } = createChecker();

async function open(width, height = 700) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    page.on('console', m => { if (m.type() === 'error') { problems.push(`console.error: ${m.text()}`); } });
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
    await page.evaluateOnNewDocument(() => {
        window.__posts = [];
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI.slice(0, 40)}`));
        window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
        document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'));
    });
    await page.goto(`http://127.0.0.1:${pages.port}/`);
    await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 });
    await page.evaluate(b => window.postMessage({ type: 'updatePdf', pdfBase64: b, filename: 'd.pdf', zoom: 'fit' }, '*'), b64);
    await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0 && document.querySelector('.page canvas'), { timeout: 20000 });
    await wait(600);
    return page;
}
const viewerState = page => page.evaluate(() => {
    const v = window.PDFViewerApplication.pdfViewer;
    return {
        scale: Math.round(v.currentScale * 100) / 100, scaleValue: v.currentScaleValue, page: v.currentPageNumber, spread: v.spreadMode,
        zoomText: document.getElementById('lpdfZoomInput').value, fitNext: document.getElementById('lpdfFitButton').dataset.next,
    };
});
const typeInto = async (page, selector, text, key = 'Enter') => {
    await page.click(selector);
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type(text);
    await page.keyboard.press(key);
};
const pressed = (page, id) => page.evaluate(i => document.getElementById(i).getAttribute('aria-pressed'), id);

const page = await open(1100);
let st = await viewerState(page);
check('header starts and shows the zoom as a percentage', /^\d+%$/.test(st.zoomText), JSON.stringify(st));

// What the header holds, in order from the left.
const layout = await page.evaluate(() => {
    const ids = ['viewsManagerToggleButton', 'viewFindButton', 'pageNumber', 'numPages', 'zoomOutButton', 'lpdfZoomInput', 'zoomInButton', 'lpdfFitButton', 'lpdfTwoPageButton', 'lpdfCoverButton', 'downloadButton', 'documentProperties'];
    const shown = id => { const e = document.getElementById(id); return e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; };
    const lefts = ids.filter(shown).map(id => [id, Math.round(document.getElementById(id).getBoundingClientRect().left)]);
    const hidden = ['previous', 'next', 'scaleSelectContainer', 'printButton', 'editorModeButtons', 'secondaryToolbarToggleButton'].filter(id => shown(id));
    return { order: lefts.map(([id]) => id), sorted: lefts.every((x, i) => i === 0 || x[1] >= lefts[i - 1][1]), missing: ids.filter(id => !shown(id)), shouldBeHidden: hidden };
});
check('every control of the header is there', layout.missing.length === 0, `missing: ${layout.missing.join(', ')}`);
check('the controls are in the intended order, left to right', layout.sorted && layout.order.join(' ') === 'viewsManagerToggleButton viewFindButton pageNumber numPages zoomOutButton lpdfZoomInput zoomInButton lpdfFitButton lpdfTwoPageButton lpdfCoverButton downloadButton documentProperties', layout.order.join(' '));
check('prev/next, zoom dropdown, print, editing tools and the more button are gone', layout.shouldBeHidden.length === 0, layout.shouldBeHidden.join(', '));
await page.screenshot({ path: shotPath('header-1100.png'), clip: { x: 0, y: 0, width: 1100, height: 60 } });

// One gap between neighbouring controls in each group, a 40px bar, 36px buttons and 20px icons.
const sizes = await page.evaluate(() => {
    const rect = id => document.getElementById(id).getBoundingClientRect();
    const gap = (a, b) => Math.round((rect(b).left - rect(a).right) * 10) / 10;
    const icon = getComputedStyle(document.getElementById('viewFindButton'), '::before');
    const field = id => Math.round(rect(id).height * 10) / 10;
    return {
        bar: rect('toolbarContainer').height, button: rect('viewFindButton').height, icon: icon.width + ' x ' + icon.height,
        left: gap('viewsManagerToggleButton', 'viewFindButton'),
        middle: [gap('zoomOutButton', 'lpdfZoomInput'), gap('lpdfZoomInput', 'zoomInButton'), gap('lpdfFitButton', 'lpdfTwoPageButton'), gap('lpdfTwoPageButton', 'lpdfCoverButton')],
        right: gap('downloadButton', 'documentProperties'),
        pageToCount: gap('pageNumber', 'numPages'),
        countToDivider: Math.round((document.querySelector('#toolbarViewerMiddle > .verticalToolbarSeparator').getBoundingClientRect().left - rect('numPages').right) * 10) / 10,
        dividerToMinus: Math.round((rect('zoomOutButton').left - document.querySelector('#toolbarViewerMiddle > .verticalToolbarSeparator').getBoundingClientRect().right) * 10) / 10,
        pageBox: [rect('pageNumber').width, field('pageNumber')], zoomBox: [rect('lpdfZoomInput').width, field('lpdfZoomInput')],
        padding: [getComputedStyle(document.getElementById('pageNumber')).paddingInline, getComputedStyle(document.getElementById('lpdfZoomInput')).paddingInline],
    };
});
console.log('sizes', JSON.stringify(sizes));
check('the bar is 36px high, the buttons 32px (2px of bar above and below) and the icons 18px', sizes.bar === 36 && sizes.button === 32 && sizes.icon === '18px x 18px', JSON.stringify([sizes.bar, sizes.button, sizes.icon]));
check('the same 6px gap between neighbours on the left, in the middle and on the right', sizes.left === 6 && sizes.middle.every(g => g === 6) && sizes.right === 6 && sizes.pageToCount === 6, JSON.stringify([sizes.left, sizes.middle, sizes.right, sizes.pageToCount]));
check('the page box has 6px of padding at the sides, the zoom box 2px', sizes.padding[0] === '6px' && sizes.padding[1] === '2px', sizes.padding.join(' '));
check('the total page count is 12px from the divider after it, and the divider 12px from the next button', sizes.countToDivider === 12 && sizes.dividerToMinus === 12, JSON.stringify([sizes.countToDivider, sizes.dividerToMinus]));
check('the page and zoom boxes are 22px high: the icon height plus 2px of padding above and below', sizes.pageBox[1] === 22 && sizes.zoomBox[1] === 22, JSON.stringify([sizes.pageBox, sizes.zoomBox]));

// Document properties as an icon.
const info = await page.evaluate(() => {
    const b = document.getElementById('documentProperties');
    const cs = getComputedStyle(b, '::before');
    const r = b.getBoundingClientRect();
    return { mask: /documentProperties/.test(cs.maskImage), text: getComputedStyle(b.querySelector('span')).width, w: Math.round(r.width), h: Math.round(r.height), title: b.title, labeled: b.classList.contains('labeled') };
});
check('document properties is an icon button with the viewer\'s info icon and a tooltip', info.mask && info.w === info.h && !info.labeled && /Document Properties/.test(info.title), JSON.stringify(info));
await page.click('#documentProperties'); await wait(700);
check('the info button opens the document properties', await page.evaluate(() => document.getElementById('documentPropertiesDialog').open === true));
await page.keyboard.press('Escape'); await wait(300);

// Zoom field, buttons, gestures.
await typeInto(page, '#lpdfZoomInput', '150'); await wait(500);
st = await viewerState(page);
check('typing 150 in the zoom field zooms to 150%', st.scale === 1.5 && st.zoomText === '150%', JSON.stringify(st));
await typeInto(page, '#lpdfZoomInput', 'abc'); await wait(300);
st = await viewerState(page);
check('text that is not a number puts the old zoom back', st.scale === 1.5 && st.zoomText === '150%');
let before = st.scale;
await page.click('#zoomInButton'); await wait(400);
st = await viewerState(page);
check('the + button zooms in and the field follows', st.scale > before && st.zoomText === `${Math.round(st.scale * 100)}%`, JSON.stringify(st));
await page.evaluate(() => { const c = document.getElementById('viewerContainer'); const r = c.getBoundingClientRect(); c.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, ctrlKey: true, clientX: r.left + 300, clientY: r.top + 200, bubbles: true, cancelable: true })); });
before = st.scale; await wait(700);
st = await viewerState(page);
check('Ctrl and the mouse wheel still zoom, and the field follows', st.scale > before && st.zoomText === `${Math.round(st.scale * 100)}%`);

// Fit toggle.
await page.click('#lpdfFitButton'); await wait(500);
st = await viewerState(page);
check('the fit toggle fits the width from a manual zoom', st.scaleValue === 'page-width' && st.fitNext === 'page');
await page.click('#lpdfFitButton'); await wait(500);
st = await viewerState(page);
check('the fit toggle then fits the page', st.scaleValue === 'page-fit' && st.fitNext === 'width');
await page.click('#lpdfFitButton'); await wait(500);

// Page box.
await typeInto(page, '#pageNumber', '5'); await wait(600);
check('the page box goes to the page typed', (await viewerState(page)).page === 5);

// Two page and cover buttons.
check('the two page button starts off', (await pressed(page, 'lpdfTwoPageButton')) === 'false');
check('the cover button starts greyed out in single page view', await page.evaluate(() => document.getElementById('lpdfCoverButton').disabled));
await page.click('#lpdfTwoPageButton'); await wait(900);
st = await viewerState(page);
check('the two page button puts page 1 beside page 2', st.spread === 1, JSON.stringify(st));
check('the two page button shows as on, and the cover button becomes available', (await pressed(page, 'lpdfTwoPageButton')) === 'true' && (await page.evaluate(() => !document.getElementById('lpdfCoverButton').disabled)));
check('the two page button is drawn highlighted when on', await page.evaluate(() => document.getElementById('lpdfTwoPageButton').classList.contains('toggled')));
await page.screenshot({ path: shotPath('header-two-page.png'), clip: { x: 0, y: 0, width: 1100, height: 60 } });
await page.click('#lpdfCoverButton'); await wait(900);
st = await viewerState(page);
const firstRow = await page.evaluate(() => { const rows = [...document.querySelectorAll('.spread')]; return rows[0] ? rows[0].querySelectorAll('.page').length : -1; });
check('the cover button shows page 1 alone', st.spread === 2 && firstRow === 1 && (await pressed(page, 'lpdfCoverButton')) === 'true', `spread=${st.spread} firstRow=${firstRow}`);
await page.evaluate(b => window.postMessage({ type: 'updatePdf', pdfBase64: b, filename: 'd.pdf' }, '*'), b64);
await wait(2200);
st = await viewerState(page);
check('a re-render keeps the two page view with the cover apart, and the buttons show it', st.spread === 2 && (await pressed(page, 'lpdfTwoPageButton')) === 'true' && (await pressed(page, 'lpdfCoverButton')) === 'true', JSON.stringify(st));
await page.click('#lpdfTwoPageButton'); await wait(800);
st = await viewerState(page);
check('turning two page view off goes back to single pages and greys the cover button', st.spread === 0 && (await page.evaluate(() => document.getElementById('lpdfCoverButton').disabled)));
await page.click('#lpdfTwoPageButton'); await wait(800);
st = await viewerState(page);
check('turning it on again remembers the cover choice', st.spread === 2, JSON.stringify(st));

// Save and search.
await page.click('#downloadButton'); await wait(400);
check('save is posted to the extension host', await page.evaluate(() => window.__posts.some(p => p.type === 'download')));
await page.click('#viewFindButton'); await wait(300);
await page.keyboard.type('layout'); await page.keyboard.press('Enter'); await wait(1200);
check('search finds matches', /\d/.test(await page.evaluate(() => document.getElementById('findResultsCount').textContent)));
const popup = await page.evaluate(() => { const r = document.getElementById('findbar').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), within: r.right <= innerWidth && r.left >= 0 }; });
check('the search popup opens inside the window', popup.within, JSON.stringify(popup));
check('no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(' | '));
await page.close();

// Narrow windows.
console.log('\nwidth | off-centre | overlap | right edge | shown');
for (const w of [1500, 1100, 700, 460, 441, 440, 420, 400, 383, 382, 360, 343, 342, 330, 320, 309, 308, 290, 270, 250, 238, 236, 230]) {
    const p = await open(w);
    const m = await p.evaluate(() => {
        const r = id => document.getElementById(id).getBoundingClientRect();
        const L = r('toolbarViewerLeft'), M = r('toolbarViewerMiddle'), R = r('toolbarViewerRight');
        const vis = id => document.getElementById(id).offsetParent !== null;
        return { off: Math.round((M.left + M.right) / 2 - innerWidth / 2), overlap: L.right > M.left + 0.5 || M.right > R.left + 0.5, right: Math.round(r('documentProperties').right),
            shown: [vis('lpdfTwoPageButton') ? '2pg' : '-', vis('numPages') ? 'count' : '-', vis('lpdfFitButton') ? 'fit' : '-', vis('zoomOutButton') ? '+/-' : '-'].join(' '),
            gap: Math.round(r('viewFindButton').left - r('viewsManagerToggleButton').right) };
    });
    console.log(`${String(w).padStart(5)} | ${String(m.off).padStart(5)}px | ${m.overlap ? 'OVERLAP' : '       '} | ${m.right}/${w}${m.right > w ? ' CLIPPED' : ''} | [${m.shown}] gap ${m.gap}`);
    if (w === 700 || w === 400) { await p.screenshot({ path: shotPath(`header-${w}.png`), clip: { x: 0, y: 0, width: w, height: 60 } }); }
    await p.close();
}
check('no console errors', problems.length === 0, [...new Set(problems)].join(' | '));
await env.close();
finish();
