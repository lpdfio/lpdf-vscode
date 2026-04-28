/** Worker render timeout before the request is cancelled and the worker is respawned. */
export const RENDER_TIMEOUT_MS = 30_000;

/**
 * How many bytes from the start of a document are scanned when detecting an Lpdf root element.
 * Large enough to clear typical XML declarations, processing instructions, and doc-type preambles.
 * NOTE: the equivalent for the webview JS is `const STEP = 1.25` in media/preview.html.
 */
export const LPDF_HEAD_SCAN_BYTES = 512;
