// The diff view on a long document: pages are drawn as they come into view, and freed as they leave.
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
    const out = {};
    for (const side of ['left', 'right']) {
        const slots = [...document.querySelectorAll(`#${side}-inner .page-slot`)];
        const pane = document.getElementById(`${side}-pane`).getBoundingClientRect();
        out[side] = {
            drawn: slots.map((s, i) => s.querySelector('canvas') ? i : -1).filter(i => i >= 0),
            inView: slots.map((s, i) => { const b = s.getBoundingClientRect(); return b.bottom > pane.top && b.top < pane.bottom ? i : -1; }).filter(i => i >= 0),
            total: slots.length,
        };
    }
    out.megabytes = Math.round([...document.querySelectorAll('canvas')].reduce((m, c) => m + c.width * c.height * 4, 0) / 1e6);
    return out;
});
const first = await state();
check('at the start the first pages are drawn and the last is not', first.left.drawn.includes(0) && !first.left.drawn.includes(first.left.total - 1), JSON.stringify(first.left));
await page.evaluate(() => { const p = document.getElementById('left-pane'); p.scrollTop = p.scrollHeight / 2; });
await wait(1500);
const middle = await state();
check('scrolling to the middle draws the pages there, on both sides', middle.left.inView.every(i => middle.left.drawn.includes(i)) && middle.right.inView.every(i => middle.right.drawn.includes(i)), JSON.stringify(middle.left));
check('and frees the first page, which is far away', !middle.left.drawn.includes(0) && !middle.right.drawn.includes(0), JSON.stringify(middle.left.drawn));
check('few pages are held at once, not the whole document', middle.left.drawn.length <= 4 && middle.right.drawn.length <= 4, `${middle.left.drawn.length} + ${middle.right.drawn.length} of ${middle.left.total}`);
await page.evaluate(() => { const p = document.getElementById('left-pane'); p.scrollTop = p.scrollHeight; });
await wait(1500);
const end = await state();
check('at the end the last page is drawn and the middle ones are freed', end.left.drawn.includes(end.left.total - 1) && !end.left.drawn.includes(Math.floor(end.left.total / 2)), JSON.stringify(end.left.drawn));
// A fast jump back and forth settles on what is in view.
await page.evaluate(async () => {
    const p = document.getElementById('left-pane');
    for (const f of [0, 1, 0.3, 0.9, 0.5, 0.1]) { p.scrollTop = (p.scrollHeight - p.clientHeight) * f; await new Promise(r => setTimeout(r, 30)); }
});
await wait(2500);
const jumped = await state();
check('after a fast scroll up and down the pages in view are drawn and the rest freed', jumped.left.inView.every(i => jumped.left.drawn.includes(i)) && jumped.left.drawn.length <= 4, JSON.stringify(jumped.left));
check('canvas memory stays small through all of it', jumped.megabytes < 100 && middle.megabytes < 100 && end.megabytes < 100, `${first.megabytes} ${middle.megabytes} ${end.megabytes} ${jumped.megabytes} MB`);
// Scroll without sync: each side follows its own view.
await page.evaluate(() => { document.getElementById('sync-scroll').click(); });
await page.evaluate(() => { document.getElementById('left-pane').scrollTop = 0; document.getElementById('right-pane').scrollTop = 99999; });
await wait(1800);
const apart = await state();
check('with sync scroll off each side draws the pages of its own view', apart.left.drawn.includes(0) && apart.right.drawn.includes(apart.right.total - 1) && !apart.left.drawn.includes(apart.left.total - 1) && !apart.right.drawn.includes(0), `${apart.left.drawn} | ${apart.right.drawn}`);
check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
