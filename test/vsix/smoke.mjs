/**
 * Smoke-tests the packaged extension: unpacks a .vsix, checks that the files the extension loads at
 * run time are in it, and renders every template it ships with its own engine.
 *
 *   node test/vsix/smoke.mjs [lpdf.vsix]
 *
 * The unit and browser tests run on the source tree; this runs on what users install. It catches a
 * `.vscodeignore` rule that leaves out something the extension needs, and a worker or WASM path that
 * only works in the repository's layout. The package is unpacked into a temporary folder, away from
 * the repository's node_modules, and the templates are rendered the way the preview and export do it:
 * through the packaged `dist/engine.js`, which starts `dist/worker.js`, which loads `wasm/lpdf.js`.
 * Neither engine.js nor templates.js imports `vscode`, so they run in plain Node. Each PDF is then
 * opened with the PDF.js of the package, the one the viewer uses.
 *
 * What only VS Code shows, the preview and the export themselves, is still checked by hand.
 *
 * Run it after `npx vsce package --out lpdf.vsix`. It needs git, to list the files under media/ and
 * templates/ that the package must carry.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createChecker } from '../browser/support.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The extension's folder. */
const ROOT = path.resolve(here, '..', '..');

/** What the extension loads at run time, besides package.json's `main` and the files under SHIPPED_FOLDERS. */
const RUNTIME_FILES = [
    'dist/engine.js',
    'dist/worker.js',
    'dist/templates.js',
    'dist/markdown-engine.js',
    'wasm/lpdf.js',
    'wasm/lpdf_bg.wasm',
    'schema/lpdf.xsd',
];

/** Folders whose every file in git must be in the package: the viewer's and the templates'. */
const SHIPPED_FOLDERS = ['media', 'templates'];

/** Files in those folders that `.vscodeignore` leaves out on purpose: notes for whoever upgrades PDF.js. */
const LEFT_OUT = new Set(['media/viewer/README.md', 'media/viewer/vendored.json']);

/** Where vsce puts the extension's files in the archive. */
const EXTENSION_PREFIX = 'extension/';

const END_OF_CENTRAL_DIRECTORY = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const ZIP64_MARKER = 0xffffffff;

/** Thrown when the .vsix is not the kind of zip file vsce writes. */
class VsixFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VsixFormatError';
    }
}

/** Thrown when git cannot list the files the package must carry. */
class GitListError extends Error {
    constructor(detail) {
        super(`git ls-files failed in ${ROOT}: ${detail}`);
        this.name = 'GitListError';
    }
}

/**
 * Reads every file of a zip archive. It handles what vsce writes: stored and deflated entries, no zip64.
 * @param {Buffer} zip The archive.
 * @returns {Map<string, Buffer>} Each file's bytes, by its path in the archive.
 * @throws {VsixFormatError} When the archive is not one it can read.
 */
function readZip(zip) {
    const end = zip.lastIndexOf(END_OF_CENTRAL_DIRECTORY);
    if (end < 0) { throw new VsixFormatError('no end of central directory: not a zip file'); }
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    if (offset === ZIP64_MARKER) { throw new VsixFormatError('zip64 archives are not supported'); }

    const files = new Map();
    for (let index = 0; index < count; index++) {
        if (zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
            throw new VsixFormatError(`entry ${index + 1} of ${count}: no central directory header at ${offset}`);
        }
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const extraLength = zip.readUInt16LE(offset + 30);
        const commentLength = zip.readUInt16LE(offset + 32);
        const localOffset = zip.readUInt32LE(offset + 42);
        const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) { continue; }

        if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) { throw new VsixFormatError(`${name}: no local file header at ${localOffset}`); }
        const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        const data = zip.subarray(dataStart, dataStart + compressedSize);
        if (method === STORED) {
            files.set(name, data);
        } else if (method === DEFLATED) {
            files.set(name, inflateRawSync(data));
        } else {
            throw new VsixFormatError(`${name}: compression method ${method} is not supported`);
        }
    }
    return files;
}

/**
 * Writes the files of an archive into a folder.
 * @param {Map<string, Buffer>} files What `readZip` returned.
 * @param {string} folder An empty folder.
 * @throws {VsixFormatError} When a path in the archive would land outside the folder.
 */
function unpack(files, folder) {
    for (const [name, bytes] of files) {
        const target = path.resolve(folder, name);
        if (!target.startsWith(folder + path.sep)) { throw new VsixFormatError(`${name}: points outside the folder it is unpacked into`); }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
    }
}

/**
 * The files the package must carry from SHIPPED_FOLDERS: those git tracks there, less LEFT_OUT.
 * @returns {string[]} Their paths, relative to the extension's folder, with `/` between folders.
 * @throws {GitListError} When git cannot list them.
 */
function shippedFiles() {
    const result = spawnSync('git', ['ls-files', '-z', '--', ...SHIPPED_FOLDERS], { cwd: ROOT, encoding: 'utf8' });
    if (result.error) { throw new GitListError(result.error.message); }
    if (result.status !== 0) { throw new GitListError(result.stderr.trim()); }
    return result.stdout.split('\0').filter(file => file && !LEFT_OUT.has(file));
}

/**
 * The fonts and images a template's document declares in `<assets>`, read from the template's folder
 * and keyed as the extension keys them: by `ref`, else by `name`. Declarations without `src`, core fonts
 * and fonts left to Helvetica, load nothing.
 * @param {string} xml The document.
 * @param {string} folder The template's folder, which its `src` paths are relative to.
 * @returns {{ fonts: Map<string, Uint8Array>, images: Map<string, Uint8Array> }}
 */
function readAssets(xml, folder) {
    const fonts = new Map();
    const images = new Map();
    const source = xml.replace(/<!--[\s\S]*?-->/g, '');
    for (const block of source.matchAll(/<assets\b[^>]*>([\s\S]*?)<\/assets\s*>/g)) {
        for (const [, kind, attributeText] of block[1].matchAll(/<(font|image)\b([^>]*)>/g)) {
            const attributes = new Map([...attributeText.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map(match => [match[1], match[2]]));
            const src = attributes.get('src');
            if (!src) { continue; }
            const key = attributes.get('ref') ?? attributes.get('name');
            (kind === 'font' ? fonts : images).set(key, fs.readFileSync(path.join(folder, src)));
        }
    }
    return { fonts, images };
}

/**
 * Imports the packaged PDF.js. In Node it warns, as it loads, that it has no canvas to draw with;
 * nothing here draws, so those two warnings are left out of the output.
 * @param {string} extension The unpacked extension's folder.
 */
async function importPdfjs(extension) {
    const build = path.join(extension, 'media', 'viewer', 'build');
    const warn = console.warn;
    console.warn = (...args) => {
        if (!/^Warning: Cannot (load "@napi-rs\/canvas"|polyfill)/.test(String(args[0]))) { warn(...args); }
    };
    try {
        const pdfjs = await import(pathToFileURL(path.join(build, 'pdf.mjs')).href);
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(build, 'pdf.worker.mjs')).href;
        return pdfjs;
    } finally {
        console.warn = warn;
    }
}

/**
 * Opens a PDF with PDF.js and reads the text of every page, which parses each page's content.
 * @param {object} pdfjs The PDF.js module.
 * @param {Uint8Array} bytes The PDF.
 * @returns {Promise<{ pages: number, textItems: number }>}
 * @throws When PDF.js cannot open it: `InvalidPDFException` for a broken file.
 */
async function readPdf(pdfjs, bytes) {
    // PDF.js takes over the buffer it is given, so it gets a copy.
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
    try {
        const pdf = await task.promise;
        let textItems = 0;
        for (let number = 1; number <= pdf.numPages; number++) {
            const page = await pdf.getPage(number);
            textItems += (await page.getTextContent()).items.length;
        }
        return { pages: pdf.numPages, textItems };
    } finally {
        await task.destroy();
    }
}

/** Whether bytes start as a PDF does and end with its end-of-file marker. */
function hasPdfFrame(bytes) {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return buffer.toString('latin1', 0, 5) === '%PDF-' && buffer.toString('latin1', Math.max(0, buffer.length - 32)).includes('%%EOF');
}

/**
 * Renders every packaged template through the packaged engine, with its data when it has some, as the
 * preview does when a document.json sits next to the document, and checks each PDF.
 */
async function checkRendering(checker, extension) {
    const engine = require(path.join(extension, 'dist', 'engine.js'));
    const { loadTemplates } = require(path.join(extension, 'dist', 'templates.js'));
    const pdfjs = await importPdfjs(extension);
    const templates = loadTemplates(path.join(extension, 'templates'));
    checker.check('the package has templates', templates.length > 0, `${templates.length}`);
    try {
        // One at a time: the engine supersedes a render that waits while another runs.
        for (const template of templates) {
            const name = `${template.id} renders through dist/engine.js to a PDF that PDF.js opens`;
            try {
                const xml = fs.readFileSync(template.xmlPath, 'utf8');
                const data = template.dataPath ? fs.readFileSync(template.dataPath, 'utf8') : null;
                const bytes = await engine.renderPdf(xml, data, readAssets(xml, path.dirname(template.xmlPath)));
                if (!hasPdfFrame(bytes)) {
                    checker.check(name, false, `${bytes.length} bytes without %PDF- at the start and %%EOF at the end`);
                    continue;
                }
                const { pages, textItems } = await readPdf(pdfjs, bytes);
                checker.check(name, pages > 0 && textItems > 0, `${pages} page(s), ${textItems} text items, ${bytes.length} bytes`);
            } catch (error) {
                checker.check(name, false, `${error.name}: ${error.message}`);
            }
        }

        // A .md file goes the same way: wrapped in the default template by the packaged helpers, which ask the packaged
        // engine, and rendered by it. markdown-engine.js imports no more than node's own modules, so it runs here.
        const { prepareMarkdown } = require(path.join(extension, 'dist', 'markdown-engine.js'));
        const name = 'a Markdown file renders through dist/markdown-engine.js and dist/engine.js to a PDF that PDF.js opens';
        try {
            const prepared = prepareMarkdown('---\ntitle: Notes\n---\n\n# Notes\n\nSome *text*, a list and a table:\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', null);
            const bytes = await engine.renderPdf(prepared.xml, prepared.jsonData, { fonts: new Map(), images: new Map() });
            const { pages, textItems } = hasPdfFrame(bytes) ? await readPdf(pdfjs, bytes) : { pages: 0, textItems: 0 };
            checker.check(name, pages > 0 && textItems > 0, `${pages} page(s), ${textItems} text items, ${bytes.length} bytes`);
        } catch (error) {
            checker.check(name, false, `${error.name}: ${error.message}`);
        }
    } finally {
        engine.disposeRenderWorker();
    }
}

/** Checks one .vsix; the checker's report is the result. */
async function smokeTest(vsixPath, checker) {
    const files = readZip(fs.readFileSync(vsixPath));
    const packaged = new Set([...files.keys()].filter(name => name.startsWith(EXTENSION_PREFIX)).map(name => name.slice(EXTENSION_PREFIX.length)));
    checker.check(`${path.basename(vsixPath)} unpacks`, packaged.size > 0, `${packaged.size} files under ${EXTENSION_PREFIX}`);

    const manifest = files.get(`${EXTENSION_PREFIX}package.json`);
    const main = manifest ? path.posix.normalize(JSON.parse(manifest.toString('utf8')).main ?? '') : '';
    checker.check('package.json names its main file', main !== '' && main !== '.', main);

    for (const file of [main, ...RUNTIME_FILES].filter(file => file && file !== '.')) {
        checker.check(`${file} is in the package`, packaged.has(file));
    }
    const missing = shippedFiles().filter(file => !packaged.has(file));
    checker.check(
        `every file git has under ${SHIPPED_FOLDERS.join('/ and ')}/ is in the package`,
        missing.length === 0,
        missing.length ? `${missing.length} missing: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}` : '',
    );

    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-vsix-'));
    try {
        unpack(files, folder);
        // Without these two there is nothing to render with; their checks above have failed already.
        if (packaged.has('dist/engine.js') && packaged.has('dist/templates.js')) {
            await checkRendering(checker, path.join(folder, 'extension'));
        }
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
}

const vsixPath = path.resolve(process.argv[2] ?? path.join(ROOT, 'lpdf.vsix'));
const checker = createChecker();
try {
    if (checker.check(`${vsixPath} exists`, fs.existsSync(vsixPath), 'made by npx vsce package --out lpdf.vsix')) {
        await smokeTest(vsixPath, checker);
    }
} catch (error) {
    checker.check('the smoke test ran to the end', false, `${error.name}: ${error.message}`);
}
checker.finish();
