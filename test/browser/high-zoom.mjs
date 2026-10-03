// The diff view at its highest zoom: only what is in view is drawn, it is sharp, and memory stays small.
import { createChecker, fixturePdf, shotPath, startEnvironment, wait } from './support.mjs';

const dpr = Number(process.argv[2] ?? 2);
const file = process.argv[3] ?? 'bench_l.pdf';
const pdf = fixturePdf(file);
const env = await startEnvironment();
const server = await env.serve(env.diffHtml);
const browser = env.browser;
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: dpr });
const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') { problems.push(m.text().slice(0, 160)); } });
await page.evaluateOnNewDocument(() => {
    window.__posts = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
    document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'));
});
await page.goto(`http://127.0.0.1:${server.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
await page.evaluate(x => window.postMessage({ type: 'updateDiff', oldBase64: x, newBase64: x, filename: 'f.pdf' }, '*'), pdf);
await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), { timeout: 120000 });
const { check, finish } = createChecker();
const state = () => page.evaluate(() => {
    const out = { zoom: document.getElementById('zoom-input').value, sides: {} };
    for (const side of ['left', 'right']) {
        const slots = [...document.querySelectorAll(`#${side}-inner .page-slot`)];
        const pane = document.getElementById(`${side}-pane`).getBoundingClientRect();
        const canvases = slots.map((s, i) => ({ s, i, c: s.querySelector('canvas') })).filter(x => x.c);
        out.sides[side] = {
            total: slots.length,
            drawn: canvases.map(x => x.i),
            inView: slots.map((s, i) => { const b = s.getBoundingClientRect(); return b.bottom > pane.top && b.top < pane.bottom && b.right > pane.left && b.left < pane.right ? i : -1; }).filter(i => i >= 0),
            // For each page in view: does its canvas cover the part of the pane that the page is in?
            covers: slots.map((s, i) => {
                const b = s.getBoundingClientRect();
                const left = Math.max(b.left, pane.left), right = Math.min(b.right, pane.right - 15);
                const top = Math.max(b.top, pane.top), bottom = Math.min(b.bottom, pane.bottom - 15);
                if (right <= left || bottom <= top) { return null; }
                const c = s.querySelector('canvas');
                if (!c) { return { index: i, covered: false, reason: 'no canvas' }; }
                const r = c.getBoundingClientRect();
                return { index: i, covered: r.left <= left + 1 && r.right >= right - 1 && r.top <= top + 1 && r.bottom >= bottom - 1 };
            }).filter(Boolean),
            canvasSizes: canvases.map(x => [x.c.width, x.c.height, Math.round(x.c.getBoundingClientRect().width), Math.round(x.c.getBoundingClientRect().height)]),
            pageCss: slots[0] ? [Math.round(slots[0].getBoundingClientRect().width), Math.round(slots[0].getBoundingClientRect().height)] : null,
        };
    }
    out.megabytes = Math.round([...document.querySelectorAll('canvas')].reduce((m, c) => m + c.width * c.height * 4, 0) / 1e6);
    return out;
});
const pinch = (paneId, dy, count) => page.evaluate(async (paneId, dy, count) => {
    const pane = document.getElementById(paneId);
    const box = pane.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
        pane.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: dy, deltaMode: 0, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 16));
    }
}, paneId, dy, count);

await pinch('left-pane', -40, 80);
await wait(2500);
const top = await state();
check('the zoom reaches 1000%, the limit of the full viewer', top.zoom === '1000%', top.zoom);
check('the panes keep growing past what four times the fit would have allowed', Number(top.sides.left.pageCss[0]) > 5000, JSON.stringify(top.sides.left.pageCss));
for (const side of ['left', 'right']) {
    const st = top.sides[side];
    check(`${side}: every page in view has a canvas that covers what is in view`, st.covers.length > 0 && st.covers.every(c => c.covered), JSON.stringify(st.covers));
    check(`${side}: only the pages near the view are drawn, not the whole document`, st.drawn.length <= 3, `${st.drawn} of ${st.total}`);
    check(`${side}: a large page is drawn in part, on a canvas far smaller than the page`, st.canvasSizes.every(([w, h, cssW, cssH]) => w * h <= 16.8e6 && cssW < st.pageCss[0] && cssH < st.pageCss[1]), JSON.stringify(st.canvasSizes) + ' of page ' + JSON.stringify(st.pageCss));
    check(`${side}: the canvas is at the resolution of the screen, so the page is sharp`, st.canvasSizes.every(([w, , cssW]) => Math.abs(w / cssW - dpr) < 0.02), JSON.stringify(st.canvasSizes));
}
check('canvas memory is small at 1000%', top.megabytes < 250, `${top.megabytes} MB`);
await page.screenshot({ path: shotPath('highzoom-top.png') });

// Scroll down through the page: each stop must be drawn where it is in view, after a moment.
let allCovered = true; const stops = [];
for (const y of [1500, 6000, 11000, 15000, 22000, 40000, 100000]) {
    await page.evaluate(y => { document.getElementById('left-pane').scrollTop = y; }, y);
    await wait(900);
    const st = await state();
    const ok = st.sides.left.covers.length > 0 && st.sides.left.covers.every(c => c.covered) && st.sides.right.covers.every(c => c.covered);
    stops.push(`${y}:${ok ? 'ok' : 'GAP ' + JSON.stringify(st.sides.left.covers)}`);
    allCovered = allCovered && ok;
}
check('after a scroll to each of several places the view is drawn, on both sides', allCovered, stops.join(' '));
const deep = await state();
check('scrolled deep into the document few canvases are held and memory stays small', deep.sides.left.drawn.length <= 3 && deep.megabytes < 250, `${deep.sides.left.drawn} ${deep.megabytes} MB`);
await page.screenshot({ path: shotPath('highzoom-deep.png') });

// A sideways scroll: the view moves across a page that is wider than the pane.
await page.evaluate(() => { const p = document.getElementById('left-pane'); p.scrollLeft = 0; p.scrollTop = 3000; });
await wait(700);
let sideways = true;
for (const x of [800, 3000, 7000, 12000]) {
    await page.evaluate(x => { document.getElementById('left-pane').scrollLeft = x; }, x);
    await wait(700);
    const st = await state();
    sideways = sideways && st.sides.left.covers.every(c => c.covered) && st.sides.right.covers.every(c => c.covered);
}
check('a sideways scroll across the page draws what comes into view', sideways);

// Zoom back out to the fit: whole pages again, nothing left over from the large ones.
await page.click('#btn-fit');
await wait(2500);
const fit = await state();
check('at the fit the pages are drawn whole again, filling their sheets', fit.sides.left.canvasSizes.every(([, , cw, ch]) => Math.abs(cw - fit.sides.left.pageCss[0]) <= 1 && Math.abs(ch - fit.sides.left.pageCss[1]) <= 1), JSON.stringify(fit.sides.left.canvasSizes) + ' ' + JSON.stringify(fit.sides.left.pageCss));
check('and few pages are held', fit.sides.left.drawn.length <= 4 && fit.megabytes < 100, `${fit.sides.left.drawn} ${fit.megabytes} MB`);
check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
