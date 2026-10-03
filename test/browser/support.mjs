/**
 * What every browser suite in this folder shares: a headless Chromium of its own, the extension's
 * pages served the way a VS Code webview gets them (assets from another origin than the page, under
 * the page's own Content-Security-Policy), the fixture PDFs, and the PASS/FAIL report.
 *
 * The suites run the pages that `npm run build` leaves in dist/ against the files in media/, so build
 * first. They need a Chromium-based browser: Edge or Chrome, found on the usual paths, or the one named
 * by the BROWSER_EXE variable. MEDIA_DIR points them at another copy of media/, for trying a viewer
 * from somewhere else.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** The extension's folder. */
export const ROOT = path.resolve(here, '..', '..');

/** The extension's `media/`, or the copy that MEDIA_DIR names. */
export const MEDIA = path.resolve(process.env.MEDIA_DIR ?? path.join(ROOT, 'media'));

/** Where the suites leave their screenshots; not kept in git. */
export const OUT_DIR = path.join(here, '.out');

const FIXTURES = path.join(here, 'fixtures');
const MIME = {
    '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.html': 'text/html',
};

/** Thrown when no Chromium-based browser can be found. */
export class BrowserNotFoundError extends Error {
    constructor(tried) {
        super(`No browser found. Install Edge or Chrome, or set BROWSER_EXE to one. Looked at:\n  ${tried.join('\n  ')}`);
        this.name = 'BrowserNotFoundError';
    }
}

/** Thrown when the browser was started but did not answer. */
export class BrowserStartError extends Error {
    constructor(exe) {
        super(`The browser did not start: ${exe}`);
        this.name = 'BrowserStartError';
    }
}

/** Thrown when `npm run build` has not been run, so a page builder is not in dist/. */
export class BuildMissingError extends Error {
    constructor(file) {
        super(`${file} is missing: run npm run build first`);
        this.name = 'BuildMissingError';
    }
}

/** Waits for a time. */
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The browser to use: BROWSER_EXE, else the first of the usual places that has one.
 * @returns {string} Its path.
 * @throws {BrowserNotFoundError} When there is none.
 */
export function findBrowser() {
    if (process.env.BROWSER_EXE) { return process.env.BROWSER_EXE; }
    const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const candidates = {
        win32: programFiles.flatMap(base => [
            path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ]),
        darwin: [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ],
    }[process.platform] ?? (process.env.PATH ?? '').split(path.delimiter).flatMap(folder => [
        'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge',
    ].map(name => path.join(folder, name)));
    const found = candidates.find(candidate => fs.existsSync(candidate));
    if (!found) { throw new BrowserNotFoundError(candidates); }
    return found;
}

/**
 * Starts a headless browser of its own and connects to it. Puppeteer's own launch fails while the
 * user's Edge is running, so this starts the process itself, on a debugging port the browser picks,
 * and reads the port from the profile folder. Closing the browser it returns also stops the process.
 * @returns {Promise<import('puppeteer-core').Browser>}
 * @throws {BrowserNotFoundError | BrowserStartError}
 */
export async function launchBrowser() {
    const exe = findBrowser();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-browser-'));
    const child = spawn(exe, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
        `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: 'ignore', detached: process.platform !== 'win32' });
    // However the suite ends (a failed check, an exception, Ctrl+C, the runner's timeout), the browser
    // goes with it: a browser left running outlives the run, and on Windows it keeps its windows.
    const stop = () => stopProcessTree(child);
    process.once('exit', stop);
    for (const signal of ['SIGINT', 'SIGTERM']) { process.once(signal, () => process.exit(1)); }
    const portFile = path.join(profile, 'DevToolsActivePort');
    let browser;
    for (let attempt = 0; attempt < 120 && !browser; attempt++) {
        await wait(250);
        if (!fs.existsSync(portFile)) { continue; }
        const [port, endpoint] = fs.readFileSync(portFile, 'utf8').split('\n');
        try {
            browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${endpoint}`, defaultViewport: null });
        } catch { /* not answering yet */ }
    }
    if (!browser) {
        stop();
        throw new BrowserStartError(exe);
    }
    console.log(`browser: ${await browser.version()}`);
    const close = browser.close.bind(browser);
    browser.close = async () => {
        try { await close(); } catch { /* already gone */ }
        stop();
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still in use */ }
    };
    return browser;
}

/**
 * Stops a process and everything it started. A browser is a tree of processes, and ending only the
 * first leaves the rest running.
 * @param {import('node:child_process').ChildProcess} child
 */
function stopProcessTree(child) {
    if (!child.pid) { return; }
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            process.kill(-child.pid, 'SIGKILL');
        }
    } catch { /* already gone */ }
}

/**
 * Serves something on a port of its own, on this machine only.
 * @param {http.RequestListener} handler
 * @returns {Promise<{ s: http.Server, server: http.Server, port: number, close: () => void }>}
 */
export function listen(handler) {
    return new Promise(resolve => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ s: server, server, port: server.address().port, close: () => server.close() }));
    });
}

/** The files of media/, from another origin than the page, as a webview's assets are. */
function serveMedia() {
    return listen((request, response) => {
        const file = path.join(MEDIA, decodeURIComponent(new URL(request.url, 'http://x').pathname));
        if (!file.startsWith(MEDIA) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            response.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
            response.end();
            return;
        }
        response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
        fs.createReadStream(file).pipe(response);
    });
}

/** A page builder of the extension, from dist/. */
function builder(file, name) {
    const built = path.join(ROOT, 'dist', file);
    if (!fs.existsSync(built)) { throw new BuildMissingError(`dist/${file}`); }
    return require(built)[name];
}

/**
 * The base64 of a fixture PDF, as the extension sends it to a page.
 * @param {string} name A file in test/browser/fixtures/, such as `bench_m.pdf`.
 * @returns {string}
 */
export function fixturePdf(name) {
    return fs.readFileSync(path.join(FIXTURES, name)).toString('base64');
}

/**
 * The path of a screenshot; makes the folder.
 * @param {string} name Its file name.
 * @returns {string}
 */
export function shotPath(name) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    return path.join(OUT_DIR, name);
}

/**
 * What a suite runs in: the browser, the media server, and the two pages.
 * @returns {Promise<{
 *   browser: import('puppeteer-core').Browser,
 *   origin: string,
 *   viewerHtml: string,
 *   diffHtml: string,
 *   serve: (html: string | (() => string)) => Promise<{ s: http.Server, server: http.Server, port: number, close: () => void }>,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startEnvironment() {
    const buildViewerHtml = builder('viewer-html.js', 'buildViewerHtml');
    const buildLibraryPageHtml = builder('library-page-html.js', 'buildLibraryPageHtml');
    const media = await serveMedia();
    const origin = `http://127.0.0.1:${media.port}`;
    const common = { viewerRoot: `${origin}/viewer/`, cspSource: origin, nonce: 'n' };
    const viewerHtml = buildViewerHtml({ viewerHtml: fs.readFileSync(path.join(MEDIA, 'viewer', 'web', 'viewer.html'), 'utf8'), ...common });
    const diffHtml = buildLibraryPageHtml({ pageHtml: fs.readFileSync(path.join(MEDIA, 'pdf-diff.html'), 'utf8'), ...common });
    const servers = [media];
    const browser = await launchBrowser();
    return {
        browser,
        origin,
        viewerHtml,
        diffHtml,
        async serve(html) {
            const server = await listen((request, response) => {
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end(typeof html === 'function' ? html() : html);
            });
            servers.push(server);
            return server;
        },
        async close() {
            await browser.close();
            for (const server of servers) { server.close(); }
        },
    };
}

/**
 * The PASS/FAIL report of a suite. `finish` prints the total and makes the process end with a
 * failure code if any check failed, which is what the runner looks at.
 * @returns {{ check: (name: string, ok: boolean, detail?: string) => boolean, finish: () => void, failures: () => number }}
 */
export function createChecker() {
    const results = [];
    return {
        check(name, ok, detail = '') {
            results.push(Boolean(ok));
            console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
            return Boolean(ok);
        },
        failures: () => results.filter(ok => !ok).length,
        finish() {
            const failed = results.filter(ok => !ok).length;
            console.log(`\n${results.length - failed}/${results.length} passed`);
            if (failed > 0) { process.exitCode = 1; }
        },
    };
}
