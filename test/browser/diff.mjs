// The diff view: shares its colours and header with the viewer, pinch zoom applies to both panes,
// the labels stay put on a sideways scroll, and the fit toggle and zoom field work.
// Run with `dark` or `light`: the theme class a webview puts on the body.
import { createChecker, fixturePdf, shotPath, startEnvironment } from './support.mjs';

const scheme = process.argv[2] ?? 'dark';
const outPrefix = 'diff';
const a = fixturePdf('example10.pdf');
const b = fixturePdf('example9.pdf');
const env = await startEnvironment();
const diffServer = await env.serve(env.diffHtml);
const viewerServer = await env.serve(env.viewerHtml);
const browser = env.browser;
const { check, finish } = createChecker();
const problems = [];

// What a VS Code webview does to the page: the theme class on the body, and its default body padding.
const prepare = async page => {
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) { problems.push(`${m.type()}: ${m.text().slice(0, 160)}`); } });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(cls => {
        window.__posts = [];
        window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
        document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = 'body{padding:0 20px}';
            document.head.prepend(s);
            document.body.classList.add(cls);
        });
    }, scheme === 'light' ? 'vscode-light' : 'vscode-dark');
};

// ---- the viewer, for its colours
const viewerPage = await browser.newPage();
await viewerPage.setViewport({ width: 1100, height: 700 });
await prepare(viewerPage);
await viewerPage.goto(`http://127.0.0.1:${viewerServer.port}/`);
await viewerPage.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
await viewerPage.evaluate(x => window.postMessage({ type: 'updatePdf', pdfBase64: x, filename: 'a.pdf', zoom: 'fit' }, '*'), a);
await viewerPage.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0, { timeout: 30000 });
await new Promise(r => setTimeout(r, 600));
const viewerLook = await viewerPage.evaluate(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    const rect = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
    return {
        header: css('#toolbarContainer', 'backgroundColor'), desk: css('body', 'backgroundColor'),
        headerHeight: rect('#toolbarContainer').h, button: rect('#zoomOutButton'), field: rect('#lpdfZoomInput'),
        fieldBg: css('#lpdfZoomInput', 'backgroundColor'), fieldBorder: css('#lpdfZoomInput', 'borderTopColor'), fieldColor: css('#lpdfZoomInput', 'color'),
        iconColor: getComputedStyle(document.querySelector('#zoomOutButton'), '::before').backgroundColor,
    };
});
await viewerPage.screenshot({ path: shotPath(`${outPrefix}-${scheme}-viewer.png`) });

// ---- the diff view
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
await prepare(page);
await page.goto(`http://127.0.0.1:${diffServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
await page.evaluate((x, y) => window.postMessage({ type: 'updateDiff', oldBase64: x, newBase64: y }, '*'), a, b);
await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 600));

// ---- the same colours as the viewer, in this theme
const diffLook = await page.evaluate(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    const rect = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, left: Math.round(b.left * 10) / 10 }; };
    return {
        header: css('#toolbar', 'backgroundColor'), label: css('.pane-label', 'backgroundColor'), desk: css('.pane-scroll', 'backgroundColor'), body: css('body', 'backgroundColor'),
        headerHeight: rect('#toolbar').h, toolbarLeft: rect('#toolbar').left, button: rect('#btn-zoom-out'), field: rect('#zoom-input'),
        fieldBg: css('#zoom-input', 'backgroundColor'), fieldBorder: css('#zoom-input', 'borderTopColor'), fieldColor: css('#zoom-input', 'color'),
        iconColor: getComputedStyle(document.querySelector('#btn-zoom-out'), '::before').backgroundColor,
        iconMask: getComputedStyle(document.querySelector('#btn-fit'), '::before').maskImage.slice(0, 30),
        colorScheme: getComputedStyle(document.body).colorScheme,
    };
});
const EXPECTED = { dark: { header: 'rgb(56, 56, 61)', desk: 'rgb(42, 42, 46)' }, light: { header: 'rgb(249, 249, 250)', desk: 'rgb(212, 212, 215)' } }[scheme];
check(`the header of the viewer is the palette header colour in the ${scheme} theme`, viewerLook.header === EXPECTED.header, viewerLook.header);
check('the header of the diff view is the same as the header of the viewer', diffLook.header === viewerLook.header, `${diffLook.header} vs ${viewerLook.header}`);
check('the pane labels are the same colour as that header', diffLook.label === diffLook.header, diffLook.label);
check('the area behind the pages is the same in the diff view as in the viewer', diffLook.desk === viewerLook.desk && diffLook.body === viewerLook.desk && viewerLook.desk === EXPECTED.desk, `${diffLook.desk} ${diffLook.body} vs ${viewerLook.desk}`);
check('the zoom field has the colours of the viewer field', diffLook.fieldBg === viewerLook.fieldBg && diffLook.fieldBorder === viewerLook.fieldBorder && diffLook.fieldColor === viewerLook.fieldColor, `${diffLook.fieldBg} ${diffLook.fieldBorder} ${diffLook.fieldColor}`);
check('the icons are drawn in the colour of the icons of the viewer', diffLook.iconColor === viewerLook.iconColor, `${diffLook.iconColor} vs ${viewerLook.iconColor}`);
check(`the page follows the ${scheme} theme (color-scheme)`, diffLook.colorScheme === scheme, diffLook.colorScheme);
check('the header runs edge to edge, with no padding from the webview body', diffLook.toolbarLeft === 0, String(diffLook.toolbarLeft));
check('the header is as high as the viewer header', diffLook.headerHeight === viewerLook.headerHeight, `${diffLook.headerHeight} vs ${viewerLook.headerHeight}`);
check('the buttons and the zoom field are the size of those of the viewer', diffLook.button.w === viewerLook.button.w && diffLook.button.h === viewerLook.button.h && diffLook.field.h === viewerLook.field.h, JSON.stringify([diffLook.button, viewerLook.button, diffLook.field, viewerLook.field]));
check('the fit button draws an icon of the shared stylesheet', diffLook.iconMask.startsWith('url("data:image/svg+xml'), diffLook.iconMask);
await page.screenshot({ path: shotPath(`${outPrefix}-${scheme}-start.png`) });

const spacing = await page.evaluate(() => {
    const r = id => document.getElementById(id).getBoundingClientRect();
    const sep = document.querySelector('.separator').getBoundingClientRect();
    return { minusToField: Math.round((r('zoom-input').left - r('btn-zoom-out').right) * 10) / 10, fieldToPlus: Math.round((r('btn-zoom-in').left - r('zoom-input').right) * 10) / 10, plusToDivider: Math.round((sep.left - r('btn-zoom-in').right) * 10) / 10, dividerToFit: Math.round((r('btn-fit').left - sep.right) * 10) / 10 };
});
check('the controls are 6px apart, and a divider has 12px on each side, as in the viewer', spacing.minusToField === 6 && spacing.fieldToPlus === 6 && spacing.plusToDivider === 12 && spacing.dividerToFit === 12, JSON.stringify(spacing));

const geometry = () => page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left * 10) / 10, top: Math.round(b.top * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 }; };
    const labels = [...document.querySelectorAll('.pane-label')].map(r);
    const panes = [...document.querySelectorAll('.pane-scroll')];
    return {
        labels, panes: panes.map(r), scrollLeft: panes.map(p => p.scrollLeft), scrollTop: panes.map(p => p.scrollTop),
        zoomText: document.getElementById('zoom-input').value, fitNext: document.getElementById('btn-fit').dataset.next,
        canvasWidths: [document.querySelector('#left-inner .page-slot'), document.querySelector('#right-inner .page-slot')].map(c => Math.round(parseFloat(c.style.width) * 10) / 10),
        canvasHeight: Math.round(parseFloat(document.querySelector('#left-inner .page-slot').style.height)),
    };
});
const settle = ms => new Promise(r => setTimeout(r, ms));

// ---- the zoom field and the fit toggle
const fitGeo = await geometry();
check('the zoom field shows the zoom as a percentage, and the fit button offers the whole page', /^\d+%$/.test(fitGeo.zoomText) && fitGeo.fitNext === 'page', `${fitGeo.zoomText} ${fitGeo.fitNext}`);
await page.click('#btn-fit');
await settle(1200);
const pageFit = await geometry();
check('the fit button fits the whole page in the pane, so the page is shorter than the pane', pageFit.canvasHeight <= pageFit.panes[0].height && pageFit.canvasWidths[0] < fitGeo.canvasWidths[0], `${pageFit.canvasHeight} in ${pageFit.panes[0].height}, width ${fitGeo.canvasWidths[0]} -> ${pageFit.canvasWidths[0]}`);
check('after that the button offers the page width again, and both panes took the zoom', pageFit.fitNext === 'width' && pageFit.canvasWidths[0] === pageFit.canvasWidths[1], `${pageFit.fitNext} ${pageFit.canvasWidths}`);
await page.click('#btn-fit');
await settle(1200);
const widthFit = await geometry();
check('the fit button fits the page width again', Math.abs(widthFit.canvasWidths[0] - fitGeo.canvasWidths[0]) < 0.5 && widthFit.fitNext === 'page', `${widthFit.canvasWidths[0]} ${widthFit.fitNext}`);
await page.click('#zoom-input');
await page.keyboard.type('150');
await page.keyboard.press('Enter');
await settle(400);
const typed = await geometry();
check('typing 150 in the zoom field zooms both panes to 150%', typed.zoomText === '150%' && Math.abs(typed.canvasWidths[0] - 595.3 * 1.5) < 2 && typed.canvasWidths[0] === typed.canvasWidths[1], `${typed.zoomText} ${typed.canvasWidths}`);
check('a zoom that was typed is not a fit, so the button offers the page width', typed.fitNext === 'width', typed.fitNext);
await page.click('#zoom-input');
await page.keyboard.type('abc');
await page.keyboard.press('Enter');
await settle(200);
check('text that is not a number puts the old zoom back', (await geometry()).zoomText === '150%', (await geometry()).zoomText);
await page.click('#btn-fit');
await settle(1200);

// ---- a fit stays a fit when the window changes size
const beforeResize = (await geometry()).canvasWidths[0];
await page.setViewport({ width: 800, height: 700 });
await settle(1500);
const afterResize = await geometry();
check('a fit follows the window when it is made narrower', afterResize.canvasWidths[0] < beforeResize && afterResize.canvasWidths[0] === afterResize.canvasWidths[1], `${beforeResize} -> ${afterResize.canvasWidths}`);
await page.setViewport({ width: 1100, height: 700 });
await settle(1500);

// ---- the labels stay put when the pages scroll sideways
const startGeo = await geometry();
for (let i = 0; i < 3; i++) { await page.click('#btn-zoom-in'); await settle(150); }
await settle(900);
await page.evaluate(() => { document.getElementById('left-pane').scrollLeft = 220; });
await settle(300);
const scrolled = await geometry();
check('zooming in gives the panes a horizontal scroll', scrolled.scrollLeft[0] > 0, `scrollLeft ${scrolled.scrollLeft}`);
check('the labels did not move when the pages were scrolled sideways', JSON.stringify(scrolled.labels) === JSON.stringify(startGeo.labels), JSON.stringify(scrolled.labels));
check('each label is as wide as its pane, so it never ends part way across', scrolled.labels.every((l, i) => l.width === scrolled.panes[i].width), JSON.stringify([scrolled.labels.map(l => l.width), scrolled.panes.map(p => p.width)]));
check('the other pane scrolled with it (sync scroll)', scrolled.scrollLeft[1] === scrolled.scrollLeft[0], String(scrolled.scrollLeft));
await page.screenshot({ path: shotPath(`${outPrefix}-${scheme}-scrolled.png`) });
await page.click('#btn-fit');
await settle(1200);
await page.click('#btn-fit');
await settle(1200);

// ---- pinch zoom, applied to both panes, around the pointer
const pinch = (paneId, dy, count, at) => page.evaluate(async (paneId, dy, count, at) => {
    const pane = document.getElementById(paneId);
    const box = pane.getBoundingClientRect();
    const x = box.left + box.width * at.x;
    const y = box.top + box.height * at.y;
    let prevented = 0;
    for (let i = 0; i < count; i++) {
        const e = new WheelEvent('wheel', { ctrlKey: true, deltaY: dy, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
        pane.dispatchEvent(e);
        if (e.defaultPrevented) { prevented++; }
        await new Promise(r => setTimeout(r, 16));
    }
    return { x, y, prevented };
}, paneId, dy, count, at);
const under = (x, y) => page.evaluate((x, y) => {
    const canvases = [...document.querySelectorAll('#left-inner .page-slot')];
    for (const c of canvases) {
        const b = c.getBoundingClientRect();
        if (y >= b.top && y <= b.bottom) { return { fy: Math.round((y - b.top) / b.height * 1000) / 1000, fx: Math.round((x - b.left) / b.width * 1000) / 1000, index: canvases.indexOf(c) }; }
    }
    return null;
}, x, y);
await page.evaluate(() => { document.getElementById('left-pane').scrollTop = 150; });
await settle(300);
const before = await geometry();
const point = { x: 0.5, y: 0.4 };
const leftBox = before.panes[0];
const px = leftBox.left + leftBox.width * point.x;
const py = leftBox.top + leftBox.height * point.y;
const anchorBefore = await under(px, py);
const p1 = await pinch('left-pane', -12, 25, point);
const during = await geometry();
check('a pinch on the left pane is cancelled, so the page itself does not zoom', p1.prevented === 25, `${p1.prevented} of 25`);
check('a pinch on the left pane zooms the pages of both panes', during.canvasWidths[0] > before.canvasWidths[0] * 1.5 && during.canvasWidths[1] === during.canvasWidths[0], `${before.canvasWidths} -> ${during.canvasWidths}`);
const anchorAfter = await under(px, py);
check('the part of the page under the pointer stays under it', Boolean(anchorBefore && anchorAfter) && anchorAfter.index === anchorBefore.index && Math.abs(anchorAfter.fy - anchorBefore.fy) < 0.01 && Math.abs(anchorAfter.fx - anchorBefore.fx) < 0.01, `${JSON.stringify(anchorBefore)} -> ${JSON.stringify(anchorAfter)}`);
check('the zoom field shows the percentage while pinching', /^\d+%$/.test(during.zoomText), during.zoomText);
await settle(1800);
const settled = await page.evaluate(() => {
    const left = document.querySelector('#left-inner canvas');
    const right = document.querySelector('#right-inner canvas');
    return { cssWidth: left.getBoundingClientRect().width, pixelWidth: left.width, ratio: window.devicePixelRatio, rightCss: right.getBoundingClientRect().width, rightPixels: right.width };
});
check('once the zoom settles both sides are drawn again at the new size', Math.abs(settled.pixelWidth - settled.cssWidth * settled.ratio) <= 1.5 && Math.abs(settled.rightPixels - settled.rightCss * settled.ratio) <= 1.5, JSON.stringify(settled));
const afterSettle = await geometry();
check('the scroll position did not move when the pages were drawn again', afterSettle.scrollTop[0] === during.scrollTop[0] && afterSettle.scrollLeft[0] === during.scrollLeft[0], `${during.scrollTop[0]},${during.scrollLeft[0]} -> ${afterSettle.scrollTop[0]},${afterSettle.scrollLeft[0]}`);
const near = await page.evaluate(() => {
    const total = document.querySelectorAll('#left-inner .page-slot').length;
    const drawn = [...document.querySelectorAll('#left-inner .page-slot')].map((s, i) => s.querySelector('canvas') ? i : -1).filter(i => i >= 0);
    const pane = document.getElementById('left-pane').getBoundingClientRect();
    const slots = [...document.querySelectorAll('#left-inner .page-slot')];
    const inView = slots.map((s, i) => { const b = s.getBoundingClientRect(); return b.bottom > pane.top && b.top < pane.bottom ? i : -1; }).filter(i => i >= 0);
    return { total, drawn, inView };
});
check('only pages in or near the view are drawn, not all of them', near.drawn.length > 0 && near.drawn.length < near.total && near.inView.every(i => near.drawn.includes(i)), JSON.stringify(near));
await pinch('right-pane', 12, 40, { x: 0.3, y: 0.6 });
await settle(1800);
const out = await geometry();
check('a pinch the other way on the right pane zooms out both panes', out.canvasWidths[0] < afterSettle.canvasWidths[0] && out.canvasWidths[0] === out.canvasWidths[1], `${afterSettle.canvasWidths} -> ${out.canvasWidths}`);
const unmodified = await page.evaluate(() => {
    const e = new WheelEvent('wheel', { deltaY: 40, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
    document.getElementById('left-pane').dispatchEvent(e);
    return e.defaultPrevented;
});
check('a wheel turn with no key held is left to scroll', unmodified === false);
await page.click('#btn-fit');
await settle(1500);
await page.click('#btn-fit');
await settle(1500);
const w0 = (await geometry()).canvasWidths[0];
await page.click('#btn-zoom-out');
await settle(250);
const w1 = (await geometry()).canvasWidths;
check('the zoom out button zooms both panes', w1[0] < w0 && w1[0] === w1[1], `${w0} -> ${w1}`);
await page.screenshot({ path: shotPath(`${outPrefix}-${scheme}-end.png`) });
check('no errors or warnings in the console', problems.filter(p => !/Invalid or corrupted/.test(p)).length === 0, problems.join(' | '));
await env.close();
finish();
