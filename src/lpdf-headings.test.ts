import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createHeadingFollower, destinationTop, entryAtTop, HEADING_MARGIN, placeTop, readOutline, scrollPositionFor,
} from '../media/viewer/lpdf-headings.mjs';

describe('destinationTop', () => {
    it('is the top of the view a destination asks for', () => {
        expect(destinationTop('XYZ', [0, 787.5, 0])).toBe(787.5);
        expect(destinationTop('FitH', [500])).toBe(500);
        expect(destinationTop('FitBH', [500])).toBe(500);
        expect(destinationTop('FitR', [0, 100, 200, 600])).toBe(600);
    });

    it('is null, the top of the page, for a destination that fits the whole page or leaves the top as it is', () => {
        expect(destinationTop('Fit', [])).toBeNull();
        expect(destinationTop('XYZ', [null, null, null])).toBeNull();
        expect(destinationTop(undefined, [])).toBeNull();
    });
});

/** A PDF.js document with the outline given, whose page references are `{ num }` objects. */
function documentWith(outline: object[] | null, destinations: Record<string, unknown[]> = {}): object {
    return {
        getOutline: async () => outline,
        getDestination: async (name: string) => destinations[name] ?? null,
        getPageIndex: async (ref: { num: number }) => ref.num,
    };
}

describe('readOutline', () => {
    it('lists the entries in document order, a nested one after the one it is under', async () => {
        const doc = documentWith([
            { title: 'One', dest: 'a', items: [{ title: 'Two', dest: 'b', items: [{ title: 'Three', dest: 'c', items: [] }] }] },
            { title: 'Four', dest: 'd', items: [] },
        ], {
            a: [{ num: 0 }, { name: 'XYZ' }, 0, 700, 0],
            b: [{ num: 0 }, { name: 'XYZ' }, 0, 300, 0],
            c: [{ num: 1 }, { name: 'XYZ' }, 0, 800, 0],
            d: [{ num: 3 }, { name: 'XYZ' }, 0, 500, 0],
        });

        expect(await readOutline(doc)).toEqual([
            { title: 'One', pageIndex: 0, y: 700 },
            { title: 'Two', pageIndex: 0, y: 300 },
            { title: 'Three', pageIndex: 1, y: 800 },
            { title: 'Four', pageIndex: 3, y: 500 },
        ]);
    });

    it('reads a destination written out in the entry, with the page as a number or a reference', async () => {
        const doc = documentWith([
            { title: 'By number', dest: [2, { name: 'XYZ' }, 0, 400, 0], items: [] },
            { title: 'By reference', dest: [{ num: 4 }, { name: 'Fit' }], items: [] },
        ]);

        expect(await readOutline(doc)).toEqual([
            { title: 'By number', pageIndex: 2, y: 400 },
            { title: 'By reference', pageIndex: 4, y: null },
        ]);
    });

    it('puts an entry that leads nowhere where the one before it is', async () => {
        const doc = documentWith([
            { title: 'Placed', dest: 'a', items: [] },
            { title: 'Missing', dest: 'nothing', items: [] },
            { title: 'A link', url: 'https://example.com', items: [] },
        ], { a: [{ num: 1 }, { name: 'XYZ' }, 0, 600, 0] });

        expect(await readOutline(doc)).toEqual([
            { title: 'Placed', pageIndex: 1, y: 600 },
            { title: 'Missing', pageIndex: 1, y: 600 },
            { title: 'A link', pageIndex: 1, y: 600 },
        ]);
    });

    it('puts a first entry that leads nowhere at the top of the document', async () => {
        const doc = documentWith([{ title: 'Missing', dest: 'nothing', items: [] }]);
        expect(await readOutline(doc)).toEqual([{ title: 'Missing', pageIndex: 0, y: null }]);
    });

    it('is empty for a document with no outline', async () => {
        expect(await readOutline(documentWith(null))).toEqual([]);
    });
});

describe('placeTop', () => {
    const container = {};
    const viewport = { convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };

    it('is the top of the page, past its border, for the top of the page', () => {
        const div = { offsetTop: 1000, clientTop: 9, offsetParent: container };
        expect(placeTop(container, { div, viewport }, null)).toBe(1009);
    });

    it('adds the distance down the page that a place is at', () => {
        const div = { offsetTop: 1000, clientTop: 9, offsetParent: container };
        expect(placeTop(container, { div, viewport }, 700)).toBe(1109);
    });

    it('counts from the scrolling element when the page is in a spread of the viewer', () => {
        const spread = { offsetTop: 2000, clientTop: 0, offsetParent: container };
        const div = { offsetTop: 4, clientTop: 9, offsetParent: spread };
        expect(placeTop(container, { div, viewport }, 700)).toBe(2000 + 4 + 9 + 100);
    });
});

describe('entryAtTop', () => {
    const TOPS = [100, 500, 900];
    const topOf = (index: number): number => TOPS[index];

    it('is the last entry whose heading has reached the top of the view', () => {
        expect(entryAtTop(3, topOf, 0)).toBe(-1);
        expect(entryAtTop(3, topOf, 100)).toBe(0);
        expect(entryAtTop(3, topOf, 600)).toBe(1);
        expect(entryAtTop(3, topOf, 5000)).toBe(2);
    });

    it('counts a heading as reached when the view has scrolled to its resting place', () => {
        for (const top of TOPS) {
            expect(entryAtTop(3, topOf, scrollPositionFor(top))).toBe(TOPS.indexOf(top));
        }
    });

    it('does not count the next heading before the view reaches it', () => {
        expect(entryAtTop(3, topOf, scrollPositionFor(500) - 5)).toBe(0);
    });

    it('is -1 when there are no entries', () => {
        expect(entryAtTop(0, topOf, 1000)).toBe(-1);
    });
});

describe('scrollPositionFor', () => {
    it('leaves a margin above the heading, and not less than the top of the document', () => {
        expect(scrollPositionFor(500)).toBe(500 - HEADING_MARGIN);
        expect(scrollPositionFor(5)).toBe(0);
    });
});

/** A viewer with three pages of 1000px, an outline of three headings, and an event bus that the test fires. */
function fakeViewer(): { app: any; fire: (name: string, data?: object) => void; container: { scrollTop: number } } {
    const container = { scrollTop: 0 };
    const listeners: Record<string, Array<(data: object) => void>> = {};
    const views = [0, 1, 2].map(index => ({
        div: { offsetTop: index * 1000, clientTop: 9, offsetParent: container },
        viewport: { convertToViewportPoint: (x: number, y: number) => [x, 800 - y] },
    }));
    const app = {
        pdfViewer: { container, getPageView: (index: number) => views[index], currentScale: 1 },
        pdfDocument: documentWith([
            { title: 'One', dest: 'a', items: [{ title: 'Two', dest: 'b', items: [] }] },
            { title: 'Three', dest: 'c', items: [] },
        ], {
            a: [{ num: 0 }, { name: 'XYZ' }, 0, 780, 0],
            b: [{ num: 1 }, { name: 'XYZ' }, 0, 400, 0],
            c: [{ num: 2 }, { name: 'XYZ' }, 0, 700, 0],
        }),
        eventBus: {
            on: (name: string, listener: (data: object) => void) => { (listeners[name] ??= []).push(listener); },
        },
    };
    return { app, container, fire: (name, data = {}) => listeners[name]?.forEach(listener => listener(data)) };
}

// The tops of the entries, in the scroll positions of fakeViewer: 29, 1409 and 2109.
describe('createHeadingFollower', () => {
    let posts: any[];
    let viewer: ReturnType<typeof fakeViewer>;
    let window: EventTarget;

    beforeEach(() => {
        window = new EventTarget();
        vi.stubGlobal('window', window);
        posts = [];
        viewer = fakeViewer();
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    /** The viewer reporting that it was scrolled to `scrollTop`, as it does after any scroll. */
    const scrolled = (scrollTop: number, scale = 1): void => {
        viewer.container.scrollTop = scrollTop;
        viewer.fire('updateviewarea', { location: { scale } });
    };
    const follower = async (): Promise<ReturnType<typeof createHeadingFollower>> => {
        const result = createHeadingFollower(viewer.app, message => posts.push(message));
        await result.follow();
        return result;
    };

    it('reports the titles of the outline and the entry at the top of the view when it starts', async () => {
        await follower();
        expect(posts).toEqual([{ type: 'outline', titles: ['One', 'Two', 'Three'], top: -1 }]);
    });

    it('reports the entry the view starts at, when a document opens part way down', async () => {
        viewer.container.scrollTop = 1400;
        await follower();
        expect(posts).toEqual([{ type: 'outline', titles: ['One', 'Two', 'Three'], top: 1 }]);
    });

    it('reports a heading reached by a scroll the author made, as the author\'s', async () => {
        await follower();
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: true });
    });

    it('reports a heading reached with no input from the author as not the author\'s', async () => {
        await follower();
        scrolled(1400);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: false });
    });

    it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])('takes %s for the author using the page', async type => {
        await follower();
        window.dispatchEvent(new Event(type));
        scrolled(1400);
        expect(posts[1].byUser).toBe(true);
    });

    it('reports nothing while the view stays in the section of one heading', async () => {
        await follower();
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400);
        scrolled(1500);
        scrolled(2000);
        expect(posts).toHaveLength(2);
    });

    it('does not take a change of zoom for the author scrolling, even after the author used the page', async () => {
        await follower();
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400, 2);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: false });
    });

    it('does not take the view settling after a zoom for the author scrolling', async () => {
        await follower();
        window.dispatchEvent(new Event('wheel'));
        // The zoom event comes first, with the heading unchanged, and the view moves in the events after it.
        scrolled(0, 2);
        scrolled(1400, 2);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: false });
    });

    it('takes the next input after a zoom for the author using the page again', async () => {
        await follower();
        scrolled(0, 2);
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400, 2);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: true });
    });

    it('does not take Ctrl and the wheel, which zooms, for scrolling', async () => {
        await follower();
        window.dispatchEvent(Object.assign(new Event('wheel'), { ctrlKey: true }));
        window.dispatchEvent(Object.assign(new Event('wheel'), { metaKey: true }));
        scrolled(1400);
        expect(posts[1].byUser).toBe(false);
    });

    it('scrolls to an entry, with a margin above its heading', async () => {
        const result = await follower();
        result.scrollTo(1);
        expect(viewer.container.scrollTop).toBe(1409 - HEADING_MARGIN);
    });

    it('scrolls to the top of the document for the place above the first entry', async () => {
        const result = await follower();
        viewer.container.scrollTop = 1400;
        result.scrollTo(-1);
        expect(viewer.container.scrollTop).toBe(0);
    });

    it('does not report as the author\'s the scroll it was asked to make, though the author had used the page', async () => {
        const result = await follower();
        window.dispatchEvent(new Event('wheel'));
        result.scrollTo(2);
        scrolled(viewer.container.scrollTop);
        expect(posts.slice(1)).toEqual([]);
    });

    it('reports the author\'s next scroll as theirs, once they use the page again', async () => {
        const result = await follower();
        result.scrollTo(2);
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: true });
    });

    it('does not take the scroll that stops short of a heading, at the end of the document, for the author\'s', async () => {
        const result = await follower();
        window.dispatchEvent(new Event('wheel'));
        result.scrollTo(2);
        // The view cannot scroll as far as asked, so it comes to rest at the heading before.
        scrolled(1500);
        expect(posts[1]).toEqual({ type: 'topHeading', index: 1, byUser: false });
    });

    it('ignores an entry the outline does not have', async () => {
        const result = await follower();
        viewer.container.scrollTop = 123;
        result.scrollTo(7);
        expect(viewer.container.scrollTop).toBe(123);
    });

    it('does not scroll while the page is not shown, which has no layout to measure', async () => {
        const result = await follower();
        viewer.container.scrollTop = 500;
        (viewer.container as { clientHeight?: number }).clientHeight = 0;
        result.scrollTo(2);
        expect(viewer.container.scrollTop).toBe(500);
    });

    it('does nothing once stopped', async () => {
        const result = await follower();
        result.stop();
        window.dispatchEvent(new Event('wheel'));
        scrolled(1400);
        result.scrollTo(2);
        expect(posts).toHaveLength(1);
        expect(viewer.container.scrollTop).toBe(1400);
    });

    it('waits for the pages of the viewer before it measures them', async () => {
        const pages = viewer.app.pdfViewer.getPageView;
        let ready = false;
        viewer.app.pdfViewer.getPageView = (index: number) => (ready ? pages(index) : undefined);
        const result = createHeadingFollower(viewer.app, message => posts.push(message));
        const started = result.follow();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(posts).toEqual([]);

        ready = true;
        viewer.fire('pagesinit');
        await started;
        expect(posts).toEqual([{ type: 'outline', titles: ['One', 'Two', 'Three'], top: -1 }]);
    });
});
