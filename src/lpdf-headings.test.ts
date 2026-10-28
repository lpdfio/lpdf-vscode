import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createHeadingFollower, destinationTop, HEADING_MARGIN, placeTop, positionAt, readingLineAt, readOutline, stopsOf,
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

describe('stopsOf', () => {
    it('are the start, the place of each entry, and the end', () => {
        expect(stopsOf([100, 500, 900], 16, 2000)).toEqual([16, 100, 500, 900, 2000]);
    });

    it('put an entry the view cannot scroll far enough to reach at the end', () => {
        expect(stopsOf([100, 500, 900], 16, 600)).toEqual([16, 100, 500, 600, 600]);
    });

    it('put an entry above the start at the start', () => {
        expect(stopsOf([5, 100], 16, 2000)).toEqual([16, 16, 100, 2000]);
    });

    it('do not decrease, though the outline puts an entry above the one before it', () => {
        expect(stopsOf([500, 300, 900], 16, 2000)).toEqual([16, 500, 500, 900, 2000]);
    });

    it('are the start and the end for a document with no entries', () => {
        expect(stopsOf([], 16, 2000)).toEqual([16, 2000]);
    });
});

describe('positionAt and readingLineAt', () => {
    const STOPS = [16, 100, 500, 900, 2000];

    it('put the start at the top of the document, and the end at the number of entries', () => {
        expect(positionAt(STOPS, 16)).toBe(-1);
        expect(positionAt(STOPS, 2000)).toBe(3);
    });

    it('put the place of an entry at the entry', () => {
        expect(positionAt(STOPS, 100)).toBe(0);
        expect(positionAt(STOPS, 500)).toBe(1);
        expect(positionAt(STOPS, 900)).toBe(2);
    });

    it('put a line between two stops the same fraction of the way along', () => {
        expect(positionAt(STOPS, 300)).toBeCloseTo(0.5);
        expect(positionAt(STOPS, 58)).toBeCloseTo(-0.5);
        expect(positionAt(STOPS, 1450)).toBeCloseTo(2.5);
    });

    it('put a line above the start at the top, and one below the end at the end', () => {
        expect(positionAt(STOPS, 0)).toBe(-1);
        expect(positionAt(STOPS, 5000)).toBe(3);
    });

    it('put a line at stops that are the same at the last of them, the end', () => {
        expect(positionAt([16, 100, 600, 600, 600], 600)).toBe(3);
        expect(positionAt([16, 100, 600, 600, 600], 599)).toBeCloseTo(0.998, 2);
    });

    it('give back the line of a place', () => {
        for (const line of [16, 40, 100, 300, 500, 899, 1450, 2000]) {
            expect(readingLineAt(STOPS, positionAt(STOPS, line))).toBeCloseTo(line);
        }
    });

    it('put a place between two entries the same fraction of the way along', () => {
        expect(readingLineAt(STOPS, 0.25)).toBe(200);
        expect(readingLineAt(STOPS, -0.5)).toBe(58);
    });

    it('take a place beyond the top or the end of the document for the top or the end', () => {
        expect(readingLineAt(STOPS, -7)).toBe(16);
        expect(readingLineAt(STOPS, 99)).toBe(2000);
    });

    it('work for a document with no entries', () => {
        expect(positionAt([16, 2000], 1008)).toBeCloseTo(-0.5);
        expect(readingLineAt([16, 2000], 0)).toBe(2000);
    });
});

/** A viewer with three pages of 1000px, an outline of three headings, and an event bus that the test fires. */
function fakeViewer(): { app: any; fire: (name: string, data?: object) => void; container: { scrollTop: number; scrollHeight: number; clientHeight: number } } {
    const container = { scrollTop: 0, scrollHeight: 3000, clientHeight: 800 };
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

// The stops of fakeViewer, as reading lines: 16 at the start, 29, 1409 and 2109 for the entries, and 2216 at the
// end, which is the 2200 pixels the view can scroll plus the margin.
describe('createHeadingFollower', () => {
    const REPORT_INTERVAL = 40;
    let posts: any[];
    let viewer: ReturnType<typeof fakeViewer>;
    let window: EventTarget;

    beforeEach(() => {
        vi.useFakeTimers();
        window = new EventTarget();
        vi.stubGlobal('window', window);
        posts = [];
        viewer = fakeViewer();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    /** The viewer reporting that it was scrolled to `scrollTop`, as it does after any scroll. */
    const scrolled = (scrollTop: number, scale = 1): void => {
        viewer.container.scrollTop = scrollTop;
        viewer.fire('updateviewarea', { location: { scale } });
    };
    const settle = (): void => { vi.advanceTimersByTime(REPORT_INTERVAL); };
    const input = (type = 'wheel', init: object = {}): void => { window.dispatchEvent(Object.assign(new Event(type), init)); };
    const follower = async (): Promise<ReturnType<typeof createHeadingFollower>> => {
        const result = createHeadingFollower(viewer.app, message => posts.push(message));
        await result.follow();
        return result;
    };
    const positions = (): number[] => posts.filter(post => post.type === 'position').map(post => post.at);

    it('reports the titles of the outline when it starts', async () => {
        await follower();
        expect(posts).toEqual([{ type: 'outline', titles: ['One', 'Two', 'Three'] }]);
    });

    it('reports the place the view is at after the author scrolls it', async () => {
        await follower();
        input();
        scrolled(1400);
        settle();
        // The reading line is 1416, 7 pixels into the 700 of the section of Two.
        expect(positions()).toEqual([1 + 7 / 700]);
    });

    it('reports the place at the top of the document as -1, and a heading as its entry', async () => {
        await follower();
        input();
        scrolled(0);
        settle();
        scrolled(1409 - HEADING_MARGIN);
        settle();
        expect(positions()).toEqual([-1, 1]);
    });

    it('reports the end of the document as the number of entries', async () => {
        await follower();
        input();
        scrolled(2200);
        settle();
        expect(positions()).toEqual([3]);
    });

    it('reports the place a scroll comes to rest at, and not each frame of it', async () => {
        await follower();
        input();
        scrolled(300);
        scrolled(600);
        scrolled(1000);
        expect(positions()).toEqual([]);
        settle();
        expect(positions()).toHaveLength(1);
        expect(positions()[0]).toBeCloseTo(positionAt(stopsOf([29, 1409, 2109], 16, 2216), 1016));
    });

    it('reports a scroll that goes on after the first report', async () => {
        await follower();
        input();
        scrolled(300);
        settle();
        scrolled(900);
        settle();
        expect(positions()).toHaveLength(2);
        expect(positions()[1]).toBeGreaterThan(positions()[0]);
    });

    it('reports nothing for a view that has not moved', async () => {
        await follower();
        input();
        scrolled(300);
        settle();
        scrolled(300);
        settle();
        expect(positions()).toHaveLength(1);
    });

    it('reports nothing for a scroll with no input from the author', async () => {
        await follower();
        scrolled(1400);
        settle();
        expect(positions()).toEqual([]);
    });

    it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])('takes %s for the author using the page', async type => {
        await follower();
        input(type);
        scrolled(1400);
        settle();
        expect(positions()).toHaveLength(1);
    });

    it('does not take a change of zoom for the author scrolling, even after the author used the page', async () => {
        await follower();
        input();
        scrolled(1400, 2);
        scrolled(1500, 2);
        settle();
        expect(positions()).toEqual([]);
    });

    it('takes the next input after a zoom for the author using the page again', async () => {
        await follower();
        scrolled(0, 2);
        input();
        scrolled(1400, 2);
        settle();
        expect(positions()).toHaveLength(1);
    });

    it('does not take Ctrl and the wheel, which zooms, for scrolling', async () => {
        await follower();
        input('wheel', { ctrlKey: true });
        input('wheel', { metaKey: true });
        scrolled(1400);
        settle();
        expect(positions()).toEqual([]);
    });

    it('reports nothing if the host moved the view in the pause before the report', async () => {
        const result = await follower();
        input();
        scrolled(1400);
        result.scrollTo(2);
        settle();
        expect(positions()).toEqual([]);
    });

    it('scrolls to a heading, with the margin above it', async () => {
        const result = await follower();
        result.scrollTo(1);
        expect(viewer.container.scrollTop).toBe(1409 - HEADING_MARGIN);
    });

    it('scrolls part way into a section for a place part way into it', async () => {
        const result = await follower();
        result.scrollTo(1.5);
        expect(viewer.container.scrollTop).toBe((1409 + 2109) / 2 - HEADING_MARGIN);
    });

    it('scrolls to the top of the document for -1, and to the end of it for the number of entries', async () => {
        const result = await follower();
        viewer.container.scrollTop = 1400;
        result.scrollTo(-1);
        expect(viewer.container.scrollTop).toBe(0);
        result.scrollTo(3);
        expect(viewer.container.scrollTop).toBe(2200);
    });

    it('takes a place beyond the top or the end of the document for the top or the end', async () => {
        const result = await follower();
        result.scrollTo(99);
        expect(viewer.container.scrollTop).toBe(2200);
        result.scrollTo(-9);
        expect(viewer.container.scrollTop).toBe(0);
    });

    it('scrolls to the end for a heading too near the end of the document to be scrolled to', async () => {
        const result = await follower();
        viewer.container.scrollHeight = 2300;
        viewer.fire('updateviewarea', { location: { scale: 1 } });
        result.scrollTo(2);
        // The view can scroll 1500, which puts the reading line at 1516, short of the 2109 of the heading.
        expect(viewer.container.scrollTop).toBe(1500);
    });

    it('ignores a place that is not a number', async () => {
        const result = await follower();
        viewer.container.scrollTop = 123;
        result.scrollTo(Number.NaN);
        expect(viewer.container.scrollTop).toBe(123);
    });

    it('does not report as the author\'s the scroll it was asked to make, though the author had used the page', async () => {
        const result = await follower();
        input();
        result.scrollTo(2);
        scrolled(viewer.container.scrollTop);
        settle();
        expect(positions()).toEqual([]);
    });

    it('reports the author\'s next scroll once they use the page again', async () => {
        const result = await follower();
        result.scrollTo(2);
        input();
        scrolled(1400);
        settle();
        expect(positions()).toHaveLength(1);
    });

    it('reports a place again after it was scrolled to, though it is the one reported before', async () => {
        const result = await follower();
        input();
        scrolled(1400);
        settle();
        result.scrollTo(2);
        input();
        scrolled(1400);
        settle();
        expect(positions()).toHaveLength(2);
    });

    it('measures the document again when its size changes', async () => {
        const result = await follower();
        result.scrollTo(3);
        expect(viewer.container.scrollTop).toBe(2200);
        viewer.container.scrollHeight = 4000;
        result.scrollTo(3);
        expect(viewer.container.scrollTop).toBe(3200);
    });

    it('does not scroll while the page is not shown, which has no layout to measure', async () => {
        const result = await follower();
        viewer.container.scrollTop = 500;
        viewer.container.clientHeight = 0;
        result.scrollTo(2);
        expect(viewer.container.scrollTop).toBe(500);
    });

    it('does nothing once stopped', async () => {
        const result = await follower();
        input();
        scrolled(1400);
        result.stop();
        settle();
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
        await vi.advanceTimersByTimeAsync(0);
        expect(posts).toEqual([]);

        ready = true;
        viewer.fire('pagesinit');
        await started;
        expect(posts).toEqual([{ type: 'outline', titles: ['One', 'Two', 'Three'] }]);
    });
});
