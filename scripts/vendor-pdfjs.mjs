/**
 * Brings a PDF.js release into media/viewer/, keeping only what the extension uses.
 *
 *   node scripts/vendor-pdfjs.mjs --pdfjs <folder> --liberation <folder>
 *   node scripts/vendor-pdfjs.mjs --check
 *
 * `--pdfjs` is the unpacked `pdfjs-<version>-legacy-dist.zip` of a PDF.js release, the folder with
 * `build/` and `web/` in it. It must be the legacy build: the standard one takes the browser to have
 * `Promise.try`, `RegExp.escape` and other JavaScript that only the newest VS Code has, and fails
 * without it; the legacy build carries polyfills for them, and runs in the browser of the oldest VS Code
 * the extension supports. `--liberation` is the unpacked `liberation-fonts-ttf-<version>.tar.gz`
 * of a Liberation Fonts release; its version is read from the folder name, or given with
 * `--liberation-version`. Without `--check` the script replaces `build/`, `web/`, `LICENSE` and
 * `vendored.json` in media/viewer/, and nothing else: the extension's own files there stay.
 *
 * What it does to the release, and why:
 *   - Keeps the library, its worker, the viewer, and the data the viewer loads (character maps,
 *     colour profiles, standard fonts, WebAssembly decoders, images). Drops the rest: source maps,
 *     the scripting sandbox (scripting is switched off), the debugger, the sample PDF.
 *   - Keeps the English text of the viewer and drops the other 113 languages, about 3 MB.
 *   - Replaces the four Liberation Sans fonts with the Liberation release given: the ones in the
 *     PDF.js release are version 1.x, under the GNU GPL with font exceptions, and 2.x is under the
 *     SIL Open Font License.
 *   - Lowers the highest zoom of the viewer, `MAX_SCALE` in web/viewer.mjs, from 25 (2500%) to 10
 *     (1000%), and says so at the top of that file. It is the one change to PDF.js's code: the limit is
 *     a constant that the buttons, the keys, the wheel and pinch all share, and nothing in the viewer
 *     sets it. A release that does not have that constant as expected is refused, to be looked at.
 *   - Writes `vendored.json`: the versions, the change, and the SHA-256 of every file. `--check` compares the
 *     folder with it, which catches a vendored file that was edited by hand.
 *
 * README.md in media/viewer/ describes the whole upgrade, including what to test afterwards.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Thrown for anything the user can fix: a missing folder, an unreadable release, a bad option. */
export class VendorError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VendorError';
    }
}

/** The folder this script fills. */
export const VIEWER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media', 'viewer');

export const MANIFEST_NAME = 'vendored.json';

/** What the script owns in the viewer folder; it removes these before it copies, and touches nothing else. */
export const OWNED = ['build', 'web', 'LICENSE', MANIFEST_NAME];

/** The build of PDF.js that the extension runs on. */
export const PDFJS_BUILD = 'legacy';

/** The files of a release that are kept, by their path in the release. */
const KEPT_FILES = ['LICENSE', 'build/pdf.mjs', 'build/pdf.worker.mjs', 'web/viewer.html', 'web/viewer.mjs', 'web/viewer.css'];

/**
 * The folders of a release that are kept whole. The character maps are for PDFs that name a CJK
 * font by a predefined encoding, which the viewer meets in any PDF a user opens, though not in
 * those Lpdf makes; they are fetched only when such a PDF is opened.
 */
const KEPT_FOLDERS = ['web/images/', 'web/cmaps/', 'web/iccs/', 'web/standard_fonts/', 'web/wasm/'];

/** The viewer's highest zoom: 1000%. PDF.js allows 2500%, which no reader needs and which costs memory. */
export const MAX_SCALE = 10;
const VIEWER_FILE = 'web/viewer.mjs';
const PDFJS_MAX_SCALE_DEFINITION = /^const MAX_SCALE = 25\.0;$/m;
const PDFJS_MAX_SCALE_USE = /\/\* inlined export \.MAX_SCALE \*\/25(?![\d.])/g;

/** The viewer's languages that are kept, by folder name. The viewer falls back to English. */
export const KEPT_LOCALES = ['en-US'];

/** The Liberation Sans files that replace the ones in the release, and the licence that goes with them. */
export const LIBERATION_FONTS = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf'];
const FONT_FOLDER = 'web/standard_fonts';
const LIBERATION_LICENSE = 'LICENSE_LIBERATION';

/**
 * Whether a file of the release is kept.
 * @param {string} relativePath Its path in the release, with `/` separators.
 * @param {string[]} [keptLocales] The languages to keep.
 * @returns {boolean}
 */
export function isKept(relativePath, keptLocales = KEPT_LOCALES) {
    if (KEPT_FILES.includes(relativePath)) { return true; }
    if (KEPT_FOLDERS.some(folder => relativePath.startsWith(folder))) { return true; }
    if (relativePath === 'web/locale/locale.json') { return true; }
    return keptLocales.some(locale => relativePath.startsWith(`web/locale/${locale}/`));
}

/**
 * The viewer's index of its languages, with only the kept ones. The index maps a lower-case
 * language code to the file of that language, as `{ "en-us": "en-US/viewer.ftl" }`.
 * @param {string} indexJson The text of `web/locale/locale.json` in the release.
 * @param {string[]} [keptLocales] The languages to keep, by folder name.
 * @returns {string} The trimmed index.
 * @throws {VendorError} When the index is not what it was, or a kept language is not in it.
 */
export function trimLocaleIndex(indexJson, keptLocales = KEPT_LOCALES) {
    let index;
    try {
        index = JSON.parse(indexJson);
    } catch (error) {
        throw new VendorError(`web/locale/locale.json is not JSON: ${error.message}`);
    }
    const kept = {};
    for (const locale of keptLocales) {
        const entry = Object.entries(index).find(([, file]) => String(file).startsWith(`${locale}/`));
        if (!entry) { throw new VendorError(`web/locale/locale.json has no entry for ${locale}`); }
        kept[entry[0]] = entry[1];
    }
    return `${JSON.stringify(kept)}\n`;
}

/**
 * Whether a build of PDF.js is the legacy one. The legacy build has the polyfills of core-js bundled
 * in, for the JavaScript that older browsers lack; the standard build has none.
 * @param {string} librarySource The text of `build/pdf.mjs`.
 * @returns {boolean}
 */
export function isLegacyBuild(librarySource) {
    return librarySource.includes('core-js');
}

/**
 * The viewer with its highest zoom lowered, and a notice at the top that it was changed.
 * @param {string} viewerSource The text of `web/viewer.mjs` in the release.
 * @param {number} [maxScale] The highest zoom, as a factor: 10 is 1000%.
 * @returns {string} The changed text.
 * @throws {VendorError} When the viewer does not define its highest zoom as 25, or never uses it.
 */
export function capViewerZoom(viewerSource, maxScale = MAX_SCALE) {
    if (!PDFJS_MAX_SCALE_DEFINITION.test(viewerSource)) {
        throw new VendorError(`${VIEWER_FILE} no longer has "const MAX_SCALE = 25.0;": look at whether the zoom cap in scripts/vendor-pdfjs.mjs is still needed`);
    }
    const uses = viewerSource.match(PDFJS_MAX_SCALE_USE)?.length ?? 0;
    if (uses === 0) {
        throw new VendorError(`${VIEWER_FILE} no longer uses MAX_SCALE as an inlined 25: look at how the zoom cap in scripts/vendor-pdfjs.mjs is applied`);
    }
    const notice = `// Changed by Lpdf: MAX_SCALE, the highest zoom, is ${maxScale} (${maxScale * 100}%), not 25 (2500%). `
        + 'By scripts/vendor-pdfjs.mjs; see media/viewer/README.md.\n';
    return notice + viewerSource
        .replace(PDFJS_MAX_SCALE_DEFINITION, `const MAX_SCALE = ${maxScale}.0;`)
        .replace(PDFJS_MAX_SCALE_USE, `/* inlined export .MAX_SCALE */${maxScale}`);
}

/**
 * The version of a PDF.js build, from the comment at the top of `build/pdf.mjs`.
 * @param {string} librarySource The text of `build/pdf.mjs`.
 * @returns {string} For example `6.3.289`.
 * @throws {VendorError} When the build carries no version.
 */
export function readPdfjsVersion(librarySource) {
    const match = /pdfjsVersion\s*=\s*(\d+\.\d+\.\d+[\w.-]*)/.exec(librarySource.slice(0, 2000));
    if (!match) { throw new VendorError('build/pdf.mjs does not say which version of PDF.js it is'); }
    return match[1];
}

/**
 * The version of a Liberation Fonts release, from the name of its folder.
 * @param {string} folder The unpacked release, such as `liberation-fonts-ttf-2.1.5`.
 * @returns {string | undefined} For example `2.1.5`, or undefined when the name does not say.
 */
export function liberationVersionOf(folder) {
    return /(\d+\.\d+\.\d+)$/.exec(path.basename(folder.replace(/[\\/]+$/, '')))?.[1];
}

/** Every file under a folder, as sorted paths relative to it with `/` separators. */
export function listFiles(root) {
    const found = [];
    const walk = relative => {
        for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
            const child = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) { walk(child); } else { found.push(child); }
        }
    };
    walk('');
    return found.sort();
}

/** The SHA-256 of a file, in hex. */
export function sha256(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireFolder(folder, what, hint) {
    if (!folder) { throw new VendorError(`${what} is needed: ${hint}`); }
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new VendorError(`${what} is not a folder: ${folder}`);
    }
}

function requireFile(file, what) {
    if (!fs.existsSync(file)) { throw new VendorError(`${what} is missing: ${file}`); }
}

/**
 * Replaces the vendored parts of the viewer folder with a pruned PDF.js release and a Liberation
 * Sans release.
 * @param {object} options
 * @param {string} options.pdfjsDir The unpacked PDF.js release.
 * @param {string} options.liberationDir The unpacked Liberation Fonts release.
 * @param {string} [options.liberationVersion] Its version, when the folder name does not say.
 * @param {string} [options.targetDir] The viewer folder; the extension's by default.
 * @returns {{ pdfjsVersion: string, liberationVersion: string, kept: number, dropped: number, droppedBytes: number }}
 * @throws {VendorError} When a folder is missing or is not the release it should be.
 */
export function vendor({ pdfjsDir, liberationDir, liberationVersion, targetDir = VIEWER_DIR }) {
    requireFolder(pdfjsDir, '--pdfjs', 'the unpacked pdfjs-<version>-dist.zip');
    requireFolder(liberationDir, '--liberation', 'the unpacked liberation-fonts-ttf-<version>.tar.gz');
    const fontsVersion = liberationVersion ?? liberationVersionOf(liberationDir);
    if (!fontsVersion) { throw new VendorError('The Liberation version is not in the folder name; give it with --liberation-version'); }
    for (const required of KEPT_FILES) { requireFile(path.join(pdfjsDir, required), `${required} of the PDF.js release`); }
    for (const font of [...LIBERATION_FONTS, 'LICENSE']) { requireFile(path.join(liberationDir, font), `${font} of the Liberation release`); }
    const librarySource = fs.readFileSync(path.join(pdfjsDir, 'build', 'pdf.mjs'), 'utf8');
    const pdfjsVersion = readPdfjsVersion(librarySource);
    if (!isLegacyBuild(librarySource)) {
        throw new VendorError(
            `--pdfjs is the standard build of PDF.js ${pdfjsVersion}, which needs a newer browser than the oldest VS Code the extension supports; `
            + `use pdfjs-${pdfjsVersion}-legacy-dist.zip`,
        );
    }

    const viewerSource = capViewerZoom(fs.readFileSync(path.join(pdfjsDir, VIEWER_FILE), 'utf8'));

    for (const owned of OWNED) { fs.rmSync(path.join(targetDir, owned), { recursive: true, force: true }); }

    let kept = 0;
    let dropped = 0;
    let droppedBytes = 0;
    for (const relative of listFiles(pdfjsDir)) {
        const from = path.join(pdfjsDir, relative);
        if (!isKept(relative)) {
            dropped++;
            droppedBytes += fs.statSync(from).size;
            continue;
        }
        const to = path.join(targetDir, relative);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (relative === 'web/locale/locale.json') {
            fs.writeFileSync(to, trimLocaleIndex(fs.readFileSync(from, 'utf8')));
        } else if (relative === VIEWER_FILE) {
            fs.writeFileSync(to, viewerSource);
        } else {
            fs.copyFileSync(from, to);
        }
        kept++;
    }

    for (const font of LIBERATION_FONTS) {
        fs.copyFileSync(path.join(liberationDir, font), path.join(targetDir, FONT_FOLDER, font));
    }
    fs.copyFileSync(path.join(liberationDir, 'LICENSE'), path.join(targetDir, FONT_FOLDER, LIBERATION_LICENSE));

    writeManifest(targetDir, { pdfjsVersion, liberationVersion: fontsVersion });
    return { pdfjsVersion, liberationVersion: fontsVersion, kept, dropped, droppedBytes };
}

/** The files the manifest covers: everything the script owns, except the manifest itself. */
function vendoredFiles(targetDir) {
    return OWNED.filter(name => name !== MANIFEST_NAME)
        .flatMap(name => {
            const full = path.join(targetDir, name);
            if (!fs.existsSync(full)) { return []; }
            return fs.statSync(full).isDirectory() ? listFiles(full).map(file => `${name}/${file}`) : [name];
        })
        .sort();
}

function writeManifest(targetDir, { pdfjsVersion, liberationVersion }) {
    const files = {};
    for (const relative of vendoredFiles(targetDir)) { files[relative] = sha256(path.join(targetDir, relative)); }
    const manifest = {
        pdfjs: { version: pdfjsVersion, build: PDFJS_BUILD, source: `https://github.com/mozilla/pdf.js/releases/tag/v${pdfjsVersion}` },
        liberation: { version: liberationVersion, source: `https://github.com/liberationfonts/liberation-fonts/releases/tag/${liberationVersion}` },
        locales: KEPT_LOCALES,
        changes: { [VIEWER_FILE]: `the highest zoom, MAX_SCALE, is ${MAX_SCALE} (${MAX_SCALE * 100}%) instead of 25 (2500%)` },
        files,
    };
    fs.writeFileSync(path.join(targetDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Compares the vendored files with the manifest written when they were vendored.
 * @param {string} [targetDir] The viewer folder; the extension's by default.
 * @returns {{ modified: string[], missing: string[], extra: string[] }} Files that changed, files that are gone, and files the manifest does not know.
 * @throws {VendorError} When there is no manifest.
 */
export function checkVendored(targetDir = VIEWER_DIR) {
    const manifestPath = path.join(targetDir, MANIFEST_NAME);
    if (!fs.existsSync(manifestPath)) { throw new VendorError(`${MANIFEST_NAME} is missing in ${targetDir}`); }
    const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files;
    const actual = vendoredFiles(targetDir);
    return {
        modified: actual.filter(file => file in expected && sha256(path.join(targetDir, file)) !== expected[file]),
        missing: Object.keys(expected).filter(file => !actual.includes(file)),
        extra: actual.filter(file => !(file in expected)),
    };
}

function readOptions(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const name = argv[index];
        if (name === '--check') { options.check = true; continue; }
        if (!['--pdfjs', '--liberation', '--liberation-version'].includes(name)) { throw new VendorError(`Unknown option ${name}`); }
        const value = argv[++index];
        if (!value) { throw new VendorError(`${name} needs a value`); }
        options[name.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] = value;
    }
    return options;
}

function run(argv) {
    const options = readOptions(argv);
    if (options.check) {
        const { modified, missing, extra } = checkVendored();
        for (const [label, files] of [['changed', modified], ['missing', missing], ['not in vendored.json', extra]]) {
            for (const file of files) { process.stderr.write(`${label}: ${file}\n`); }
        }
        if (modified.length + missing.length + extra.length > 0) { process.exitCode = 1; return; }
        process.stdout.write('The vendored viewer files match vendored.json.\n');
        return;
    }
    const result = vendor({
        pdfjsDir: options.pdfjs,
        liberationDir: options.liberation,
        liberationVersion: options.liberationVersion,
    });
    process.stdout.write(`PDF.js ${result.pdfjsVersion} with Liberation Sans ${result.liberationVersion}: ${result.kept} files kept, `
        + `${result.dropped} dropped (${(result.droppedBytes / 1e6).toFixed(1)} MB).\n`);
    process.stdout.write('Next: node scripts/vendor-pdfjs.mjs --check, npm test, and the checks in media/viewer/README.md.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        run(process.argv.slice(2));
    } catch (error) {
        if (!(error instanceof VendorError)) { throw error; }
        process.stderr.write(`vendor-pdfjs: ${error.message}\n`);
        process.exitCode = 1;
    }
}
