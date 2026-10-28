// Following the headings of a Markdown preview, in the full viewer as a VS Code webview loads it: the outline it
// reports, a scroll to a place that the extension host asks for, and the places it reports as the author scrolls.
import { createRequire } from 'node:module';
import path from 'node:path';
import { createChecker, ROOT, startEnvironment, wait } from './support.mjs';

const require = createRequire(import.meta.url);
const engine = require(path.join(ROOT, 'wasm', 'lpdf.js'));

/** A few paragraphs, so that a section takes about a page. */
const filler = Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1} of this section, with enough words in it to take a line or two of the page.`).join('\n\n');
const markdown = [
    'Some words before the first heading.', filler,
    '# Alpha', filler,
    '## Beta', filler,
    '## Gamma *and* `code`', filler,
    '# Delta', filler,
].join('\n\n') + '\n';
const TITLES = ['Alpha', 'Beta', 'Gamma and code', 'Delta'];

/** How far below its edge the view puts a heading it scrolls to; lpdf-headings.mjs's HEADING_MARGIN. */
const MARGIN = 16;

const pdfBase64 = Buffer.from(
    new engine.LpdfEngine('').render_pdf(engine.markdown_declare_images(engine.markdown_template(), '[]'), engine.markdown_file_data(markdown)),
).toString('base64');

const env = await startEnvironment();
const pageServer = await env.serve(env.viewerHtml);
const page = await env.browser.newPage();
await page.setViewport({ width: 1100, height: 760 });

const problems = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) { problems.push(`console.${m.type()}: ${m.text()}`); } });
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument(() => {
    window.__posts = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
    document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'));
});

const { check, finish } = createChecker();
const send = message => page.evaluate(m => window.postMessage(m, '*'), message);
const posts = type => page.evaluate(t => window.__posts.filter(p => p.type === t), type);
const forget = () => page.evaluate(() => { window.__posts.length = 0; });
const scrollTop = () => page.evaluate(() => window.PDFViewerApplication.pdfViewer.container.scrollTop);
const extent = () => page.evaluate(() => {
    const c = window.PDFViewerApplication.pdfViewer.container;
    return c.scrollHeight - c.clientHeight;
});
/** Waits for the viewer to have drawn a document and the host to have heard its outline. */
const opened = () => page.waitForFunction(() => window.__posts.some(p => p.type === 'outline'), { timeout: 30000 });
const near = (a, b, within) => Math.abs(a - b) <= within;

await page.goto(`http://127.0.0.1:${pageServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 });

// The outline.
await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', zoom: 'fit', followHeadings: true });
await opened();
await wait(500);
const [outline] = await posts('outline');
check('the viewer reports the titles of the outline, in order', JSON.stringify(outline?.titles) === JSON.stringify(TITLES), JSON.stringify(outline?.titles));
check('it is more than one page long', await page.evaluate(() => window.PDFViewerApplication.pdfViewer.pagesCount) > 2);

// Where the viewer itself would put each heading, for comparing: it follows the destination of each entry.
const viewerTops = await page.evaluate(async () => {
    const app = window.PDFViewerApplication;
    const tops = [];
    const walk = async items => {
        for (const item of items) {
            app.pdfLinkService.goToDestination(item.dest);
            await new Promise(resolve => setTimeout(resolve, 150));
            tops.push(app.pdfViewer.container.scrollTop);
            await walk(item.items);
        }
    };
    await walk(await app.pdfDocument.getOutline());
    app.pdfViewer.container.scrollTop = 0;
    return tops;
});
await wait(300);
const end = await extent();
// The reading lines at which the sections begin: the top of the document, each heading, the end of the document.
const stops = [MARGIN, ...viewerTops.map(top => Math.min(top, end + MARGIN)), end + MARGIN];
/** The place at a scroll position, worked out here and not by the module under test. */
const placeAt = top => {
    const line = top + MARGIN;
    let k = stops.findLastIndex(stop => stop <= line);
    if (k < 0) { return -1; }
    if (k === stops.length - 1) { return k - 1; }
    return k - 1 + (line - stops[k]) / (stops[k + 1] - stops[k]);
};
await forget();

// A scroll to a place the host asks for.
const scrollsTo = {};
for (const place of [2, 0, 3, 1]) {
    await send({ type: 'scrollToPosition', position: place });
    await wait(300);
    scrollsTo[place] = await scrollTop();
}
check(
    'scrolling to a heading puts it where the viewer puts a heading it links to, less the margin above it',
    Object.entries(scrollsTo).every(([place, top]) => near(viewerTops[place] - top - MARGIN, 0, 1.5)),
    `ours ${JSON.stringify(scrollsTo)} viewer's ${JSON.stringify(viewerTops)}`,
);
await send({ type: 'scrollToPosition', position: 1.5 });
await wait(300);
const half = await scrollTop();
check('scrolling to 1.5 puts the view half way from the heading of Beta to that of Gamma', near(half, (viewerTops[1] + viewerTops[2]) / 2 - MARGIN, 2), `scrollTop=${half}`);
await send({ type: 'scrollToPosition', position: 2.25 });
await wait(300);
const quarter = await scrollTop();
check('and 2.25 a quarter of the way from Gamma to Delta', near(quarter, viewerTops[2] + (viewerTops[3] - viewerTops[2]) / 4 - MARGIN, 2), `scrollTop=${quarter}`);
await send({ type: 'scrollToPosition', position: -1 });
await wait(300);
check('scrolling to -1 goes to the top of the document', await scrollTop() === 0, `scrollTop=${await scrollTop()}`);
await send({ type: 'scrollToPosition', position: TITLES.length });
await wait(300);
check('scrolling to the number of entries goes to the end of the document', near(await scrollTop(), end, 1), `scrollTop=${await scrollTop()} end=${end}`);
await send({ type: 'scrollToPosition', position: 99 });
await wait(300);
check('a place beyond the end is taken for the end', near(await scrollTop(), end, 1));
await send({ type: 'scrollToPosition', position: -1 });
await wait(300);
check('and the viewer does not tell the host about a scroll it was asked for', (await posts('position')).length === 0, JSON.stringify(await posts('position')));
await forget();

// A scroll of the author's, with the mouse wheel.
await page.mouse.move(550, 400);
const wheelTo = async top => {
    const now = await scrollTop();
    await page.mouse.wheel({ deltaY: top - now });
    await wait(400);
};
const lastPlace = async () => (await posts('position')).at(-1)?.at;
await wheelTo(viewerTops[1] + 120);
let reported = await lastPlace();
let expected = placeAt(await scrollTop());
check('a place reached with the wheel is reported, part way into its section', reported !== undefined && near(reported, expected, 0.005) && reported > 1 && reported < 2, `reported ${reported} expected ${expected}`);
await wheelTo(viewerTops[1] + 600);
reported = await lastPlace();
expected = placeAt(await scrollTop());
check('and further down the same section, further along it', near(reported, expected, 0.005) && reported > 1, `reported ${reported} expected ${expected}`);
await wheelTo(viewerTops[3] + 50);
reported = await lastPlace();
expected = placeAt(await scrollTop());
check('a heading further on is passed, and reported past it', near(reported, expected, 0.005) && reported > 3 - 0.0001 && reported < 4, `reported ${reported} expected ${expected}`);
await wheelTo(0);
check('scrolling back to the top is reported as -1', await lastPlace() === -1, `reported ${await lastPlace()}`);
// Small steps make a steady climb, not jumps from heading to heading.
await forget();
const climb = [];
for (let step = 0; step < 6; step++) {
    await page.mouse.wheel({ deltaY: 100 });
    await wait(150);
    climb.push(await lastPlace());
}
const climbs = climb.every((place, index) => place !== undefined && (index === 0 || place > climb[index - 1]));
const biggest = Math.max(...climb.map((place, index) => place - (index === 0 ? -1 : climb[index - 1])));
check('small steps of the wheel report a place that climbs a little each time', climbs && biggest < 0.3, JSON.stringify(climb));

// The view moving with no input from the author since the host moved it, or by zoom, is not theirs.
await send({ type: 'scrollToPosition', position: 0 });
await wait(300);
await forget();
await page.evaluate(top => { window.PDFViewerApplication.pdfViewer.container.scrollTop = top; }, viewerTops[2] + 30);
await wait(400);
check('a move that the author did not make is not reported', (await posts('position')).length === 0, JSON.stringify(await posts('position')));
await page.mouse.wheel({ deltaY: 10 });
await wait(300);
await forget();
await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = '0.8'; });
await wait(600);
check('a change of zoom after the author used the page is not reported either', (await posts('position')).length === 0, JSON.stringify(await posts('position')));

// A render of the same file keeps the place, and says nothing of it.
await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width'; });
await wait(500);
await send({ type: 'scrollToPosition', position: 1 });
await wait(300);
await forget();
await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', followHeadings: true });
await opened();
await wait(800);
const [again] = await posts('outline');
check('a render of the same file reports its outline again', JSON.stringify(again?.titles) === JSON.stringify(TITLES), JSON.stringify(again));
check('and nothing that reads as the author\'s scroll', (await posts('position')).length === 0, JSON.stringify(await posts('position')));
await send({ type: 'scrollToPosition', position: 2 });
await wait(300);
check('and it follows the host again', near(await scrollTop(), viewerTops[2] - MARGIN, 2), `scrollTop=${await scrollTop()}`);

// A PDF that is not followed.
await forget();
await send({ type: 'updatePdf', pdfBase64, filename: 'other.pdf', zoom: 'fit' });
await wait(1500);
check('a PDF that does not ask for its headings to be followed reports none', (await posts('outline')).length === 0);
const before = await scrollTop();
await send({ type: 'scrollToPosition', position: 2 });
await wait(300);
check('and does not scroll to one', await scrollTop() === before);
await page.mouse.wheel({ deltaY: 400 });
await wait(400);
check('nor does it report the scrolling', (await posts('position')).length === 0);

check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
