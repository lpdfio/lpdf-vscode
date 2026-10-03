/**
 * The zoom arithmetic of the diff view (media/pdf-diff.html), kept apart from the page so it can be
 * tested. A pinch or Ctrl and the mouse wheel zooms both panes at once, around the point under the
 * pointer: the page shows each pane's pages at the new size straight away, and draws them sharply
 * once the zoom has settled. These functions are the maths of that.
 */

/** A wheel notch of a mouse is one step of this size; a pinch is a stream of small deltas instead. */
const WHEEL_STEP = 1.1;

/** Deltas of at least this many pixels are a notch of a mouse wheel, not part of a pinch. */
const NOTCH_PIXELS = 50;

/** A pinch of this many pixels in total multiplies the zoom by e. */
const PINCH_PIXELS_PER_E = 100;

/** Browsers report a wheel delta in pixels, lines or pages; a line is about 33 pixels, a page about 800. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const PIXELS_PER_LINE = 33;
const PIXELS_PER_PAGE = 800;

/** The range of the zoom, as the full viewer's: 10% to 1000%. A test keeps the two the same. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

/**
 * Whether a wheel event is a zoom gesture. A pinch on a trackpad arrives as a wheel event with
 * Ctrl held, and so does Ctrl and the mouse wheel; Cmd is the Mac's.
 * @param {{ ctrlKey: boolean, metaKey?: boolean }} event A wheel event.
 * @returns {boolean}
 */
export function isZoomGesture(event) {
    return event.ctrlKey || Boolean(event.metaKey);
}

/**
 * By how much a wheel event changes the zoom.
 * @param {{ deltaY: number, deltaMode?: number }} event A wheel event.
 * @returns {number} A factor to multiply the zoom by: above 1 zooms in, below 1 zooms out.
 */
export function wheelZoomFactor({ deltaY, deltaMode = 0 }) {
    let pixels = deltaY;
    if (deltaMode === DOM_DELTA_LINE) { pixels = deltaY * PIXELS_PER_LINE; }
    if (deltaMode === DOM_DELTA_PAGE) { pixels = deltaY * PIXELS_PER_PAGE; }
    if (Math.abs(pixels) >= NOTCH_PIXELS) { return pixels < 0 ? WHEEL_STEP : 1 / WHEEL_STEP; }
    return Math.exp(-pixels / PINCH_PIXELS_PER_E);
}

/**
 * Keeps a zoom within its range.
 * @param {number} scale The zoom asked for.
 * @returns {number} The zoom, from 0.1 (10%) to 10 (1000%), the range of the full viewer.
 */
export function clampScale(scale) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The index of the page that a point is over, or the nearest one when it is in a gap.
 * @param {{ top: number, bottom: number }[]} rects The pages' boxes, top to bottom.
 * @param {number} y The point's vertical position, in the same coordinates as the boxes.
 * @returns {number} An index, or -1 when there are no pages.
 */
export function nearestPage(rects, y) {
    let best = -1;
    let bestDistance = Infinity;
    rects.forEach((rect, index) => {
        const distance = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

/**
 * Where a point is in a page, as fractions of the page's width and height. A point outside the
 * page gives a fraction below 0 or above 1.
 * @param {{ left: number, top: number, width: number, height: number }} rect The page's box.
 * @param {{ x: number, y: number }} point The point.
 * @returns {{ fx: number, fy: number }}
 */
export function anchorIn(rect, point) {
    return {
        fx: rect.width > 0 ? (point.x - rect.left) / rect.width : 0,
        fy: rect.height > 0 ? (point.y - rect.top) / rect.height : 0,
    };
}

/**
 * How far to scroll so that the part of a page that was under a point is under it again, once the
 * page has changed size.
 * @param {{ fx: number, fy: number }} anchor Where the point was in the page, from {@link anchorIn}.
 * @param {{ left: number, top: number, width: number, height: number }} rect The page's box now.
 * @param {{ x: number, y: number }} point The point, which stays where it is on screen.
 * @returns {{ dx: number, dy: number }} The amounts to add to the pane's scroll position.
 */
export function scrollShift(anchor, rect, point) {
    return {
        dx: rect.left + anchor.fx * rect.width - point.x,
        dy: rect.top + anchor.fy * rect.height - point.y,
    };
}

/**
 * The fit that the fit button switches to: from the page width to the whole page, from anything
 * else to the page width. The viewer's own fit button does the same.
 * @param {'width' | 'page' | 'manual'} mode How the zoom was last set.
 * @returns {'width' | 'page'}
 */
export function nextFitMode(mode) {
    return mode === 'width' ? 'page' : 'width';
}
