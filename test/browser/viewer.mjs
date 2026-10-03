// The full-viewer page as a VS Code webview loads it: assets from another origin under the page's CSP, and
// acquireVsCodeApi a stub that records what the page posts to the extension host.
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
const started = await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
check('viewer starts and posts ready', started, started ? '' : JSON.stringify(await page.evaluate(() => window.__posts)));

if (started) {
    console.log('OPTIONS', JSON.stringify(await page.evaluate(() => {
        const o = window.PDFViewerApplicationOptions;
        return Object.fromEntries(['workerSrc','annotationEditorMode','defaultUrl','viewOnLoad','disableHistory','defaultZoomValue','cMapUrl','enableScripting'].map(k => [k, o.get(k)]));
    })));
    // First file: same message the extension host sends for a file that was not showing before.
    await send({ type: 'showLoading' });
    check('status overlay shows while rendering', (await state()).status === 'Rendering\u2026');
    await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', zoom: 'fit', scrollX: 0, scrollY: 0 });
    await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0 && document.querySelector('.page .canvasWrapper canvas'), { timeout: 20000 })
        .then(() => check('first pdf renders', true))
        .catch(() => check('first pdf renders', false));
    await wait(800);
    let s = await state();
    check('overlay is hidden once the pdf is open', s.status === 'hidden', JSON.stringify(s));
    check('pdf has several pages', s.pages > 2, `pages=${s.pages}`);
    check('new file opens at page width', s.scaleValue === 'page-width', `scaleValue=${s.scaleValue}`);
    await page.screenshot({ path: shotPath(`1-first.png`) });

    const ui = await page.evaluate(() => {
        const shown = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; };
        return {
            editorButtons: shown('editorModeButtons'), highlight: shown('editorHighlightButton'), print: shown('printButton'),
            presentation: shown('presentationMode'), openFile: shown('secondaryOpenFile'),
            download: shown('downloadButton'), find: shown('viewFindButton'), sidebarToggle: shown('viewsManagerToggleButton'),
            textLayerSpans: document.querySelectorAll('.textLayer span').length,
        };
    });
    check('annotation tools are hidden', !ui.editorButtons && !ui.highlight, JSON.stringify(ui));
    check('print, present and open-file controls are hidden', !ui.print && !ui.presentation && !ui.openFile);
    check('find, sidebar and download controls are shown', ui.find && ui.sidebarToggle && ui.download);
    check('text layer exists (text is selectable)', ui.textLayerSpans > 0, `spans=${ui.textLayerSpans}`);

    // Search.
    await page.evaluate(() => window.PDFViewerApplication.findBar.open());
    const word = await page.evaluate(async () => {
        const t = await (await window.PDFViewerApplication.pdfDocument.getPage(1)).getTextContent();
        return t.items.map(i => i.str).find(x => /^[A-Za-z]{5,}$/.test(x)) ?? 'the';
    });
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
    await wait(1200);
    const found = await page.evaluate(() => document.getElementById('findResultsCount')?.textContent);
    check('find reports matches', !!found && /\d/.test(found), `"${word}" -> "${found}"`);
    await page.evaluate(() => window.PDFViewerApplication.findBar.close());

    // Re-render of the same file: no zoom field, as the extension host sends for an edit.
    await page.evaluate(() => { const v = window.PDFViewerApplication.pdfViewer; v.currentScaleValue = '1.5'; });
    await wait(500);
    await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.currentPageNumber = 3; });
    await wait(600);
    await page.evaluate(() => { const c = window.PDFViewerApplication.pdfViewer.container; c.scrollTop += 120; });
    await wait(600);
    await page.evaluate(() => window.PDFViewerApplication.viewsManager.open());
    await wait(300);
    const before = await state();
    await send({ type: 'showLoading' });
    check('status overlay stays away while a document is showing', (await state()).status === 'hidden');
    await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf' });
    await page.waitForFunction(() => document.querySelector('.page .canvasWrapper canvas') && window.PDFViewerApplication.pdfViewer.pagesCount > 0, { timeout: 20000 });
    await wait(1500);
    const after = await state();
    check('re-render keeps the zoom', Math.abs(after.scale - before.scale) < 0.01, `before=${before.scale} after=${after.scale}`);
    check('re-render keeps the page', after.page === before.page, `before=${before.page} after=${after.page}`);
    check('re-render keeps the scroll position', Math.abs(after.scrollTop - before.scrollTop) < 40, `before=${before.scrollTop} after=${after.scrollTop}`);
    check('re-render keeps the sidebar open', after.sidebarOpen !== 0, `before=${before.sidebarOpen} after=${after.sidebarOpen}`);
    await page.screenshot({ path: shotPath(`2-rerender.png`) });

    // Save goes to the extension host.
    await page.evaluate(() => document.getElementById('downloadButton').click());
    await wait(500);
    const download = await page.evaluate(() => window.__posts.find(p => p.type === 'download'));
    check('save is posted to the extension host with the pdf', download?.pdfBase64 === pdfBase64 && download.filename === 'doc.pdf');

    // A different file starts over at the top at page width.
    await send({ type: 'updatePdf', pdfBase64, filename: 'other.pdf', zoom: 'fit', scrollX: 0, scrollY: 0 });
    await wait(2000);
    s = await state();
    check('a new file starts at page width, page 1', s.scaleValue === 'page-width' && s.page === 1, JSON.stringify(s));

    // An error replaces the view; the next pdf clears it.
    await send({ type: 'showError', message: 'boom' });
    check('error is shown', (await state()).status === 'Error: boom');
    await send({ type: 'updatePdf', pdfBase64, filename: 'other.pdf' });
    await wait(1500);
    check('next pdf clears the error', (await state()).status === 'hidden');

    // Garbage bytes surface as an error, not a hang.
    await send({ type: 'updatePdf', pdfBase64: Buffer.from('not a pdf').toString('base64'), filename: 'bad.pdf', zoom: 'fit' });
    await wait(2500);
    check('an invalid pdf shows an error', /^Error:/.test((await state()).status ?? ''), (await state()).status);

    // Light theme.
    await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', zoom: 'fit' });
    await wait(1500);
    await page.evaluate(() => { document.body.classList.remove('vscode-dark'); document.body.classList.add('vscode-light'); });
    await wait(400);
    check('theme follows the editor (light)', await page.evaluate(() => document.documentElement.style.colorScheme === 'light'));
    await page.screenshot({ path: shotPath(`3-light.png`) });
}

await page.evaluate(() => { document.body.classList.remove('vscode-light'); document.body.classList.add('vscode-dark'); });
await page.evaluate(() => document.getElementById('secondaryToolbarToggleButton')?.click());
await wait(500);
await page.screenshot({ path: shotPath(`4-menu.png`), clip: { x: 600, y: 0, width: 500, height: 480 } });
console.log('MENU', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#secondaryToolbarButtonContainer button, #secondaryToolbarButtonContainer a')].filter(e => getComputedStyle(e).display !== 'none' && e.offsetParent !== null).map(e => e.id))));
await page.keyboard.press('Escape');
await page.evaluate(() => document.getElementById('viewsManagerSelectorButton')?.click());
await wait(400);
await page.screenshot({ path: shotPath(`5-views.png`), clip: { x: 0, y: 0, width: 400, height: 300 } });
const csp = await page.evaluate(() => window.__csp);
check('no CSP violations', csp.length === 0, csp.join(' | '));
const worker = await page.evaluate(() => (window.PDFViewerApplication?.pdfDocument?.loadingTask?._worker?.port instanceof Worker) ? 'worker' : 'other');
check('pdf.js runs in a real worker', worker === 'worker', worker);
console.log('\nPROBLEMS (console errors/warnings, failed requests):');
console.log(problems.length ? [...new Set(problems)].join('\n') : '(none)');

await env.close();
finish();
