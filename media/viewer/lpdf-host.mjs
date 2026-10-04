/**
 * Glue between the stock PDF.js viewer and the Lpdf extension host.
 *
 * The webview page built by viewer-html.ts loads this module. It sets the viewer up as a read-only
 * PDF viewer, then shows each PDF the extension host posts.
 *
 * Messages from the extension host:
 *   showLoading                           a render has started
 *   updatePdf  { pdfBase64, filename, zoom? }   show this PDF; `zoom` is only present for a file
 *                                         that was not showing before, which starts at the top
 *   showError  { message }                the render failed
 *
 * Messages to the extension host:
 *   ready                                 messages can now be received
 *   download   { pdfBase64, filename }    the user asked to save the PDF, with any form input in it
 *   log        { level, message }         written to the extension's output
 *
 * What this relies on in the stock viewer. These are internals of PDF.js's `web/viewer.mjs`, not a
 * published interface, so each one is a place to look when the viewer is upgraded (see README.md
 * in this folder):
 *   - the `webviewerloaded` event, and `PDFViewerApplicationOptions` for the options set below
 *   - `PDFViewerApplication`: `initializedPromise`, `eventBus`, `open({ data, filename })`,
 *     `initialBookmark`, `pdfDocument`, `pdfViewer`
 *   - the `updateviewarea` event and its `location.pdfOpenParams`, to return to a place after a re-render
 *   - the methods replaced below: `rotatePages`, `requestPresentationMode`, `downloadManager.download`
 * The toolbar's own dependencies are listed in lpdf-toolbar.mjs.
 */

import { base64ToBytes, bytesToBase64 } from './lpdf-bytes.mjs';
import { arrangeToolbar, connectToolbar } from './lpdf-toolbar.mjs';
import { createWorkerUrl, installMapPolyfill } from './lpdf-pdfjs.mjs';

const vscodeApi = acquireVsCodeApi();
const config = JSON.parse(document.getElementById('lpdf-viewer-config').textContent);

/** The viewer's sidebar-view code for a closed sidebar. */
const SIDEBAR_NONE = 0;

/** The viewer's editor-mode code that switches annotation editing off. */
const ANNOTATION_EDITING_DISABLED = -1;

/** The viewer's `viewOnLoad` code that ignores any remembered position for a document. */
const VIEW_ON_LOAD_INITIAL = 1;

const statusElement = document.getElementById('lpdf-status');

/** Where the user was in the document, as the viewer reports it; used to return there after a re-render. */
let lastLocation;

/** The PDF being shown, as the extension host sent it: base64 and the file name. */
let current;

/** Serializes incoming PDFs: the viewer cannot open one while another is still opening. */
let pending = Promise.resolve();

function log(level, message) {
    vscodeApi.postMessage({ type: 'log', level, message });
}

/**
 * Follows VS Code's light or dark theme. The viewer's own colours are written for either scheme
 * and switch on `color-scheme`, which a webview does not set from the editor theme.
 */
function followEditorTheme() {
    const apply = () => {
        const isLight = document.body.classList.contains('vscode-light')
            || document.body.classList.contains('vscode-high-contrast-light');
        document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
    };
    apply();
    new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

function showStatus(text, isError) {
    statusElement.textContent = text;
    statusElement.classList.toggle('error', isError);
    statusElement.hidden = false;
}

function hideStatus() {
    statusElement.hidden = true;
}

/**
 * Calls `configure` with the viewer's options just before the viewer starts.
 *
 * The viewer starts itself the moment its module loads and reads most options straight away, so
 * they cannot be set after the import. It announces the start with a `webviewerloaded` event, on
 * the embedding page when that page is reachable and on its own document when it is not; this
 * listens in both places.
 */
function configureOnViewerLoad(configure) {
    const targets = [document];
    try {
        if (window.parent !== window) { targets.push(window.parent.document); }
    } catch {
        // A parent from another origin cannot be reached, and the viewer then uses this document.
    }
    const listener = () => {
        for (const target of targets) { target.removeEventListener('webviewerloaded', listener); }
        configure(window.PDFViewerApplicationOptions);
    };
    for (const target of targets) { target.addEventListener('webviewerloaded', listener); }
}

/**
 * Loads PDF.js and the viewer, and configures the viewer as a read-only PDF viewer.
 * @returns The viewer application.
 */
async function startViewer() {
    installMapPolyfill();
    followEditorTheme();
    arrangeToolbar();
    const workerSrc = await createWorkerUrl(config.workerUri, message => log('error', message));

    configureOnViewerLoad(options => options.setAll({
        // Nothing opens by itself: the extension host sends the PDF.
        defaultUrl: '',
        workerSrc,
        cMapUrl: `${config.webRoot}cmaps/`,
        iccUrl: `${config.webRoot}iccs/`,
        standardFontDataUrl: `${config.webRoot}standard_fonts/`,
        wasmUrl: `${config.webRoot}wasm/`,
        imageResourcesPath: `${config.webRoot}images/`,
        // A viewer, not an editor: no highlight, text, drawing or image tools.
        annotationEditorMode: ANNOTATION_EDITING_DISABLED,
        enableScripting: false,
        // Each render is a new document; an old position must not be restored for it.
        viewOnLoad: VIEW_ON_LOAD_INITIAL,
        disableHistory: true,
        sidebarViewOnLoad: SIDEBAR_NONE,
        defaultZoomValue: 'page-width',
    }));

    // The viewer reads the PDF.js library from globalThis.pdfjsLib, so the library loads first.
    await import(config.pdfjsUri);
    const { PDFViewerApplication: app } = await import(config.viewerUri);
    await app.initializedPromise;
    connectToolbar(app, window.PDFViewerApplicationOptions);
    app.eventBus.on('updateviewarea', ({ location }) => { lastLocation = location; });
    // The rotate buttons are hidden; this also stops the R and Shift+R keys.
    app.rotatePages = () => {};
    // There is no presentation mode here; this stops Ctrl+Alt+P, which the viewer would still act on.
    app.requestPresentationMode = () => {};
    // Saving goes through the extension host's save dialog, not a browser download. The viewer passes
    // the bytes to save: the PDF as it was opened, or, once a form field has been filled in, a copy
    // with the values in it. Sending the bytes it was opened with instead would lose what was typed.
    app.downloadManager.download = data => {
        if (!current) { return; }
        const pdfBase64 = data instanceof Uint8Array ? bytesToBase64(data) : current.pdfBase64;
        vscodeApi.postMessage({ type: 'download', pdfBase64, filename: current.filename });
    };
    return app;
}

/**
 * Shows a PDF. One that replaces the file already showing opens at the same place and zoom.
 * @param app The viewer application.
 * @param message The updatePdf message.
 */
async function showPdf(app, message) {
    const isNewFile = message.zoom !== undefined;
    current = { pdfBase64: message.pdfBase64, filename: message.filename };
    // The viewer opens a document at this bookmark, in the form it writes into its own links.
    app.initialBookmark = isNewFile || !lastLocation ? null : lastLocation.pdfOpenParams.substring(1);
    // The open arguments go to PDF.js's getDocument as they are; see documentOptions for why the page fetches its data files.
    await app.open({ data: base64ToBytes(message.pdfBase64), filename: message.filename, useWorkerFetch: false });
    hideStatus();
}

try {
    const app = await startViewer();
    window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'showLoading') {
            // A document that is already showing stays in view while the next one renders.
            if (!app.pdfDocument) { showStatus('Rendering…', false); }
        } else if (message.type === 'updatePdf') {
            pending = pending.then(() => showPdf(app, message)).catch(error => {
                log('error', `Could not show the PDF: ${error.message}`);
                showStatus(`Error: ${error.message}`, true);
            });
        } else if (message.type === 'showError') {
            showStatus(`Error: ${message.message}`, true);
        }
    });
    vscodeApi.postMessage({ type: 'ready' });
} catch (error) {
    log('error', `The PDF viewer did not start: ${error.message}`);
    showStatus(`Error: the PDF viewer did not start (${error.message})`, true);
}
