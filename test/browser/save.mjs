// Save in the full viewer: an untouched PDF is saved as it was opened, and a filled-in form field
// is saved with its value, which the viewer would otherwise drop.
import { createChecker, fixturePdf, startEnvironment, wait } from './support.mjs';

const TYPED = 'Ada Lovelace';
const pdfBase64 = fixturePdf('forms.pdf');
const env = await startEnvironment();
const pageServer = await env.serve(env.viewerHtml);
const { check, finish } = createChecker();

const page = await env.browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const problems = [];
page.on('console', m => { if (m.type() === 'error') { problems.push(`console.error: ${m.text()}`); } });
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument(() => {
    window.__posts = [];
    window.acquireVsCodeApi = () => ({ postMessage: m => window.__posts.push(m) });
    document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-dark'));
});
await page.goto(`http://127.0.0.1:${pageServer.port}/`);
await page.waitForFunction(() => window.__posts.some(p => p.type === 'ready'), { timeout: 20000 });
await page.evaluate(b => window.postMessage({ type: 'updatePdf', pdfBase64: b, filename: 'forms.pdf', zoom: 'fit' }, '*'), pdfBase64);
await page.waitForFunction(() => document.querySelector('.annotationLayer input[type="text"]'), { timeout: 20000 });
await wait(500);

/** Presses Save and returns what the page posted to the extension host. */
async function save() {
    const before = await page.evaluate(() => window.__posts.filter(p => p.type === 'download').length);
    await page.click('#downloadButton');
    await page.waitForFunction(count => window.__posts.filter(p => p.type === 'download').length > count, { timeout: 20000 }, before);
    return page.evaluate(() => window.__posts.filter(p => p.type === 'download').at(-1));
}

/** The value of every form field in a saved PDF, read back with PDF.js from the pages' widgets. */
function fieldValues(base64) {
    return page.evaluate(async b => {
        const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
        const task = globalThis.pdfjsLib.getDocument({ data: bytes });
        const doc = await task.promise;
        const values = {};
        for (let number = 1; number <= doc.numPages; number++) {
            for (const annotation of await (await doc.getPage(number)).getAnnotations()) {
                if (annotation.fieldName) { values[annotation.fieldName] = annotation.fieldValue; }
            }
        }
        await task.destroy();
        return values;
    }, base64);
}

const untouched = await save();
check('an untouched PDF is saved exactly as it was opened', untouched.pdfBase64 === pdfBase64 && untouched.filename === 'forms.pdf',
    `${untouched.pdfBase64.length} vs ${pdfBase64.length} base64 characters, ${untouched.filename}`);

// Fill in the first editable text field, then leave it, which is when the viewer stores the value.
const fieldName = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.annotationLayer input[type="text"]')].find(e => !e.readOnly && !e.disabled && !e.value);
    input?.setAttribute('data-test-target', '1');
    return input?.getAttribute('name') ?? null;
});
check('the form has an empty text field to fill in', Boolean(fieldName), String(fieldName));
await page.click('[data-test-target="1"]');
await page.keyboard.type(TYPED);
await page.keyboard.press('Tab');
await wait(300);

const filled = await save();
const values = await fieldValues(filled.pdfBase64);
check('a filled-in field is saved with the value that was typed', values[fieldName] === TYPED, JSON.stringify(values));
check('and the saved PDF is a new copy, not the one that was opened', filled.pdfBase64 !== pdfBase64);
check('the other fields keep their values', values.city === 'London', `city=${values.city}`);
check('the saved copy keeps the file name', filled.filename === 'forms.pdf', filled.filename);
check('no page errors or console errors', problems.length === 0, problems.slice(0, 3).join(' | '));

await env.close();
finish();
