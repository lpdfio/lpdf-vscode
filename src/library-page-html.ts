import { buildPdfjsCsp } from './pdfjs-csp';

/** Thrown when a page lacks a placeholder that {@link buildLibraryPageHtml} fills in. */
export class LibraryPageMarkupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LibraryPageMarkupError';
    }
}

/** What {@link buildLibraryPageHtml} needs to place a page that draws PDFs itself, with the PDF.js library, in a webview. */
export interface LibraryPageOptions {
    /** Contents of the page, `media/pdf-diff.html`. */
    pageHtml: string;
    /** Webview URI of `media/viewer/`. */
    viewerRoot: string;
    /** `webview.cspSource`. */
    cspSource: string;
    /** Per-page nonce for the scripts this page runs. */
    nonce: string;
}

/** The placeholders every such page must carry. */
const REQUIRED_PLACEHOLDERS = ['__CSP__', '__NONCE__', '__VIEWER_URI__'];

/** A URI that ends in `/`, so file names can be appended to it. */
function directoryUri(uri: string): string {
    return uri.endsWith('/') ? uri : `${uri}/`;
}

/** Text that is safe inside a double-quoted HTML attribute. */
function attributeValue(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Text that is safe inside a single-quoted JavaScript string in an inline `<script>`. */
function scriptString(text: string): string {
    return JSON.stringify(text).slice(1, -1).replace(/'/g, String.raw`\'`).replace(/</g, String.raw`\u003c`);
}

/**
 * Builds the webview page of the diff view, which draws each page of a PDF on a canvas with the
 * PDF.js library in `media/viewer/`, the same copy the full viewer runs on.
 *
 * The page carries `__CSP__` (in the attribute of its CSP tag), `__NONCE__` (in attributes and
 * strings) and `__VIEWER_URI__` (in the address of the loader and the argument it is called with,
 * both inside quotes). It may also carry `__VIEWER_HREF__`, the same address for an HTML attribute,
 * such as the link to the stylesheet that the viewer shares with the diff view.
 * @param options The page, where the viewer files are served from, and the webview's CSP source and nonce.
 * @returns The complete HTML document.
 * @throws {LibraryPageMarkupError} When the page lacks one of the placeholders.
 */
export function buildLibraryPageHtml(options: LibraryPageOptions): string {
    for (const placeholder of REQUIRED_PLACEHOLDERS) {
        if (!options.pageHtml.includes(placeholder)) {
            throw new LibraryPageMarkupError(`The page has no ${placeholder} placeholder`);
        }
    }
    const csp = buildPdfjsCsp({ cspSource: options.cspSource, nonce: options.nonce });
    return options.pageHtml
        .replace(/__CSP__/g, attributeValue(csp))
        .replace(/__NONCE__/g, attributeValue(options.nonce))
        .replace(/__VIEWER_URI__/g, scriptString(directoryUri(options.viewerRoot)))
        .replace(/__VIEWER_HREF__/g, attributeValue(directoryUri(options.viewerRoot)));
}
