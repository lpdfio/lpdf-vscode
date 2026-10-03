// The properties dialogs: the viewer's, and the diff view's HEAD against working copy table.
// Run with `dark` or `light`: the theme class a webview puts on the body.
import { createChecker, fixturePdf, shotPath, startEnvironment, wait } from './support.mjs';

const scheme = process.argv[2] ?? 'dark';
const outPrefix = 'info';
const a = fixturePdf('example10.pdf');
const b = fixturePdf('example9.pdf');
const env = await startEnvironment();
const diffServer = await env.serve(env.diffHtml);
const viewerServer = await env.serve(env.viewerHtml);
const browser = env.browser;
const { check, finish } = createChecker();
const problems = [];

const prepare = async page => {
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) { problems.push(`${m.type()}: ${m.text().slice(0, 160)}`); } });
    page.on('pageerror', e => problems.push('pageerror: ' + e.message)); page.on('response', r => { if (r.status() === 404) { problems.push('404 ' + r.url()); } });
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

// ---- the viewer's own dialog, to compare with
const viewerPage = await browser.newPage();
await viewerPage.setViewport({ width: 1100, height: 700 });
await prepare(viewerPage);
await viewerPage.goto(`http://127.0.0.1:${viewerServer.port}/`);
await viewerPage.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
await viewerPage.evaluate(x => window.postMessage({ type: 'updatePdf', pdfBase64: x, filename: 'a.pdf', zoom: 'fit' }, '*'), a);
await viewerPage.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.pagesCount > 0, { timeout: 30000 });
await wait(600);
await viewerPage.click('#documentProperties');
await viewerPage.waitForFunction(() => document.getElementById('documentPropertiesDialog')?.open, { timeout: 10000 });
await wait(400);
const viewerDialog = await viewerPage.evaluate(() => {
    const dlg = document.getElementById('documentPropertiesDialog');
    const cs = getComputedStyle(dlg);
    const close = document.getElementById('documentPropertiesClose');
    const bs = getComputedStyle(close);
    const sep = getComputedStyle(dlg.querySelector('.separator'));
    const backdrop = getComputedStyle(dlg, '::backdrop');
    const label = dlg.querySelector('.row > span');
    const button = document.getElementById('documentProperties');
    return {
        bg: cs.backgroundColor, color: cs.color, padding: cs.paddingTop, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow,
        closeBg: bs.backgroundColor, closeColor: bs.color, closeBorder: bs.borderTopColor, closeHeight: close.getBoundingClientRect().height,
        closeFont: bs.fontSize + ' ' + bs.fontWeight, closeRadius: bs.borderTopLeftRadius, closePadding: bs.paddingTop + ' ' + bs.paddingLeft,
        backdrop: backdrop.backgroundColor, sepColor: sep.borderTopColor, labelWidth: label.getBoundingClientRect().width,
        iconColor: getComputedStyle(button, '::before').backgroundColor,
    };
});
await viewerPage.screenshot({ path: shotPath(`${outPrefix}-${scheme}-viewer-dialog.png`) });

// ---- the diff view
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
await prepare(page);
await page.goto(`http://127.0.0.1:${diffServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 30000 });
await page.evaluate((x, y) => window.postMessage({ type: 'updateDiff', oldBase64: x, newBase64: y, filename: 'example.pdf' }, '*'), a, b);
await page.waitForFunction(() => document.getElementById('loading-overlay')?.classList.contains('hidden'), { timeout: 60000 });
await wait(500);

const button = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height }; };
    const info = document.getElementById('btn-info');
    const fit = document.getElementById('btn-fit');
    const before = getComputedStyle(info, '::before');
    return {
        box: r(info), toolbar: r(document.getElementById('toolbar')), fit: r(fit),
        icon: { w: before.width, h: before.height, color: before.backgroundColor, mask: before.maskImage.slice(0, 200) },
        title: info.title, label: info.getAttribute('aria-label'),
        loaded: [...document.styleSheets].length > 0,
    };
});
check('the info button is 32px square at the right end of the header, 8px from the edge', button.box.width === 32 && button.box.height === 32 && Math.round(button.toolbar.right - button.box.right) === 8, JSON.stringify(button.box));
check('the info button is vertically centred in the header', Math.abs((button.box.top + button.box.height / 2) - (button.toolbar.top + button.toolbar.height / 2)) < 0.6, '');
check('the info icon is 18px and in the icon colour of the viewer', button.icon.w === '18px' && button.icon.h === '18px' && button.icon.color === viewerDialog.iconColor, JSON.stringify(button.icon) + ' vs ' + viewerDialog.iconColor);
check('the info icon is the viewer\'s own image', button.icon.mask.includes('secondaryToolbarButton-documentProperties.svg'), button.icon.mask);
check('the button has a label and a tooltip', button.title === 'Document properties' && button.label === 'Document properties');
const iconLoaded = await page.evaluate(async () => {
    const url = getComputedStyle(document.getElementById('btn-info'), '::before').maskImage.match(/url\("(.*)"\)/)?.[1];
    const res = await fetch(url);
    return res.ok;
});
check('the info icon address is one the page can load', iconLoaded);

// ---- open it
await page.click('#btn-info');
await page.waitForFunction(() => document.getElementById('info-dialog')?.open, { timeout: 10000 });
await wait(300);
const dialog = await page.evaluate(() => {
    const dlg = document.getElementById('info-dialog');
    const cs = getComputedStyle(dlg);
    const close = document.getElementById('info-close');
    const bs = getComputedStyle(close);
    const sep = getComputedStyle(dlg.querySelector('.info-gap > td'));
    const backdrop = getComputedStyle(dlg, '::backdrop');
    const rows = [...dlg.querySelectorAll('tbody tr:not(.info-gap)')].map(row => ({
        label: row.querySelector('th').textContent, left: row.children[1].textContent, right: row.children[2].textContent,
        changed: row.classList.contains('changed'), bg: getComputedStyle(row.children[1]).backgroundColor,
    }));
    const head = [...dlg.querySelectorAll('thead th')].map(th => th.textContent);
    const box = dlg.getBoundingClientRect();
    const label = dlg.querySelector('tbody th');
    return {
        bg: cs.backgroundColor, color: cs.color, padding: cs.paddingTop, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
        border: cs.borderTopWidth + ' ' + cs.borderTopColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow,
        closeBg: bs.backgroundColor, closeColor: bs.color, closeBorder: bs.borderTopColor, closeHeight: close.getBoundingClientRect().height,
        closeFont: bs.fontSize + ' ' + bs.fontWeight, closeRadius: bs.borderTopLeftRadius, closePadding: bs.paddingTop + ' ' + bs.paddingLeft,
        backdrop: backdrop.backgroundColor, sepBg: sep.backgroundImage.slice(0, 30), labelWidth: label.getBoundingClientRect().width,
        rows, head, summary: document.getElementById('info-summary').textContent,
        gaps: dlg.querySelectorAll('tbody .info-gap').length, box: { left: box.left, top: box.top, width: box.width, height: box.height },
        header: getComputedStyle(document.getElementById('toolbar')).backgroundColor,
        modal: dlg.matches(':modal'), activeId: document.activeElement?.id,
    };
});
await page.screenshot({ path: shotPath(`${outPrefix}-${scheme}-diff-dialog.png`) });
console.log(JSON.stringify(dialog.rows, null, 1).slice(0, 2400));
console.log('summary:', dialog.summary);

const weights = await page.evaluate(() => { const row = document.querySelector('#info-body tr:not(.info-gap)'); const f = el => { const c = getComputedStyle(el); return c.fontWeight + ' ' + c.color + ' ' + c.fontSize + ' ' + c.fontFamily.slice(0, 20); }; return [f(row.children[0]), f(row.children[1]), f(row.children[2])]; });
check('label and values have the same weight, colour and size', weights[0] === weights[1] && weights[1] === weights[2], JSON.stringify(weights));
check('the dialog is modal and opens', dialog.modal);
check('the columns are headed HEAD and Working copy', JSON.stringify(dialog.head) === JSON.stringify(['', 'HEAD', 'Working copy']), JSON.stringify(dialog.head));
check('there is a row for each of the 14 properties of the viewer\'s dialog, in 3 gaps between 4 groups', dialog.rows.length === 14 && dialog.gaps === 3, `${dialog.rows.length} rows, ${dialog.gaps} gaps`);
check('the labels are those of the viewer', dialog.rows.map(r => r.label.replace(' (differs)', '')).join('|') === 'File name:|File size:|Title:|Author:|Subject:|Keywords:|Creation Date:|Modification Date:|Creator:|PDF Producer:|PDF Version:|Page Count:|Page Size:|Fast Web View:');
const byLabel = label => dialog.rows.find(r => r.label.startsWith(label));
check('the file name is the one the extension sent, in both columns', byLabel('File name:').left === 'example.pdf' && byLabel('File name:').right === 'example.pdf');
check('the sizes are those of the two files, in the formats of the viewer', /^[\d.]+ (KB|MB) \([\d,]+ bytes\)$/.test(byLabel('File size:').left) && /^[\d.]+ (KB|MB) \([\d,]+ bytes\)$/.test(byLabel('File size:').right), `${byLabel('File size:').left} | ${byLabel('File size:').right}`);
check('the page sizes read as the viewer writes them', /in \((A4|Letter|Legal|A3)?,? ?(portrait|landscape)\)$/.test(byLabel('Page Size:').left), byLabel('Page Size:').left + ' | ' + byLabel('Page Size:').right);
check('a row that differs is tinted, and one that does not is not', dialog.rows.filter(r => r.changed).every(r => r.bg !== 'rgba(0, 0, 0, 0)') && dialog.rows.filter(r => !r.changed).every(r => r.bg === 'rgba(0, 0, 0, 0)'), `${dialog.rows.filter(r => r.changed).length} changed`);
check('the rows that differ are those whose two texts differ', dialog.rows.every(r => r.changed === (r.left !== r.right)));
check('the summary counts the rows that differ', dialog.summary === `${dialog.rows.filter(r => r.changed).length} of 14 properties ${dialog.rows.filter(r => r.changed).length === 1 ? 'differs' : 'differ'}.` || dialog.summary === 'The two documents have the same properties.', dialog.summary);

// ---- the same dressing as the viewer's dialog
check('the dialog is on the header colour, as the viewer\'s is', dialog.bg === dialog.header && dialog.bg === viewerDialog.bg, `${dialog.bg} vs ${viewerDialog.bg}`);
check('the dialog text colour, padding, font size and line height are the viewer\'s', dialog.color === viewerDialog.color && dialog.padding === viewerDialog.padding && dialog.fontSize === viewerDialog.fontSize && dialog.lineHeight === viewerDialog.lineHeight, JSON.stringify([dialog.color, dialog.padding, dialog.fontSize, dialog.lineHeight]) + ' vs ' + JSON.stringify([viewerDialog.color, viewerDialog.padding, viewerDialog.fontSize, viewerDialog.lineHeight]));
check('the border, corners and shadow are the viewer\'s', dialog.border === viewerDialog.border && dialog.radius === viewerDialog.radius && dialog.shadow === viewerDialog.shadow, JSON.stringify([dialog.border, dialog.radius, dialog.shadow]) + ' vs ' + JSON.stringify([viewerDialog.border, viewerDialog.radius, viewerDialog.shadow]));
check('the veil behind it is the viewer\'s', dialog.backdrop === viewerDialog.backdrop, `${dialog.backdrop} vs ${viewerDialog.backdrop}`);
check('the Close button has the colours, size and type of the viewer\'s', dialog.closeBg === viewerDialog.closeBg && dialog.closeColor === viewerDialog.closeColor && dialog.closeBorder === viewerDialog.closeBorder && dialog.closeHeight === viewerDialog.closeHeight && dialog.closeFont === viewerDialog.closeFont && dialog.closeRadius === viewerDialog.closeRadius && dialog.closePadding === viewerDialog.closePadding, JSON.stringify([dialog.closeBg, dialog.closeColor, dialog.closeBorder, dialog.closeHeight, dialog.closeFont, dialog.closeRadius, dialog.closePadding]) + ' vs ' + JSON.stringify([viewerDialog.closeBg, viewerDialog.closeColor, viewerDialog.closeBorder, viewerDialog.closeHeight, viewerDialog.closeFont, viewerDialog.closeRadius, viewerDialog.closePadding]));
check('the dialog is centred in the window', Math.abs(dialog.box.left + dialog.box.width / 2 - 550) < 1 && Math.abs(dialog.box.top + dialog.box.height / 2 - 350) < 1, JSON.stringify(dialog.box));
check('the dialog fits in the window', dialog.box.left >= 0 && dialog.box.top >= 0 && dialog.box.left + dialog.box.width <= 1100 && dialog.box.top + dialog.box.height <= 700);
check('focus is on the Close button when it opens', dialog.activeId === 'info-close', String(dialog.activeId));

// ---- closing it
await page.keyboard.press('Escape');
await wait(150);
check('Escape closes the dialog', await page.evaluate(() => !document.getElementById('info-dialog').open));
await page.click('#btn-info');
await wait(200);
await page.click('#info-close');
await wait(150);
check('Close closes the dialog', await page.evaluate(() => !document.getElementById('info-dialog').open));
check('focus goes back to the info button', await page.evaluate(() => document.activeElement?.id === 'btn-info'));
await page.click('#btn-info');
await wait(200);
await page.mouse.click(30, 330);
await wait(150);
check('a click on the veil closes the dialog', await page.evaluate(() => !document.getElementById('info-dialog').open));
await page.click('#btn-info');
await wait(200);
const box = dialog.box;
await page.mouse.click(box.left + 6, box.top + box.height / 2);
await wait(150);
check('a click on the dialog\'s own padding does not', await page.evaluate(() => document.getElementById('info-dialog').open));
await page.keyboard.press('Escape');

// ---- a narrow window
await page.setViewport({ width: 520, height: 420 });
await page.click('#btn-info');
await wait(300);
const narrow = await page.evaluate(() => {
    const dlg = document.getElementById('info-dialog');
    const b = dlg.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, scrollW: dlg.scrollWidth, clientW: dlg.clientWidth, scrollH: dlg.scrollHeight, clientH: dlg.clientHeight };
});
await page.screenshot({ path: shotPath(`${outPrefix}-${scheme}-diff-dialog-narrow.png`) });
check('in a narrow window the dialog stays inside it', narrow.left >= 0 && narrow.right <= 520 && narrow.top >= 0 && narrow.bottom <= 420, JSON.stringify(narrow));
await page.keyboard.press('Escape');

check('no console errors or warnings', problems.length === 0, problems.slice(0, 4).join(' | '));
await env.close();
finish();
