/** What {@link buildPdfjsCsp} needs to know about the webview. */
export interface PdfjsCspOptions {
    /** `webview.cspSource`. */
    cspSource: string;
    /** Per-page nonce for the scripts the page runs. */
    nonce: string;
}

/**
 * The Content-Security-Policy of every page that runs PDF.js: the full viewer and the diff view. Scripts come only from the webview and the page's own nonce, with WebAssembly
 * allowed for the image decoders; the worker is started from a blob: URL; the viewer's own styles
 * are inline; images, fonts and fetches may be the webview's own files, blobs and data URIs.
 * @param options The webview's CSP source and the page nonce.
 * @returns The policy, for a `<meta http-equiv="Content-Security-Policy">` tag.
 */
export function buildPdfjsCsp(options: PdfjsCspOptions): string {
    return [
        `default-src 'none'`,
        `script-src ${options.cspSource} 'nonce-${options.nonce}' 'wasm-unsafe-eval'`,
        `worker-src blob:`,
        `style-src ${options.cspSource} 'unsafe-inline'`,
        `img-src ${options.cspSource} blob: data:`,
        `font-src ${options.cspSource} data:`,
        `connect-src ${options.cspSource} blob: data:`,
        `base-uri 'none'`,
        `form-action 'none'`,
    ].join('; ');
}
