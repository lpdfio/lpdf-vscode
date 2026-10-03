import { describe, expect, it } from 'vitest';
import {
    canvasRatio,
    covers,
    DRAW_MARGIN,
    fitsWhole,
    MAX_CANVAS_PIXELS,
    planPages,
    REDRAW_MARGIN,
    visibleRegion,
} from '../media/viewer/lpdf-diff-pages.mjs';

describe('canvasRatio', () => {
    it('is the screen ratio for a canvas that is within the limit', () => {
        expect(canvasRatio(800, 1100, 2)).toBe(2);
        expect(canvasRatio(800, 1100, 1)).toBe(1);
    });

    it('is lower for a canvas that would be over the limit, so that it has exactly the limit', () => {
        const ratio = canvasRatio(2000, 2800, 2);
        expect(ratio).toBeLessThan(2);
        expect(2000 * 2800 * ratio * ratio).toBeCloseTo(MAX_CANVAS_PIXELS, -2);
    });

    it('keeps a canvas that is exactly at the limit at the screen ratio', () => {
        expect(canvasRatio(4096, 4096, 1)).toBe(1);
    });

    it('takes the limit as an argument', () => {
        expect(canvasRatio(100, 100, 1, 2500)).toBeCloseTo(0.5);
    });
});

describe('fitsWhole', () => {
    it('is true for a page that can be drawn on one canvas', () => {
        expect(fitsWhole(800, 1100, 2)).toBe(true);
        expect(fitsWhole(4096, 4096, 1)).toBe(true);
    });

    it('is false for a page that would need more pixels than the limit, such as one at a high zoom', () => {
        expect(fitsWhole(612 * 25, 792 * 25, 1)).toBe(false);
        expect(fitsWhole(2000, 2800, 2)).toBe(false);
    });
});

describe('visibleRegion', () => {
    const view = { left: 0, top: 0, width: 800, height: 600 };

    it('is the whole page when the whole page is within the view and its margin', () => {
        expect(visibleRegion(view, { left: 100, top: 50, width: 500, height: 600 }, 0.5)).toEqual({ left: 0, top: 0, width: 500, height: 600 });
    });

    it('is the part of a large page that is in the view and its margin, from the page own top left corner', () => {
        const page = { left: -200, top: -3000, width: 1500, height: 6000 };
        expect(visibleRegion(view, page, 0.5)).toEqual({ left: 0, top: 2700, width: 1400, height: 1200 });
    });

    it('is smaller with a smaller margin', () => {
        const page = { left: -200, top: -3000, width: 1500, height: 6000 };
        expect(visibleRegion(view, page, 0)).toEqual({ left: 200, top: 3000, width: 800, height: 600 });
    });

    it('rounds out to whole pixels, so no seam is left at the edge', () => {
        const region = visibleRegion({ left: 0.4, top: 10.6, width: 100, height: 100 }, { left: 0, top: 0, width: 1000, height: 1000 }, 0);
        expect(region).toEqual({ left: 0, top: 10, width: 101, height: 101 });
    });

    it('is null for a page that is wholly outside the view and its margin', () => {
        expect(visibleRegion(view, { left: 0, top: 1000, width: 500, height: 500 }, 0.5)).toBeNull();
        expect(visibleRegion(view, { left: 2000, top: 0, width: 500, height: 500 }, 0.5)).toBeNull();
    });

    it('is null for a page that only touches the edge of the widened view', () => {
        expect(visibleRegion(view, { left: 0, top: 900, width: 500, height: 500 }, 0.5)).toBeNull();
    });

    it('never goes past the edges of the page', () => {
        const region = visibleRegion(view, { left: -50, top: -50, width: 900, height: 700 }, 0.5);
        expect(region).toEqual({ left: 0, top: 0, width: 900, height: 700 });
    });
});

describe('the margins', () => {
    it('are fractions of the pane, and a page is drawn again before the view gets to the edge of what is drawn', () => {
        expect(REDRAW_MARGIN).toBeGreaterThan(0);
        expect(REDRAW_MARGIN).toBeLessThan(DRAW_MARGIN);
    });
});

describe('covers', () => {
    const drawn = { left: 100, top: 200, width: 500, height: 400 };

    it('is true for a part inside what is drawn, and for the same part', () => {
        expect(covers(drawn, { left: 150, top: 250, width: 100, height: 100 })).toBe(true);
        expect(covers(drawn, drawn)).toBe(true);
    });

    it('is false for a part that goes past any one edge', () => {
        expect(covers(drawn, { left: 99, top: 250, width: 100, height: 100 })).toBe(false);
        expect(covers(drawn, { left: 150, top: 199, width: 100, height: 100 })).toBe(false);
        expect(covers(drawn, { left: 550, top: 250, width: 100, height: 100 })).toBe(false);
        expect(covers(drawn, { left: 150, top: 550, width: 100, height: 100 })).toBe(false);
    });
});

describe('planPages', () => {
    const whole = (indexes: number[]) => new Map<number, undefined>(indexes.map(index => [index, undefined]));

    it('draws the pages wanted that are not drawn, top to bottom', () => {
        const plan = planPages({ wanted: whole([4, 2, 3]), drawn: new Array(8).fill(undefined), target: 1 });
        expect(plan).toEqual({ draw: [2, 3, 4], free: [] });
    });

    it('draws nothing for pages that are drawn at the zoom asked for', () => {
        const plan = planPages({ wanted: whole([1, 2]), drawn: [undefined, { target: 1 }, { target: 1 }, undefined], target: 1 });
        expect(plan).toEqual({ draw: [], free: [] });
    });

    it('draws again a page that is drawn at another zoom', () => {
        const plan = planPages({ wanted: whole([1, 2]), drawn: [undefined, { target: 0.5 }, { target: 1 }, undefined], target: 1 });
        expect(plan.draw).toEqual([1]);
    });

    it('frees the pages that are drawn and no longer wanted, and only those', () => {
        const state = { target: 1 };
        const plan = planPages({ wanted: whole([3]), drawn: [state, state, undefined, state, undefined, state], target: 1 });
        expect(plan).toEqual({ draw: [], free: [0, 1, 5] });
    });

    it('frees a page that is drawn at another zoom when it is not wanted, without drawing it again', () => {
        const plan = planPages({ wanted: whole([]), drawn: [{ target: 0.5 }, { target: 0.5 }], target: 1 });
        expect(plan).toEqual({ draw: [], free: [0, 1] });
    });

    it('has nothing to do for a document with no pages wanted and none drawn', () => {
        expect(planPages({ wanted: whole([]), drawn: [], target: 1 })).toEqual({ draw: [], free: [] });
    });

    describe('for a large page, which is drawn in part', () => {
        const needed = { left: 0, top: 1000, width: 800, height: 600 };

        it('draws it when it is not drawn', () => {
            const plan = planPages({ wanted: new Map([[0, needed]]), drawn: [undefined], target: 1 });
            expect(plan.draw).toEqual([0]);
        });

        it('leaves it while the part drawn holds the part that is needed', () => {
            const drawn = [{ target: 1, region: { left: 0, top: 800, width: 1000, height: 1200 } }];
            expect(planPages({ wanted: new Map([[0, needed]]), drawn, target: 1 }).draw).toEqual([]);
        });

        it('draws it again when the view has gone past the part drawn', () => {
            const drawn = [{ target: 1, region: { left: 0, top: 0, width: 1000, height: 1200 } }];
            expect(planPages({ wanted: new Map([[0, needed]]), drawn, target: 1 }).draw).toEqual([0]);
        });

        it('draws it again at another zoom, even if the part drawn would hold what is needed', () => {
            const drawn = [{ target: 0.5, region: { left: 0, top: 0, width: 5000, height: 5000 } }];
            expect(planPages({ wanted: new Map([[0, needed]]), drawn, target: 1 }).draw).toEqual([0]);
        });

        it('draws it again when it was drawn whole and now needs a part, which is what a higher zoom does at the same target', () => {
            expect(planPages({ wanted: new Map([[0, needed]]), drawn: [{ target: 1 }], target: 1 }).draw).toEqual([0]);
        });
    });
});
