// Following the headings of a Markdown preview, in the full viewer as a VS Code webview loads it: the outline it
// reports, a scroll to a heading that the extension host asks for, and a scroll of the author's that it reports.
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
/** Waits for the viewer to have drawn a document and the host to have heard its outline. */
const opened = () => page.waitForFunction(() => window.__posts.some(p => p.type === 'outline'), { timeout: 30000 });

await page.goto(`http://127.0.0.1:${pageServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 });

// The outline.
await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', zoom: 'fit', followHeadings: true });
await opened();
await wait(500);
const [outline] = await posts('outline');
check('the viewer reports the titles of the outline, in order', JSON.stringify(outline?.titles) === JSON.stringify(TITLES), JSON.stringify(outline?.titles));
check('and that the view is above the first heading', outline?.top === -1, `top=${outline?.top}`);
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
await forget();

// A scroll to a heading the host asks for.
const scrollsTo = {};
for (const index of [2, 0, 3, 1]) {
    await send({ type: 'scrollToHeading', index });
    await wait(300);
    scrollsTo[index] = await scrollTop();
}
check(
    'scrolling to a heading puts it where the viewer puts a heading it links to, less the margin above it',
    Object.entries(scrollsTo).every(([index, top]) => Math.abs(viewerTops[index] - top - 16) <= 1.5),
    `ours ${JSON.stringify(scrollsTo)} viewer's ${JSON.stringify(viewerTops)}`,
);
check('and the viewer does not tell the host about a scroll it was asked for as the author\'s', (await posts('topHeading')).every(p => !p.byUser), JSON.stringify(await posts('topHeading')));
await send({ type: 'scrollToHeading', index: -1 });
await wait(300);
check('scrolling to -1 goes to the top of the document', await scrollTop() === 0, `scrollTop=${await scrollTop()}`);
await send({ type: 'scrollToHeading', index: 99 });
await wait(200);
check('a heading the outline does not have is ignored', await scrollTop() === 0);
await forget();

// A scroll of the author's, with the mouse wheel.
await page.mouse.move(550, 400);
const wheelTo = async top => {
    const now = await scrollTop();
    await page.mouse.wheel({ deltaY: top - now });
    await wait(400);
};
await wheelTo(viewerTops[1] + 120);
let moved = await posts('topHeading');
check('a heading reached with the wheel is reported, as the author\'s', moved.length === 1 && moved[0].index === 1 && moved[0].byUser === true, JSON.stringify(moved));
await wheelTo(viewerTops[1] + 400);
moved = await posts('topHeading');
check('and nothing more is reported while the view stays under it', moved.length === 1, JSON.stringify(moved));
await wheelTo(viewerTops[3] + 50);
moved = await posts('topHeading');
check('a heading further on is reported as well', moved.length === 2 && moved[1].index === 3 && moved[1].byUser === true, JSON.stringify(moved));
await wheelTo(0);
moved = await posts('topHeading');
check('scrolling back above the first heading is reported as -1', moved.at(-1)?.index === -1 && moved.at(-1)?.byUser === true, JSON.stringify(moved.at(-1)));

// The view moving with no input from the author since the host moved it, or by zoom, is not theirs.
await send({ type: 'scrollToHeading', index: 0 });
await wait(300);
await forget();
await page.evaluate(top => { window.PDFViewerApplication.pdfViewer.container.scrollTop = top; }, viewerTops[2] + 30);
await wait(400);
moved = await posts('topHeading');
check('a move that the author did not make is reported as not theirs', moved.length === 1 && moved[0].index === 2 && moved[0].byUser === false, JSON.stringify(moved));
await page.mouse.wheel({ deltaY: 10 });
await wait(300);
await forget();
await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = '0.8'; });
await wait(600);
check('a change of zoom after the author used the page is not theirs either', (await posts('topHeading')).every(p => !p.byUser), JSON.stringify(await posts('topHeading')));

// A render of the same file keeps the place, and says where that is.
await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.currentScaleValue = 'page-width'; });
await wait(500);
await send({ type: 'scrollToHeading', index: 1 });
await wait(300);
await forget();
await send({ type: 'updatePdf', pdfBase64, filename: 'doc.pdf', followHeadings: true });
await opened();
await wait(800);
const [again] = await posts('outline');
check('a render of the same file reports its outline again, at the heading it was at', again?.top === 1 && JSON.stringify(again.titles) === JSON.stringify(TITLES), JSON.stringify(again));
check('and nothing that reads as the author\'s scroll', (await posts('topHeading')).every(p => !p.byUser), JSON.stringify(await posts('topHeading')));

// A PDF that is not followed.
await forget();
await send({ type: 'updatePdf', pdfBase64, filename: 'other.pdf', zoom: 'fit' });
await wait(1500);
check('a PDF that does not ask for its headings to be followed reports none', (await posts('outline')).length === 0);
const before = await scrollTop();
await send({ type: 'scrollToHeading', index: 2 });
await wait(300);
check('and does not scroll to one', await scrollTop() === before);
await page.mouse.wheel({ deltaY: 400 });
await wait(400);
check('nor does it report the scrolling', (await posts('topHeading')).length === 0);

check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
await env.close();
finish();
