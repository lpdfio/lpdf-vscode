/**
 * Loads the PDF.js library that ships in this folder.
 *
 * Two pages of the extension use it: the full viewer (lpdf-host.mjs) and the diff view. The diff
 * view draws the pages itself with the library, and calls {@link loadPdfjsLibrary}. Having one copy
 * of PDF.js and one place that starts it is the point of this file.
 */

/**
 * Map.prototype.getOrInsertComputed is not in every Electron yet, and PDF.js uses it in both the
 * page and the worker. The worker gets this function's source as a prefix, see {@link createWorkerUrl}.
 */
export function installMapPolyfill() {
    if (!Map.prototype.getOrInsertComputed) {
        Map.prototype.getOrInsertComputed = function (key, callbackfn) {
            if (!this.has(key)) { this.set(key, callbackfn(key)); }
            return this.get(key);
        };
    }
}

/**
 * A blob: URL for the PDF.js worker. VS Code webviews silently reject webview-resource URIs passed
 * to `new Worker()`, and PDF.js then falls back to running the worker on the page thread, which is
 * far too slow. Fetching the script and starting the worker from a blob: URL avoids that.
 * Falls back to the plain URI when the blob cannot be made. The CSP allows only blob: workers, so
 * the browser then refuses to start the worker, and PDF.js runs its worker code on the page
 * thread instead: it works, but a large PDF makes the page freeze while it loads.
 * @param {string} workerUri Where `pdf.worker.mjs` is served from.
 * @param {(message: string) => void} [onError] Told why the blob could not be made.
 * @returns {Promise<string>} The address to give PDF.js as its worker.
 */
export async function createWorkerUrl(workerUri, onError) {
    try {
        const response = await fetch(workerUri);
        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
        const source = await response.text();
        const script = `(${installMapPolyfill})();\n${source}`;
        return URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    } catch (error) {
        onError?.(`Could not load the PDF worker as a blob, using its URI instead: ${error.message}`);
        return workerUri;
    }
}

/** Where the files of the viewer folder are, from the address of that folder. */
export function viewerLocations(viewerRoot) {
    const root = viewerRoot.endsWith('/') ? viewerRoot : `${viewerRoot}/`;
    const webRoot = `${root}web/`;
    return {
        pdfjsUri: `${root}build/pdf.mjs`,
        workerUri: `${root}build/pdf.worker.mjs`,
        viewerUri: `${webRoot}viewer.mjs`,
        webRoot,
    };
}

/**
 * The options that tell PDF.js where its data files are: the CJK character maps, the colour
 * profiles, the standard fonts for the Helvetica, Times and Courier that a PDF may name without
 * embedding, and the WebAssembly decoders for JPEG 2000, JBIG2 and colour management. The full
 * viewer is given the same locations through its own options.
 *
 * The page fetches those files, not the worker (`useWorkerFetch: false`). The worker is a blob: worker,
 * and a request from it to a webview resource can wait for the webview's 30 second resource timeout
 * before it fails. That made the first page of a PDF that does not embed its fonts take 30 seconds.
 * @param {string} webRoot Address of the `web/` folder, ending in `/`.
 */
export function documentOptions(webRoot) {
    return {
        useWorkerFetch: false,
        cMapUrl: `${webRoot}cmaps/`,
        cMapPacked: true,
        iccUrl: `${webRoot}iccs/`,
        standardFontDataUrl: `${webRoot}standard_fonts/`,
        wasmUrl: `${webRoot}wasm/`,
    };
}

/**
 * Loads the library and gives it its worker.
 * @param {string} viewerRoot Address of the viewer folder.
 * @param {(message: string) => void} [onError] Told about a worker that could not be made a blob.
 * @returns The library, and the options to pass to every `getDocument` call.
 */
export async function loadPdfjsLibrary(viewerRoot, onError) {
    const { pdfjsUri, workerUri, webRoot } = viewerLocations(viewerRoot);
    installMapPolyfill();
    const pdfjsLib = await import(pdfjsUri);
    pdfjsLib.GlobalWorkerOptions.workerSrc = await createWorkerUrl(workerUri, onError);
    return { pdfjsLib, documentOptions: documentOptions(webRoot) };
}
