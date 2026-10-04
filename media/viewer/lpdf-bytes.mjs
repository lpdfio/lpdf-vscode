/**
 * PDF bytes to and from base64, which is how a PDF travels between the extension host and the
 * viewer page: VS Code's webview messages carry text, not binary.
 */

/** How many bytes go into one `String.fromCharCode` call: well under the engines' argument limits. */
const CHUNK_SIZE = 0x8000;

/**
 * Decodes base64 into bytes.
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) { bytes[index] = binary.charCodeAt(index); }
    return bytes;
}

/**
 * Encodes bytes as base64, a chunk at a time, so a large PDF does not overflow the call stack.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
    let binary = '';
    for (let start = 0; start < bytes.length; start += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.subarray(start, start + CHUNK_SIZE));
    }
    return btoa(binary);
}
