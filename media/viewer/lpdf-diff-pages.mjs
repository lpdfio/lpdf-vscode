/**
 * Which pages of the diff view (media/pdf-diff.html) are drawn, and how much of each. A canvas holds
 * pixels, so it grows with the zoom and the screen: at 2x display scaling and a zoom of 330% one page
 * is 88 MB, and at 1000% it is beyond what a canvas can hold. So only the pages in and near the view are
 * drawn, and a page too large to draw whole is drawn only where it is in view, with some to spare
 * for scrolling, as the full viewer does. These functions are the decisions; the page does the drawing.
 */

/**
 * The most pixels one canvas may have: 16 million, which is 64 MB. Beyond it a canvas is drawn at a
 * lower resolution and stretched, which only shows on a high resolution screen at the largest zooms.
 */
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/**
 * How far past the edge of a pane, as a fraction of its width and its height, the part of a large
 * page that is in view is drawn, so a scroll shows drawn page and not a blank one.
 */
export const DRAW_MARGIN = 0.5;

/**
 * How close to the edge of the drawn part of a large page the view may come before the page is
 * drawn again, as a fraction of the pane's width and height. It is less than {@link DRAW_MARGIN}, so
 * the new drawing is under way while there is still drawn page to scroll over.
 */
export const REDRAW_MARGIN = 0.2;

/** A box: its top left corner and its size. @typedef {{ left: number, top: number, width: number, height: number }} Box */

/**
 * How many device pixels to draw for each pixel of a canvas's size on screen.
 * @param {number} width The canvas's width on screen, in CSS pixels.
 * @param {number} height The canvas's height on screen, in CSS pixels.
 * @param {number} deviceRatio The screen's device pixels per CSS pixel.
 * @param {number} [maxPixels] The most pixels a canvas may have.
 * @returns {number} The device ratio, or less when the canvas would be too large.
 */
export function canvasRatio(width, height, deviceRatio, maxPixels = MAX_CANVAS_PIXELS) {
    const pixels = width * height * deviceRatio * deviceRatio;
    return pixels > maxPixels ? deviceRatio * Math.sqrt(maxPixels / pixels) : deviceRatio;
}

/**
 * Whether a whole page can be drawn on one canvas without going over the limit.
 * @param {number} width The page's width on screen, in CSS pixels.
 * @param {number} height The page's height on screen, in CSS pixels.
 * @param {number} deviceRatio The screen's device pixels per CSS pixel.
 * @param {number} [maxPixels] The most pixels a canvas may have.
 * @returns {boolean}
 */
export function fitsWhole(width, height, deviceRatio, maxPixels = MAX_CANVAS_PIXELS) {
    return width * height * deviceRatio * deviceRatio <= maxPixels;
}

/**
 * The part of a page that is in the view, with a margin round the view.
 * @param {{ left: number, top: number, width: number, height: number }} view The pane's visible area.
 * @param {{ left: number, top: number, width: number, height: number }} page The page's box, in the same coordinates as the view.
 * @param {number} margin How much to add on each side of the view, as a fraction of its width and its height.
 * @returns {Box | null} The part of the page that is in the widened view, in whole pixels, with the
 *     page's own top left corner as its origin; or null when none of the page is.
 */
export function visibleRegion(view, page, margin) {
    const left = Math.max(view.left - view.width * margin, page.left);
    const top = Math.max(view.top - view.height * margin, page.top);
    const right = Math.min(view.left + view.width * (1 + margin), page.left + page.width);
    const bottom = Math.min(view.top + view.height * (1 + margin), page.top + page.height);
    if (right <= left || bottom <= top) { return null; }
    const x = Math.floor(left - page.left);
    const y = Math.floor(top - page.top);
    return {
        left: x,
        top: y,
        width: Math.min(page.width, Math.ceil(right - page.left)) - x,
        height: Math.min(page.height, Math.ceil(bottom - page.top)) - y,
    };
}

/**
 * Whether a drawn part of a page holds all of another.
 * @param {Box} drawn The part that is drawn.
 * @param {Box} needed The part that is to be on show.
 * @returns {boolean}
 */
export function covers(drawn, needed) {
    return drawn.left <= needed.left
        && drawn.top <= needed.top
        && drawn.left + drawn.width >= needed.left + needed.width
        && drawn.top + drawn.height >= needed.top + needed.height;
}

/**
 * What to do with the pages of one document.
 * @param {object} state
 * @param {Map<number, Box | undefined>} state.wanted The pages that are to be drawn, by index. A
 *     page that is drawn whole has undefined; a large page has the part of it that must be drawn.
 * @param {({ target: number, region?: Box } | undefined)[]} state.drawn For each page, how it is drawn: the
 *     zoom, and for a large page the part drawn; or undefined for a page that is not drawn.
 * @param {number} state.target The zoom a page is to be drawn at.
 * @returns {{ draw: number[], free: number[] }} The pages to draw, which are those wanted that are
 *     not drawn, are drawn at another zoom, or are drawn without the part that must be shown, top to
 *     bottom; and the pages to free, which are those drawn that are no longer wanted.
 */
export function planPages({ wanted, drawn, target }) {
    const draw = [...wanted.keys()].filter(index => {
        const state = drawn[index];
        if (state === undefined || state.target !== target) { return true; }
        const needed = wanted.get(index);
        return needed !== undefined && (state.region === undefined || !covers(state.region, needed));
    }).sort((a, b) => a - b);
    const free = [];
    for (let index = 0; index < drawn.length; index++) {
        if (drawn[index] !== undefined && !wanted.has(index)) { free.push(index); }
    }
    return { draw, free };
}
