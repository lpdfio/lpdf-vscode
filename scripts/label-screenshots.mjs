/**
 * Makes the README's screenshots from the raw ones: crops each, and puts numbered labels on it.
 *
 *   node scripts/label-screenshots.mjs            every image in docs/images/labels.json
 *   node scripts/label-screenshots.mjs diff hover only those
 *
 * `docs/images/source/<name>.png` is the screenshot as it was taken; `docs/images/<name>.png` is what
 * the README shows. `labels.json` says, for each name, how to crop the source and where the labels
 * go, in pixels of the source: `{ "source": "diff.png", "crop": { x, y, width, height }, "labels":
 * [{ "n": 1, "x": 208, "y": 119 }] }`. A label is a circle centred on that point. The numbers match
 * the list under the image in README.md, because text in an image is not read out or searched.
 * Change a screenshot or a position, and run this again; nothing is drawn by hand.
 *
 * It draws with the headless browser that the browser tests use (test/browser/support.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The folder with the screenshots, and the one with the raw ones. */
export const IMAGES_DIR = path.join(HERE, '..', 'docs', 'images');
export const SOURCE_DIR = path.join(IMAGES_DIR, 'source');
export const SPEC_FILE = path.join(IMAGES_DIR, 'labels.json');

/** The look of a label: the brand orange, with a dark number (5.6:1) and a white ring that shows on dark and light. */
export const LABEL_STYLE = { diameter: 40, fill: '#d76f04', text: '#141414', ring: '#ffffff', fontSize: 22 };

/** Thrown when the spec or a screenshot is not usable; the message says which. */
export class LabelSpecError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LabelSpecError';
    }
}

/**
 * The size of a PNG, from its header.
 * @param {Buffer} png The file.
 * @returns {{ width: number, height: number }}
 * @throws {LabelSpecError} When it is not a PNG.
 */
export function pngSize(png) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (png.length < 24 || !png.subarray(0, 8).equals(signature)) { throw new LabelSpecError('not a PNG file'); }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Checks one entry of the spec against the size of its screenshot, and puts the labels in the
 * cropped image's own pixels.
 * @param {string} name The entry's name, for messages.
 * @param {{ source?: string, crop?: object, labels?: object[] }} entry The entry.
 * @param {{ width: number, height: number }} size The size of the source screenshot.
 * @returns {{ source: string, crop: { x: number, y: number, width: number, height: number }, labels: { n: number, x: number, y: number }[] }}
 * @throws {LabelSpecError} For a missing field, a crop outside the screenshot, a label outside the crop, or a repeated number.
 */
export function planImage(name, entry, size) {
    if (!entry || typeof entry.source !== 'string') { throw new LabelSpecError(`${name}: "source" is missing`); }
    const crop = entry.crop ?? { x: 0, y: 0, width: size.width, height: size.height };
    for (const key of ['x', 'y', 'width', 'height']) {
        if (!Number.isInteger(crop[key]) || crop[key] < 0) { throw new LabelSpecError(`${name}: crop.${key} must be a whole number of pixels, 0 or more`); }
    }
    if (crop.width === 0 || crop.height === 0) { throw new LabelSpecError(`${name}: the crop is empty`); }
    if (crop.x + crop.width > size.width || crop.y + crop.height > size.height) {
        throw new LabelSpecError(`${name}: the crop goes outside the ${size.width}x${size.height} screenshot`);
    }
    const seen = new Set();
    const labels = (entry.labels ?? []).map(label => {
        if (!Number.isInteger(label.n) || label.n < 1) { throw new LabelSpecError(`${name}: a label needs a number from 1`); }
        if (seen.has(label.n)) { throw new LabelSpecError(`${name}: label ${label.n} is there twice`); }
        seen.add(label.n);
        const x = label.x - crop.x;
        const y = label.y - crop.y;
        if (!(x >= 0 && y >= 0 && x <= crop.width && y <= crop.height)) {
            throw new LabelSpecError(`${name}: label ${label.n} is outside the crop`);
        }
        return { n: label.n, x, y };
    });
    return { source: entry.source, crop, labels };
}

/**
 * The page that is drawn and photographed: the cropped screenshot, with the labels over it.
 * @param {string} dataUrl The screenshot as a `data:` URL.
 * @param {ReturnType<typeof planImage>} plan What `planImage` returned.
 * @returns {string} HTML.
 */
export function labelPageHtml(dataUrl, plan) {
    const { diameter, fill, text, ring, fontSize } = LABEL_STYLE;
    const circles = plan.labels.map(label => `<span class="label" style="left:${label.x - diameter / 2}px;top:${label.y - diameter / 2}px">${label.n}</span>`).join('');
    return `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; background: #000; }
#shot { position: relative; width: ${plan.crop.width}px; height: ${plan.crop.height}px; overflow: hidden; }
#shot img { position: absolute; left: ${-plan.crop.x}px; top: ${-plan.crop.y}px; }
.label { position: absolute; box-sizing: border-box; width: ${diameter}px; height: ${diameter}px; border-radius: 50%;
    background: ${fill}; color: ${text}; border: 3px solid ${ring}; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.5);
    font: 700 ${fontSize}px/${diameter - 6}px "Segoe UI", system-ui, Arial, sans-serif; text-align: center; }
</style><div id="shot"><img src="${dataUrl}" alt="">${circles}</div>`;
}

/**
 * Reads the spec.
 * @param {string} [file] The spec file.
 * @returns {Record<string, object>}
 * @throws {LabelSpecError} When it is missing or not JSON.
 */
export function readSpec(file = SPEC_FILE) {
    if (!fs.existsSync(file)) { throw new LabelSpecError(`${file} is missing`); }
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new LabelSpecError(`${file} is not JSON: ${error.message}`);
    }
}

/** Draws the named images, or all of them. */
async function run(names) {
    const spec = readSpec();
    const wanted = names.length > 0 ? names : Object.keys(spec);
    for (const name of wanted) {
        if (!(name in spec)) { throw new LabelSpecError(`${name} is not in labels.json`); }
    }
    // The browser is only started when there is something to draw; the support module is only loaded then.
    const { launchBrowser } = await import(pathToFileURL(path.join(HERE, '..', 'test', 'browser', 'support.mjs')).href);
    const browser = await launchBrowser();
    try {
        for (const name of wanted) {
            const sourceFile = path.join(SOURCE_DIR, spec[name].source ?? '');
            if (!fs.existsSync(sourceFile)) { throw new LabelSpecError(`${name}: ${sourceFile} is missing`); }
            const png = fs.readFileSync(sourceFile);
            const plan = planImage(name, spec[name], pngSize(png));
            const page = await browser.newPage();
            await page.setViewport({ width: plan.crop.width, height: plan.crop.height, deviceScaleFactor: 1 });
            await page.setContent(labelPageHtml(`data:image/png;base64,${png.toString('base64')}`, plan));
            const element = await page.$('#shot');
            await element.screenshot({ path: path.join(IMAGES_DIR, `${name}.png`) });
            await page.close();
            process.stdout.write(`${name}.png  ${plan.crop.width}x${plan.crop.height}  ${plan.labels.length} labels\n`);
        }
    } finally {
        await browser.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run(process.argv.slice(2)).catch(error => {
        if (!(error instanceof LabelSpecError)) { throw error; }
        process.stderr.write(`label-screenshots: ${error.message}\n`);
        process.exitCode = 1;
    });
}
