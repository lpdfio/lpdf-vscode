// The full viewer stops at 1000%, whichever way it is zoomed: the + button, Ctrl+wheel, the keyboard, the field.
import { createChecker, fixturePdf, shotPath, startEnvironment, wait } from './support.mjs';

const pdfBase64 = fixturePdf('bench_m.pdf');
const env = await startEnvironment();
const pageServer = await env.serve(env.viewerHtml);
const browser = env.browser;
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 760 });

const problems = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) { problems.push(`console.${m.type()}: ${m.text()}`); } });
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) { problems.push(`http ${r.status()}: ${r.url()}`); } });

await page.evaluateOnNewDocument(() => {
    window.__posts = [];
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
    document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'));
});

const { check, finish } = createChecker();
const send = message => page.evaluate(m => window.postMessage(m, '*'), message);
const state = () => page.evaluate(() => {
    const app = window.PDFViewerApplication;
    const v = app?.pdfViewer;
    return {
        pages: v?.pagesCount ?? 0, page: v?.currentPageNumber, scale: v?.currentScale, scaleValue: v?.currentScaleValue,
        scrollTop: v?.container?.scrollTop, sidebarOpen: app?.viewsManager?.visibleView,
        status: document.getElementById('lpdf-status')?.hidden ? 'hidden' : document.getElementById('lpdf-status')?.textContent,
    };
});

await page.goto(`http://127.0.0.1:${pageServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 });
await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', zoom: 'fit', scrollX: 0, scrollY: 0 });
await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0 && document.querySelector('.page .canvasWrapper canvas'), { timeout: 20000 });
await wait(800);
const scale = () => page.evaluate(() => window.PDFViewerApplication.pdfViewer.currentScale);
const zoomIn = () => page.evaluate(() => ({ disabled: document.getElementById('zoomInButton').disabled, field: document.getElementById('lpdfZoomInput').value }));

// The + button, pressed until it stops.
for (let i = 0; i < 60; i++) { await page.evaluate(() => document.getElementById('zoomInButton').click()); }
await wait(1500);
let z = await zoomIn();
check('the + button stops at 10 (1000%)', Math.abs(await scale() - 10) < 0.001, String(await scale()));
check('the + button is disabled there, and the field says 1000%', z.disabled && z.field === '1000%', JSON.stringify(z));

// Past it: Ctrl+wheel and the keyboard.
await page.mouse.move(550, 400);
for (let i = 0; i < 30; i++) { await page.evaluate(() => document.querySelector('#viewerContainer').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -60, deltaMode: 0, clientX: 550, clientY: 400, bubbles: true, cancelable: true }))); await wait(20); }
await page.keyboard.down('Control'); for (let i = 0; i < 10; i++) { await page.keyboard.press('Equal'); } await page.keyboard.up('Control');
await wait(1000);
check('Ctrl+wheel and Ctrl+= do not pass 1000%', Math.abs(await scale() - 10) < 0.001, String(await scale()));

// The field: a bigger number is held to 1000%; the - button then enables the + button again.
await page.$eval('#lpdfZoomInput', e => { e.focus(); e.value = '5000'; e.dispatchEvent(new Event('change', { bubbles: true })); });
await wait(800);
check('typing 5000 gives 1000%', Math.abs(await scale() - 10) < 0.001, String(await scale()));
await page.evaluate(() => document.getElementById('zoomOutButton').click());
await wait(600);
z = await zoomIn();
check('zooming out makes + usable again', !z.disabled && (await scale()) < 10, JSON.stringify(z));

// Lowest end unchanged.
for (let i = 0; i < 80; i++) { await page.evaluate(() => document.getElementById('zoomOutButton').click()); }
await wait(800);
check('the lowest zoom is still 10%', Math.abs(await scale() - 0.1) < 0.001, String(await scale()));
check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
