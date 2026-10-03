import { describe, expect, it } from 'vitest';
import { anchorIn, clampScale, isZoomGesture, nearestPage, nextFitMode, scrollShift, wheelZoomFactor } from '../media/viewer/lpdf-diff-zoom.mjs';

describe('isZoomGesture', () => {
    it('is a wheel event with Ctrl held, which is how a pinch arrives, or with Cmd held', () => {
        expect(isZoomGesture({ ctrlKey: true })).toBe(true);
        expect(isZoomGesture({ ctrlKey: false, metaKey: true })).toBe(true);
    });

    it('is not a wheel event with no key held, which scrolls', () => {
        expect(isZoomGesture({ ctrlKey: false })).toBe(false);
        expect(isZoomGesture({ ctrlKey: false, metaKey: false })).toBe(false);
    });
});

describe('wheelZoomFactor', () => {
    it('zooms in by one step of 10% for a notch of the mouse wheel away from the user, and out for one towards', () => {
        expect(wheelZoomFactor({ deltaY: -100 })).toBeCloseTo(1.1);
        expect(wheelZoomFactor({ deltaY: 100 })).toBeCloseTo(1 / 1.1);
    });

    it('reads a notch given in lines or pages in the same way', () => {
        expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(1.1);
        expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2 })).toBeCloseTo(1.1);
    });

    it('follows a pinch continuously, by a small amount for a small delta', () => {
        expect(wheelZoomFactor({ deltaY: -10 })).toBeCloseTo(Math.exp(0.1));
        expect(wheelZoomFactor({ deltaY: 4 })).toBeCloseTo(Math.exp(-0.04));
    });

    it('does not change the zoom for no movement', () => {
        expect(wheelZoomFactor({ deltaY: 0 })).toBe(1);
    });

    it('is the inverse for the opposite direction, so a pinch out and back in returns to where it began', () => {
        expect(wheelZoomFactor({ deltaY: -7 }) * wheelZoomFactor({ deltaY: 7 })).toBeCloseTo(1);
    });
});

describe('clampScale', () => {
    it('keeps a zoom within 10% and 1000%, the range of the full viewer', () => {
        expect(clampScale(100)).toBe(10);
        expect(clampScale(0.01)).toBe(0.1);
    });

    it('leaves a zoom in that range as it is, whatever the width of the window', () => {
        expect(clampScale(2)).toBe(2);
        expect(clampScale(0.1)).toBe(0.1);
        expect(clampScale(10)).toBe(10);
    });
});

describe('nearestPage', () => {
    const rects = [
        { top: 0, bottom: 100 },
        { top: 112, bottom: 212 },
        { top: 224, bottom: 324 },
    ];

    it('is the page the point is over', () => {
        expect(nearestPage(rects, 50)).toBe(0);
        expect(nearestPage(rects, 150)).toBe(1);
        expect(nearestPage(rects, 300)).toBe(2);
    });

    it('is the closer page when the point is in the gap between two', () => {
        expect(nearestPage(rects, 103)).toBe(0);
        expect(nearestPage(rects, 109)).toBe(1);
    });

    it('is the first or last page for a point above or below all of them', () => {
        expect(nearestPage(rects, -40)).toBe(0);
        expect(nearestPage(rects, 900)).toBe(2);
    });

    it('is -1 when there are no pages', () => {
        expect(nearestPage([], 10)).toBe(-1);
    });
});

describe('anchorIn and scrollShift', () => {
    it('describes a point as fractions of the page', () => {
        expect(anchorIn({ left: 100, top: 50, width: 200, height: 400 }, { x: 150, y: 250 })).toEqual({ fx: 0.25, fy: 0.5 });
    });

    it('needs no scroll when the page did not change', () => {
        const rect = { left: 100, top: 50, width: 200, height: 400 };
        const point = { x: 150, y: 250 };
        expect(scrollShift(anchorIn(rect, point), rect, point)).toEqual({ dx: 0, dy: 0 });
    });

    it('scrolls so that the same part of the page stays under the point when the page doubles in size', () => {
        const before = { left: 100, top: 50, width: 200, height: 400 };
        const point = { x: 150, y: 250 };
        const anchor = anchorIn(before, point);
        // Doubled about its own top left corner, as the page is when its size is set and nothing else moves.
        const after = { left: 100, top: 50, width: 400, height: 800 };
        const { dx, dy } = scrollShift(anchor, after, point);
        // The page is now 100 and 200 px further across and down at that point, so the pane scrolls by that.
        expect({ dx, dy }).toEqual({ dx: 50, dy: 200 });
        // After scrolling, the point is over the same part of the page.
        const scrolled = { ...after, left: after.left - dx, top: after.top - dy };
        expect(anchorIn(scrolled, point)).toEqual(anchor);
    });

    it('scrolls back when the page shrinks', () => {
        const before = { left: 0, top: 0, width: 400, height: 800 };
        const point = { x: 200, y: 400 };
        const after = { left: 0, top: 0, width: 200, height: 400 };
        expect(scrollShift(anchorIn(before, point), after, point)).toEqual({ dx: -100, dy: -200 });
    });

    it('also keeps a point in the gap above a page where it is, in proportion', () => {
        const before = { left: 0, top: 100, width: 100, height: 100 };
        const point = { x: 50, y: 95 };
        const anchor = anchorIn(before, point);
        expect(anchor.fy).toBeCloseTo(-0.05);
        const after = { left: 0, top: 100, width: 200, height: 200 };
        // The point maps to 5% above the page, which is 10 px at the new size, so the pane scrolls 5 px up.
        expect(scrollShift(anchor, after, point).dy).toBeCloseTo(-5);
    });
});

describe('nextFitMode', () => {
    it('goes from the page width to the whole page', () => {
        expect(nextFitMode('width')).toBe('page');
    });

    it('goes from the whole page, or from a zoom that is not a fit, to the page width', () => {
        expect(nextFitMode('page')).toBe('width');
        expect(nextFitMode('manual')).toBe('width');
    });

    it('comes back to where it began after two clicks from the page width', () => {
        expect(nextFitMode(nextFitMode('width'))).toBe('width');
    });
});
