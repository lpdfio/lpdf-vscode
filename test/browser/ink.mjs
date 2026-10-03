// The diff view at a high zoom draws real content, not blank canvases, on both sides.
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
await wait(2000);
const ink = () => page.evaluate(() => {
    const out = {};
    for (const side of ['left', 'right']) {
        const c = document.querySelector(`#${side}-inner canvas`);
        const ctx = c.getContext('2d');
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) { if (data[i] < 128 && data[i + 3] > 0) { dark++; } }
        out[side] = { dark, of: data.length / 4 };
    }
    return out;
});
let found = null;
for (const [x, y] of [[1200, 1700], [1200, 2300], [1200, 3000], [3000, 2200]]) {
    await page.evaluate(([x, y]) => { const p = document.getElementById('left-pane'); p.scrollLeft = x; p.scrollTop = y; }, [x, y]);
    await wait(1200);
    const r = await ink();
    console.log(`at ${x},${y}: ink`, JSON.stringify(r));
    if (r.left.dark > 5000 && r.right.dark > 5000) { found = [x, y]; break; }
}
check('somewhere on the page the canvas holds ink, on both sides', found !== null, JSON.stringify(found));
await page.screenshot({ path: shotPath('highzoom-ink.png') });
await env.close();
finish();
