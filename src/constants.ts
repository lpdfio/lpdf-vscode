/** Worker render timeout before the request is cancelled and the worker is respawned. */
export const RENDER_TIMEOUT_MS = 30_000;

/**
 * How many characters from the start of a document are scanned when detecting an Lpdf root element.
 * Large enough to clear an XML declaration, processing instructions, a DOCTYPE, and a license or
 * header comment above the root.
 */
export const LPDF_HEAD_SCAN_BYTES = 4096;
