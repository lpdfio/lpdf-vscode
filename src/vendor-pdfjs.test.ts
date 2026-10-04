import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    capViewerZoom,
    checkVendored,
    isKept,
    isLegacyBuild,
    liberationVersionOf,
    LIBERATION_FONTS,
    listFiles,
    MAX_SCALE,
    readPdfjsVersion,
    trimLocaleIndex,
    vendor,
    VendorError,
} from '../scripts/vendor-pdfjs.mjs';

const realViewerDir = path.join(__dirname, '..', 'media', 'viewer');

/** The parts of PDF.js's viewer that set its highest zoom: the constant, and where the bundler inlined it. */
const VIEWER_SOURCE = [
    'const MIN_SCALE = 0.1;',
    'const MAX_SCALE = 25.0;',
    'newScale = MathClamp(newScale, (/* inlined export .MIN_SCALE */0.1), (/* inlined export .MAX_SCALE */25));',
    'opts.zoomIn.disabled = pageScale >= (/* inlined export .MAX_SCALE */25);',
    'const MAX_AUTO_SCALE = 1.25;',
    '',
].join('\n');

let work: string;
let releaseDir: string;
let liberationDir: string;
let targetDir: string;

function write(root: string, relative: string, content: string | Buffer): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

/** A small stand-in for an unpacked PDF.js release, with files to keep and files to drop. */
function makeRelease(root: string): void {
    write(root, 'LICENSE', 'Apache');
    write(root, 'build/pdf.mjs', '/**\n * pdfjsVersion = 7.1.2\n */\n// core-js polyfills of the legacy build\nexport {};\n');
    write(root, 'build/pdf.mjs.map', '{}');
    write(root, 'build/pdf.worker.mjs', 'worker');
    write(root, 'build/pdf.sandbox.mjs', 'sandbox');
    write(root, 'web/viewer.html', '<html></html>');
    write(root, 'web/viewer.mjs', VIEWER_SOURCE);
    write(root, 'web/viewer.css', 'css');
    write(root, 'web/debugger.mjs', 'debugger');
    write(root, 'web/compressed.tracemonkey-pldi-09.pdf', 'sample');
    write(root, 'web/images/a.svg', '<svg/>');
    write(root, 'web/cmaps/Adobe-Japan1-0.bcmap', 'cmap');
    write(root, 'web/iccs/CalRGB.icc', 'icc');
    write(root, 'web/wasm/openjpeg.wasm', 'wasm');
    write(root, 'web/standard_fonts/FoxitSerif.pfb', 'foxit');
    write(root, 'web/standard_fonts/LICENSE_FOXIT', 'bsd');
    for (const font of LIBERATION_FONTS as string[]) { write(root, `web/standard_fonts/${font}`, 'old 1.07 font'); }
    write(root, 'web/standard_fonts/LICENSE_LIBERATION', 'GPL');
    write(root, 'web/locale/locale.json', JSON.stringify({ de: 'de/viewer.ftl', 'en-us': 'en-US/viewer.ftl', fr: 'fr/viewer.ftl' }));
    write(root, 'web/locale/en-US/viewer.ftl', 'english');
    write(root, 'web/locale/de/viewer.ftl', 'deutsch');
    write(root, 'web/locale/fr/viewer.ftl', 'francais');
}

function makeLiberation(root: string): void {
    for (const font of LIBERATION_FONTS as string[]) { write(root, font, `new 2.1.5 ${font}`); }
    write(root, 'LICENSE', 'OFL');
    write(root, 'LiberationMono-Regular.ttf', 'not wanted');
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-pdfjs-'));
    releaseDir = path.join(work, 'pdfjs-7.1.2-dist');
    liberationDir = path.join(work, 'liberation-fonts-ttf-2.1.5');
    targetDir = path.join(work, 'viewer');
    makeRelease(releaseDir);
    makeLiberation(liberationDir);
    // The extension's own files live in the same folder and must survive; stale vendored files must not.
    write(targetDir, 'lpdf-host.mjs', 'ours');
    write(targetDir, 'README.md', 'ours too');
    write(targetDir, 'web/stale.txt', 'left over from the last version');
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('isKept', () => {
    it.each([
        'LICENSE', 'build/pdf.mjs', 'build/pdf.worker.mjs', 'web/viewer.html', 'web/viewer.mjs', 'web/viewer.css',
        'web/images/a.svg', 'web/cmaps/Adobe-Japan1-0.bcmap', 'web/iccs/CalRGB.icc', 'web/wasm/openjpeg.wasm',
        'web/standard_fonts/FoxitSerif.pfb', 'web/locale/locale.json', 'web/locale/en-US/viewer.ftl',
    ])('keeps %s', file => {
        expect(isKept(file)).toBe(true);
    });

    it.each([
        'build/pdf.mjs.map', 'build/pdf.sandbox.mjs', 'web/debugger.mjs', 'web/viewer.mjs.map',
        'web/compressed.tracemonkey-pldi-09.pdf', 'web/locale/de/viewer.ftl', 'web/locale/en-GB/viewer.ftl', 'README.md',
    ])('drops %s', file => {
        expect(isKept(file)).toBe(false);
    });

    it('keeps the languages it is given', () => {
        expect(isKept('web/locale/de/viewer.ftl', ['en-US', 'de'])).toBe(true);
    });
});

describe('trimLocaleIndex', () => {
    const index = JSON.stringify({ de: 'de/viewer.ftl', 'en-gb': 'en-GB/viewer.ftl', 'en-us': 'en-US/viewer.ftl' });

    it('keeps the entry of the kept language, under its own key', () => {
        expect(JSON.parse(trimLocaleIndex(index))).toEqual({ 'en-us': 'en-US/viewer.ftl' });
    });

    it('rejects an index with no entry for a kept language', () => {
        expect(() => trimLocaleIndex(JSON.stringify({ de: 'de/viewer.ftl' }))).toThrow(VendorError);
    });

    it('rejects an index that is not JSON', () => {
        expect(() => trimLocaleIndex('not json')).toThrow(VendorError);
    });
});

describe('readPdfjsVersion', () => {
    it('reads the version from the comment at the top of the build', () => {
        expect(readPdfjsVersion('/**\n * pdfjsVersion = 6.3.289\n */')).toBe('6.3.289');
    });

    it('reads the version of the build that ships in the viewer folder', () => {
        expect(readPdfjsVersion(fs.readFileSync(path.join(realViewerDir, 'build', 'pdf.mjs'), 'utf8'))).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('rejects a build that does not say', () => {
        expect(() => readPdfjsVersion('export {};')).toThrow(VendorError);
    });
});

describe('isLegacyBuild', () => {
    it('knows the legacy build by the core-js polyfills that it carries', () => {
        expect(isLegacyBuild('// `Promise.try` method\n// core-js\nexport {};')).toBe(true);
    });

    it('does not take the standard build, which has none, for it', () => {
        expect(isLegacyBuild('export {};')).toBe(false);
    });
});

describe('capViewerZoom', () => {
    it('lowers the constant and every place the bundler inlined it, to 1000%', () => {
        const capped = capViewerZoom(VIEWER_SOURCE);
        expect(capped).toContain('const MAX_SCALE = 10.0;');
        expect(capped.match(/\/\* inlined export \.MAX_SCALE \*\/10\)/g)).toHaveLength(2);
        expect(capped.split('\n').slice(1).join('\n')).not.toMatch(/MAX_SCALE[^\n]*25/);
    });

    it('leaves the rest of the viewer alone, such as the lowest zoom and the widest automatic one', () => {
        const capped = capViewerZoom(VIEWER_SOURCE);
        expect(capped).toContain('const MIN_SCALE = 0.1;');
        expect(capped).toContain('const MAX_AUTO_SCALE = 1.25;');
        expect(capped).toContain('/* inlined export .MIN_SCALE */0.1');
    });

    it('says at the top of the file that it was changed, as the Apache licence asks', () => {
        expect(capViewerZoom(VIEWER_SOURCE).split('\n')[0]).toMatch(/^\/\/ Changed by Lpdf: .*1000%/);
    });

    it('takes another zoom when given one', () => {
        expect(capViewerZoom(VIEWER_SOURCE, 8)).toContain('const MAX_SCALE = 8.0;');
    });

    it('refuses a viewer whose highest zoom is not 25 any more, so an upgrade is looked at', () => {
        expect(() => capViewerZoom(VIEWER_SOURCE.replace('25.0', '10.0'))).toThrow(VendorError);
        expect(() => capViewerZoom('viewer')).toThrow(/MAX_SCALE/);
    });

    it('refuses a viewer that no longer inlines the constant, so a leftover 2500% is not shipped', () => {
        expect(() => capViewerZoom('const MAX_SCALE = 25.0;\n')).toThrow(VendorError);
    });
});

describe('liberationVersionOf', () => {
    it.each([
        ['liberation-fonts-ttf-2.1.5', '2.1.5'],
        ['C:\\fonts\\liberation-fonts-ttf-2.1.5\\', '2.1.5'],
        ['/tmp/liberation-fonts-ttf-2.1.5/', '2.1.5'],
    ])('reads the version from %s', (folder, version) => {
        expect(liberationVersionOf(folder)).toBe(version);
    });

    it('says nothing when the folder name does not carry one', () => {
        expect(liberationVersionOf('fonts')).toBeUndefined();
    });
});

describe('vendor', () => {
    it('keeps what the extension uses and drops the rest of the release', () => {
        const result = vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        const files = listFiles(targetDir);
        expect(files).toContain('build/pdf.mjs');
        expect(files).toContain('web/cmaps/Adobe-Japan1-0.bcmap');
        expect(files).not.toContain('build/pdf.mjs.map');
        expect(files).not.toContain('build/pdf.sandbox.mjs');
        expect(files).not.toContain('web/debugger.mjs');
        expect(files).not.toContain('web/locale/de/viewer.ftl');
        expect(result).toMatchObject({ pdfjsVersion: '7.1.2', liberationVersion: '2.1.5', dropped: 6 });
    });

    it('writes the viewer with its highest zoom lowered, and records the change in the manifest', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        expect(fs.readFileSync(path.join(targetDir, 'web/viewer.mjs'), 'utf8')).toBe(capViewerZoom(VIEWER_SOURCE));
        const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'vendored.json'), 'utf8'));
        expect(Object.keys(manifest.changes)).toEqual(['web/viewer.mjs']);
    });

    it('refuses a viewer it cannot lower the zoom of, before it removes anything', () => {
        write(releaseDir, 'web/viewer.mjs', 'viewer');
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir, targetDir })).toThrow(/MAX_SCALE/);
        expect(fs.existsSync(path.join(targetDir, 'web/stale.txt'))).toBe(true);
    });

    it('keeps the English text of the viewer, and an index that lists only it', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        expect(fs.readFileSync(path.join(targetDir, 'web/locale/en-US/viewer.ftl'), 'utf8')).toBe('english');
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'web/locale/locale.json'), 'utf8'))).toEqual({ 'en-us': 'en-US/viewer.ftl' });
    });

    it('replaces the four Liberation Sans fonts and their licence with those of the Liberation release', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        for (const font of LIBERATION_FONTS as string[]) {
            expect(fs.readFileSync(path.join(targetDir, 'web/standard_fonts', font), 'utf8')).toBe(`new 2.1.5 ${font}`);
        }
        expect(fs.readFileSync(path.join(targetDir, 'web/standard_fonts/LICENSE_LIBERATION'), 'utf8')).toBe('OFL');
        expect(listFiles(path.join(targetDir, 'web/standard_fonts'))).not.toContain('LiberationMono-Regular.ttf');
    });

    it('leaves the extension\'s own files alone and removes what the last version left behind', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        expect(fs.readFileSync(path.join(targetDir, 'lpdf-host.mjs'), 'utf8')).toBe('ours');
        expect(fs.readFileSync(path.join(targetDir, 'README.md'), 'utf8')).toBe('ours too');
        expect(fs.existsSync(path.join(targetDir, 'web/stale.txt'))).toBe(false);
    });

    it('writes a manifest with both versions and a hash of every vendored file, but not of its own', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'vendored.json'), 'utf8'));
        expect(manifest.pdfjs.version).toBe('7.1.2');
        expect(manifest.liberation.version).toBe('2.1.5');
        expect(manifest.locales).toEqual(['en-US']);
        expect(Object.keys(manifest.files)).toContain('web/standard_fonts/LICENSE_LIBERATION');
        expect(Object.keys(manifest.files)).not.toContain('vendored.json');
        expect(Object.keys(manifest.files)).not.toContain('lpdf-host.mjs');
    });

    it('rejects the standard build of PDF.js, which fails in the browser of an older VS Code, and says which to use', () => {
        write(releaseDir, 'build/pdf.mjs', '/**\n * pdfjsVersion = 7.1.2\n */\nexport {};\n');
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir, targetDir })).toThrow(/pdfjs-7\.1\.2-legacy-dist\.zip/);
        expect(fs.existsSync(path.join(targetDir, 'web/stale.txt'))).toBe(true);
    });

    it('records in the manifest that the build is the legacy one', () => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'vendored.json'), 'utf8')).pdfjs.build).toBe('legacy');
    });

    it('takes the Liberation version from an option when the folder name does not say', () => {
        const unnamed = path.join(work, 'fonts');
        fs.renameSync(liberationDir, unnamed);
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir: unnamed, targetDir })).toThrow(/--liberation-version/);
        expect(vendor({ pdfjsDir: releaseDir, liberationDir: unnamed, liberationVersion: '2.2.0', targetDir }).liberationVersion).toBe('2.2.0');
    });

    it('rejects a missing folder, and a release without a file it needs, naming each', () => {
        expect(() => vendor({ pdfjsDir: undefined as unknown as string, liberationDir, targetDir })).toThrow(/--pdfjs/);
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir: path.join(work, 'nowhere'), targetDir })).toThrow(/--liberation/);
        fs.rmSync(path.join(releaseDir, 'web/viewer.mjs'));
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir, targetDir })).toThrow(/web\/viewer\.mjs/);
    });

    it('changes nothing in the target when the release is not usable', () => {
        fs.rmSync(path.join(releaseDir, 'web/viewer.mjs'));
        expect(() => vendor({ pdfjsDir: releaseDir, liberationDir, targetDir })).toThrow(VendorError);
        expect(fs.existsSync(path.join(targetDir, 'web/stale.txt'))).toBe(true);
    });
});

describe('checkVendored', () => {
    beforeEach(() => {
        vendor({ pdfjsDir: releaseDir, liberationDir, targetDir });
    });

    it('finds nothing wrong with the files just vendored', () => {
        expect(checkVendored(targetDir)).toEqual({ modified: [], missing: [], extra: [] });
    });

    it('names a vendored file that was edited', () => {
        fs.appendFileSync(path.join(targetDir, 'web/viewer.css'), '/* edited */');
        expect(checkVendored(targetDir).modified).toEqual(['web/viewer.css']);
    });

    it('names a vendored file that is gone', () => {
        fs.rmSync(path.join(targetDir, 'web/viewer.mjs'));
        expect(checkVendored(targetDir).missing).toEqual(['web/viewer.mjs']);
    });

    it('names a file that was added to a vendored folder', () => {
        write(targetDir, 'web/images/new.svg', '<svg/>');
        expect(checkVendored(targetDir).extra).toEqual(['web/images/new.svg']);
    });

    it('ignores the extension\'s own files', () => {
        write(targetDir, 'lpdf-new.mjs', 'ours');
        expect(checkVendored(targetDir)).toEqual({ modified: [], missing: [], extra: [] });
    });

    it('rejects a folder with no manifest', () => {
        fs.rmSync(path.join(targetDir, 'vendored.json'));
        expect(() => checkVendored(targetDir)).toThrow(VendorError);
    });
});

describe('the viewer folder that ships in the extension', () => {
    it('matches vendored.json, so a vendored file was not edited by hand', () => {
        expect(checkVendored(realViewerDir)).toEqual({ modified: [], missing: [], extra: [] });
    });

    it('runs on the legacy build of PDF.js, which has the polyfills that the browser of an older VS Code needs', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(realViewerDir, 'vendored.json'), 'utf8'));
        expect(manifest.pdfjs.build).toBe('legacy');
        for (const file of ['build/pdf.mjs', 'build/pdf.worker.mjs', 'web/viewer.mjs']) {
            expect(isLegacyBuild(fs.readFileSync(path.join(realViewerDir, file), 'utf8')), file).toBe(true);
        }
    });

    it('is claimed to run on VS Code 1.95 and later, the first with a Chromium that has the CSS round() of the viewer', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        const match = /^\^(\d+)\.(\d+)\.\d+$/.exec(packageJson.engines.vscode);
        expect(match).not.toBeNull();
        expect(Number(match?.[1]) * 1000 + Number(match?.[2])).toBeGreaterThanOrEqual(1 * 1000 + 95);
    });

    it('has its highest zoom at 1000%, the same as the zoom field, the diff view and the vendor script', () => {
        const viewer = fs.readFileSync(path.join(realViewerDir, 'web', 'viewer.mjs'), 'utf8');
        expect(viewer.split('\n')[0]).toMatch(/^\/\/ Changed by Lpdf: /);
        expect(viewer).toMatch(/^const MAX_SCALE = 10\.0;$/m);
        expect(viewer).not.toMatch(/inlined export \.MAX_SCALE \*\/(?!10\))/);
        expect(MAX_SCALE).toBe(10);
        const source = (file: string): string => fs.readFileSync(path.join(realViewerDir, file), 'utf8');
        expect(source('lpdf-diff-zoom.mjs')).toMatch(/const MAX_SCALE = 10;/);
        expect(source('lpdf-toolbar.mjs')).toMatch(/const MAX_ZOOM_PERCENT = 1000;/);
    });

    it('lists in THIRD_PARTY_LICENSES every folder of the viewer that carries a licence of its own', () => {
        const thirdParty = fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_LICENSES'), 'utf8');
        const folders = new Set(listFiles(realViewerDir)
            .filter(file => /^LICENSE/.test(path.basename(file)) && path.dirname(file) !== '.')
            .map(file => path.dirname(file)));
        expect([...folders].length).toBeGreaterThan(0);
        for (const folder of folders) {
            expect(thirdParty, `${folder}/ has a licence file but is not in THIRD_PARTY_LICENSES`).toContain(`\`${folder}/\``);
        }
    });

    it('credits PDF.js, with its licence, in the README and in THIRD_PARTY_LICENSES', () => {
        const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
        const thirdParty = fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_LICENSES'), 'utf8');
        expect(readme).toMatch(/PDF\.js[^\n]*Apache License 2\.0/);
        expect(readme).toContain('(THIRD_PARTY_LICENSES)');
        expect(thirdParty).toContain('Apache License, Version 2.0');
        expect(fs.existsSync(path.join(realViewerDir, 'LICENSE'))).toBe(true);
    });

    it('has only the English text of the viewer', () => {
        expect(fs.readdirSync(path.join(realViewerDir, 'web', 'locale')).sort()).toEqual(['en-US', 'locale.json']);
    });
});
