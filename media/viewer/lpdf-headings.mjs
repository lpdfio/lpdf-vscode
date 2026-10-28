/**
 * The preview of a `.md` file follows its editor, and the editor follows the preview. The headings of a
 * Markdown file are bookmarks, so the PDF has an outline with the place of each one; they are where the two
 * agree, and between two of them the view is taken to be the same fraction of the way along. This module
 * reads the outline, says where the view is, and scrolls to a place the extension host names; the host pairs
 * the headings with the lines of the file.
 *
 * A place in the PDF is a number: the entry of the outline whose section the top of the view is in, and how far
 * through that section it is, as a fraction. So 2.5 is half way through the section of entry 2, -1 is the top of
 * the document, and the number of entries is its end. The top of the view is a reading line, HEADING_MARGIN
 * below its edge, which is where a heading comes to rest when the view is scrolled to it.
 *
 * Messages to the extension host, while following:
 *   outline   { titles }   the titles of the outline's entries, in order
 *   position  { at }       the place at the top of the view, while the author scrolls it
 * Messages from the extension host:
 *   scrollToPosition { position }   scroll to a place in the PDF
 *
 * What this relies on in the stock viewer, besides what lpdf-host.mjs lists: `pdfViewer.container`
 * (the element that scrolls), `pdfViewer.currentScale`, `pdfViewer.getPageView(i)` with its `div` and
 * `viewport`, the `pagesinit` and `updateviewarea` events, and `pdfDocument.getOutline()`,
 * `getDestination()` and `getPageIndex()`.
 */

/** How far below the top edge of the view a heading rests once the view has scrolled to it, in pixels. */
export const HEADING_MARGIN = 16;

/** The input to the page after which a scroll is the author's. */
const USER_INPUT = ['wheel', 'pointerdown', 'keydown', 'touchstart'];

/** At most this often, in milliseconds, the place of a scrolling view is reported. */
const REPORT_INTERVAL_MS = 40;

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
 * The reading lines at which the sections of the document begin, in the order of the places: the top of the
 * document, each entry, and the end of the document. Where the view cannot scroll far enough for a heading
 * to reach the reading line, as with the last headings of a document, it stands at the end.
 * @param {number[]} tops The reading line at which each entry's heading rests, in the order of the outline.
 * @param {number} start The reading line when the view is at the top of the document.
 * @param {number} end The reading line when the view is at the end of the document.
 * @returns {number[]} The entries' count plus two numbers that do not decrease; the one at index `k` begins position `k - 1`.
 */
export function stopsOf(tops, start, end) {
    let previous = start;
    const inRange = tops.map(top => {
        previous = Math.max(previous, Math.min(top, end));
        return previous;
    });
    return [start, ...inRange, Math.max(end, previous)];
}

/**
 * The place a reading line is at.
 * @param {number[]} stops From {@link stopsOf}.
 * @param {number} line A reading line.
 * @returns {number} A place, from -1 for the top of the document to the number of entries for its end.
 */
export function positionAt(stops, line) {
    let low = 0;
    let high = stops.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (stops[middle] <= line) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    if (found < 0) { return -1; }
    if (found === stops.length - 1) { return found - 1; }
    // `found` is the last stop at or above the line, so the next is past it and the span is above 0.
    return found - 1 + (line - stops[found]) / (stops[found + 1] - stops[found]);
}

/**
 * The reading line a place is at; the other way of {@link positionAt}.
 * @param {number[]} stops From {@link stopsOf}.
 * @param {number} position A place; one beyond the top or the end of the document is taken to be the top or the end.
 * @returns {number}
 */
export function readingLineAt(stops, position) {
    const last = stops.length - 1;
    const clamped = Math.min(Math.max(position, -1), last - 1);
    const section = Math.min(Math.floor(clamped) + 1, last - 1);
    return stops[section] + (clamped + 1 - section) * (stops[section + 1] - stops[section]);
}

/**
 * Follows the headings of the PDF the viewer shows, when the extension host asks it to.
 * @param {object} app The viewer application.
 * @param {(message: object) => void} post Sends a message to the extension host.
 * @returns {{ follow: () => Promise<void>, stop: () => void, scrollTo: (position: number) => void }}
 *   `follow` starts on the document that has just opened, and reports its outline; `stop` ends it;
 *   `scrollTo` moves the view to a place in the document.
 */
export function createHeadingFollower(app, post) {
    let following = false;
    let entries = [];
    /** Whether the author has used the page since the view was last moved by the host or a document opened. */
    let armed = false;
    let scale;
    /** The place last reported to the host, so that a view that has not moved says nothing. */
    let reported = Number.NaN;
    let reportTimer;
    let stopsKey;
    let stops;

    const container = () => app.pdfViewer.container;
    const topOf = index => {
        const view = app.pdfViewer.getPageView(entries[index].pageIndex);
        return view ? placeTop(container(), view, entries[index].y) : 0;
    };
    /** The stops of the document as it is laid out now, worked out again only when its size or zoom changes. */
    const currentStops = () => {
        const element = container();
        const key = [app.pdfViewer.currentScale, element.scrollHeight, element.clientHeight].join('|');
        if (key !== stopsKey) {
            stopsKey = key;
            stops = stopsOf(entries.map((_, index) => topOf(index)), HEADING_MARGIN, element.scrollHeight - element.clientHeight + HEADING_MARGIN);
        }
        return stops;
    };
    const position = () => positionAt(currentStops(), container().scrollTop + HEADING_MARGIN);

    // The view is reported after a pause, and what it is then, so that a scroll is a stream of places and not one
    // message for every frame of it. The author may have stopped, or the host moved the view, by then.
    const report = () => {
        reportTimer = undefined;
        if (!following || !armed) { return; }
        const at = position();
        if (at === reported) { return; }
        reported = at;
        post({ type: 'position', at });
    };

    // A scroll the author makes follows an input to the page. A scroll the host asks for, or the viewer
    // makes by itself (opening a document, fitting the zoom), is not reported. Ctrl and the wheel is a zoom,
    // which is not a scroll either.
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
        if (armed && reportTimer === undefined) { reportTimer = setTimeout(report, REPORT_INTERVAL_MS); }
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
            stopsKey = undefined;
            entries = await readOutline(app.pdfDocument);
            await pagesReady();
            scale = app.pdfViewer.currentScale;
            reported = Number.NaN;
            following = true;
            post({ type: 'outline', titles: entries.map(entry => entry.title) });
        },
        stop() {
            following = false;
            entries = [];
            clearTimeout(reportTimer);
            reportTimer = undefined;
        },
        scrollTo(place) {
            // A page that is not shown, a preview in a tab behind another, has no layout to measure; scrolling it would reset it.
            if (!following || !Number.isFinite(place) || container().clientHeight === 0) { return; }
            armed = false;
            reported = Number.NaN;
            container().scrollTop = readingLineAt(currentStops(), place) - HEADING_MARGIN;
        },
    };
}
