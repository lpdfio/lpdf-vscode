/**
 * The preview of a `.md` file follows its editor, and the editor follows the preview, by heading. The
 * headings of a Markdown file are bookmarks, so the PDF has an outline with the place of each one. This
 * module reads that outline, finds the heading at the top of the view, and scrolls to a heading the
 * extension host names; the host pairs the headings with the lines of the file.
 *
 * Messages to the extension host, while following:
 *   outline     { titles, top }       the titles of the outline's entries, in order, and the entry at the top of the view
 *   topHeading  { index, byUser }     the entry at the top of the view changed; `byUser` is false when the author did not scroll
 * Messages from the extension host:
 *   scrollToHeading { index }         scroll to the entry `index` of the outline, or to the top of the document for -1
 *
 * What this relies on in the stock viewer, besides what lpdf-host.mjs lists: `pdfViewer.container`
 * (the element that scrolls), `pdfViewer.getPageView(i)` with its `div` and `viewport`, the
 * `pagesinit` and `updateviewarea` events, and `pdfDocument.getOutline()`, `getDestination()` and
 * `getPageIndex()`.
 */

/** How far below the top edge of the view a heading rests once the view has scrolled to it, in pixels. */
export const HEADING_MARGIN = 16;

/**
 * How far a heading may be below its resting place and still count as the one at the top, in pixels. The
 * scroll position is rounded to a whole pixel, and a heading scrolled to has to count as reached.
 */
const REACHED_SLACK = 2;

/** The input to the page after which a scroll is the author's. */
const USER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'];

/**
 * Where a destination of the outline puts the top of the view, as a distance down from the top of its page.
 * @param {string | undefined} kind The destination's kind: `XYZ`, `FitH`, `FitR`...
 * @param {unknown[]} args What follows the kind in the destination.
 * @returns {number | null} The distance in PDF units, measured up from the page's bottom edge as PDF does; null for the top of the page.
 */
export function destinationTop(kind, args) {
    const top = { XYZ: args[1], FitH: args[0], FitBH: args[0], FitR: args[3] }[kind];
    return typeof top === 'number' ? top : null;
}

/**
 * Reads the outline of a PDF as one list in document order, a nested entry after the entry it is under. An
 * entry that does not lead to a place in the document stands where the one before it does.
 * @param {{ getOutline: () => Promise<object[] | null>, getDestination: (name: string) => Promise<unknown[] | null>, getPageIndex: (ref: object) => Promise<number> }} pdfDocument
 * @returns {Promise<{ title: string, pageIndex: number, y: number | null }[]>} Each entry's title, its page counting from 0, and its place on the page (see {@link destinationTop}).
 */
export async function readOutline(pdfDocument) {
    const entries = [];
    const add = async items => {
        for (const item of items) {
            const previous = entries[entries.length - 1] ?? { pageIndex: 0, y: null };
            const place = await placeOf(pdfDocument, item) ?? { pageIndex: previous.pageIndex, y: previous.y };
            entries.push({ title: item.title, ...place });
            await add(item.items ?? []);
        }
    };
    await add(await pdfDocument.getOutline() ?? []);
    return entries;
}

/** The page and the place on it that an outline item leads to, or undefined when it leads nowhere in the document. */
async function placeOf(pdfDocument, item) {
    try {
        const destination = typeof item.dest === 'string' ? await pdfDocument.getDestination(item.dest) : item.dest;
        if (!Array.isArray(destination)) { return undefined; }
        const [page, kind, ...args] = destination;
        const pageIndex = Number.isInteger(page) ? page : await pdfDocument.getPageIndex(page);
        return { pageIndex, y: destinationTop(kind?.name, args) };
    } catch {
        // An entry whose destination is missing or points at no page leads nowhere.
        return undefined;
    }
}

/**
 * The scroll position at which a place of the document is at the top of the scrolling element.
 * @param {HTMLElement} container The element that scrolls.
 * @param {{ div: HTMLElement, viewport: { convertToViewportPoint: (x: number, y: number) => number[] } }} pageView The viewer's view of the page.
 * @param {number | null} y The place on the page, as {@link readOutline} gives it; null for the top of the page.
 * @returns {number} Pixels from the top of the scrolled content.
 */
export function placeTop(container, pageView, y) {
    let top = 0;
    // A page sits in the viewer, or in a spread of it, and offsetTop counts from the nearest positioned ancestor.
    for (let node = pageView.div; node && node !== container; node = node.offsetParent) {
        top += node.offsetTop + node.clientTop;
    }
    return y === null ? top : top + pageView.viewport.convertToViewportPoint(0, y)[1];
}

/**
 * The entry at the top of the view: the last whose heading has reached it.
 * @param {number} count How many entries there are.
 * @param {(index: number) => number} topOf The scroll position at which an entry rests at the top of the view, which does not decrease with the index.
 * @param {number} scrollTop How far the view has scrolled.
 * @returns {number} The entry, or -1 while the view is above the first.
 */
export function entryAtTop(count, topOf, scrollTop) {
    const reading = scrollTop + HEADING_MARGIN + REACHED_SLACK;
    let low = 0;
    let high = count - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (topOf(middle) <= reading) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
}

/**
 * The scroll position that puts an entry's heading at its resting place.
 * @param {number} top Where the entry is, as {@link placeTop} gives it.
 * @returns {number}
 */
export function scrollPositionFor(top) {
    return Math.max(0, top - HEADING_MARGIN);
}

/**
 * Follows the headings of the PDF the viewer shows, when the extension host asks it to.
 * @param {object} app The viewer application.
 * @param {(message: object) => void} post Sends a message to the extension host.
 * @returns {{ follow: () => Promise<void>, stop: () => void, scrollTo: (index: number) => void }}
 *   `follow` starts on the document that has just opened, and reports its outline; `stop` ends it;
 *   `scrollTo` moves the view to an entry, or to the top for -1.
 */
export function createHeadingFollower(app, post) {
    let following = false;
    let entries = [];
    /** The entry at the top of the view as the extension host last heard it. */
    let reported = -1;
    /** Whether the author has used the page since the view was last moved by the host or a document opened. */
    let armed = false;
    let scale;

    const container = () => app.pdfViewer.container;
    const topOf = index => {
        const view = app.pdfViewer.getPageView(entries[index].pageIndex);
        return view ? placeTop(container(), view, entries[index].y) : 0;
    };
    const current = () => entryAtTop(entries.length, topOf, container().scrollTop);

    // A scroll the author makes follows an input to the page. A scroll the host asks for, or the viewer
    // makes by itself (opening a document, fitting the zoom), is not reported as the author's. Ctrl and the
    // wheel is a zoom, which is not a scroll either.
    const onInput = event => {
        if (!(event.type === 'wheel' && (event.ctrlKey || event.metaKey))) { armed = true; }
    };
    for (const type of USER_INPUT) {
        window.addEventListener(type, onInput, { capture: true, passive: true });
    }

    app.eventBus.on('updateviewarea', ({ location }) => {
        if (!following) { return; }
        if (location.scale !== scale) {
            // A zoom lays the pages out again, and the view settles over the events that follow it.
            scale = location.scale;
            armed = false;
        }
        const index = current();
        if (index === reported) { return; }
        reported = index;
        post({ type: 'topHeading', index, byUser: armed });
    });

    /** Resolves once the viewer has made its page views, which the places of the entries are measured on. */
    function pagesReady() {
        if (app.pdfViewer.getPageView(0)) { return Promise.resolve(); }
        return new Promise(resolve => app.eventBus.on('pagesinit', resolve, { once: true }));
    }

    return {
        async follow() {
            following = false;
            armed = false;
            entries = await readOutline(app.pdfDocument);
            await pagesReady();
            scale = app.pdfViewer.currentScale;
            reported = current();
            following = true;
            post({ type: 'outline', titles: entries.map(entry => entry.title), top: reported });
        },
        stop() {
            following = false;
            entries = [];
        },
        scrollTo(index) {
            // A page that is not shown, a preview in a tab behind another, has no layout to measure; scrolling it would reset it.
            if (!following || index >= entries.length || container().clientHeight === 0) { return; }
            armed = false;
            reported = index;
            container().scrollTop = index < 0 ? 0 : scrollPositionFor(topOf(index));
        },
    };
}
