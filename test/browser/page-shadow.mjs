// The full viewer's pages cast the diff view's shadow without moving anything or taking clicks.
// Run with `dark` or `light`: the theme class a webview puts on the body.
import { createChecker, fixturePdf, shotPath, startEnvironment, wait } from './support.mjs';

const scheme = process.argv[2] ?? 'dark';
const outPrefix = 'shadow';
const a = fixturePdf('example10.pdf');
const env = await startEnvironment();
const viewerHtml = env.viewerHtml;
const withoutShadow = viewerHtml.replace(/\.pdfViewer \.page::before \{[^}]*\}/, '');
let current = viewerHtml;
const server = await env.serve(() => current);
const browser = env.browser;
const { check, finish } = createChecker();
const problems = [];

async function open(html) {
    current = html;
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 700 });
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) { problems.push(`${m.type()}: ${m.text().slice(0, 160)}`); } });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message));
    await page.evaluateOnNewDocument(cls => {
        window.__posts = [];
        window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
        document.addEventListener('DOMContentLoaded', () => { document.body.classList.add(cls); });
    }, scheme === 'light' ? 'vscode-light' : 'vscode-dark');
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
    await page.evaluate(x => window.postMessage({ type: 'updatePdf', pdfBase64: x, filename: 'a.pdf', zoom: 'fit' }, '*'), a);
    await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0, { timeout: 30000 });
    await wait(900);
    return page;
}

const measure = page => page.evaluate(() => {
    const pages = [...document.querySelectorAll('.pdfViewer .page')].slice(0, 2);
    const r = el => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(n => Math.round(n * 100) / 100).join(','); };
    const before = getComputedStyle(pages[0], '::before');
    const span = document.querySelector('.textLayer span');
    const sb = span?.getBoundingClientRect();
    const hit = sb ? document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2) : null;
    return {
        boxes: pages.map(r), shadow: before.boxShadow, content: before.content, position: before.position,
        hitInTextLayer: Boolean(hit?.closest('.textLayer')), hitTag: hit?.tagName + '.' + hit?.className, spanText: span?.textContent?.slice(0, 20),
        sizeOfPseudo: before.width + ' x ' + before.height, pageCss: getComputedStyle(pages[0]).width + ' x ' + getComputedStyle(pages[0]).height,
        scrollWidth: document.getElementById('viewerContainer').scrollWidth, clientWidth: document.getElementById('viewerContainer').clientWidth,
    };
});

const plain = await open(withoutShadow);
const base = await measure(plain);
await plain.close();
const shadowed = await open(viewerHtml);
const now = await measure(shadowed);
await shadowed.screenshot({ path: shotPath(`${outPrefix}-${scheme}.png`) });
await shadowed.evaluate(async () => {
    const v = window.PDFViewerApplication.pdfViewer;
    v.currentScaleValue = '0.5';
    await new Promise(r => setTimeout(r, 500));
    const p2 = document.querySelectorAll('.pdfViewer .page')[1];
    document.getElementById('viewerContainer').scrollTop += p2.getBoundingClientRect().top - 330;
    await new Promise(r => setTimeout(r, 600));
});
await shadowed.screenshot({ path: shotPath(`${outPrefix}-${scheme}-between.png`), clip: { x: 0, y: 36, width: 900, height: 660 } });
check('each page has a shadow of the shared token', now.shadow === 'rgba(0, 0, 0, 0.4) 0px 2px 10px 0px', now.shadow);
check('the page has no shadow without the new rule', base.shadow === 'none', base.shadow);
check('the shadow does not move or resize any page', JSON.stringify(base.boxes) === JSON.stringify(now.boxes), `${base.boxes.join(' | ')}  vs  ${now.boxes.join(' | ')}`);
check('the shadow does not add horizontal scrolling', now.scrollWidth <= now.clientWidth, `${now.scrollWidth} in ${now.clientWidth}`);
check('the pseudo-element covers the page and takes no clicks: text is still what is hit', now.hitInTextLayer, String(now.hitTag) + ' / without: ' + base.hitTag + ' ' + base.hitInTextLayer + ' span ' + now.spanText);
check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
