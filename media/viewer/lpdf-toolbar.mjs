/**
 * The PDF.js viewer's toolbar, arranged for Lpdf.
 *
 *     [sidebar] [search]    page of N | - zoom % + | fit  two pages  cover    [save] [info]
 *
 * The viewer's own controls are reused and only moved: it finds each of them by id when it starts,
 * so where they sit does not matter. Four controls are new: the zoom percentage field, the fit
 * toggle, and the two page and cover buttons.
 *
 * The page works in two steps: {@link arrangeToolbar} before the viewer starts, and
 * {@link connectToolbar} once it has.
 *
 * What this relies on in the stock viewer. These are details of PDF.js's `web/viewer.html` and
 * `web/viewer.mjs`, not a published interface, so each is a place to look when the viewer is
 * upgraded (see README.md in this folder). The markup ones are checked when the toolbar is
 * arranged: a viewer that changed one fails with a {@link ToolbarMarkupError} that names it,
 * instead of with a header that is quietly wrong.
 *   - Elements, by id: toolbarViewerMiddle, previous, next, pageNumber, numPages, zoomOutButton,
 *     zoomInButton, downloadButton, documentProperties, secondaryToolbarToggle.
 *   - Groups: previous and next share one; pageNumber and numPages share one; zoomOutButton and
 *     zoomInButton share one, with a `.splitToolbarButtonSeparator` between them; downloadButton
 *     sits in the group that is to hold the document properties button.
 *   - The class `labeled`, which makes documentProperties a menu row, and which is taken off.
 *   - Behaviour: the viewer wires each control by id when it starts, wherever the control sits;
 *     `pdfViewer` has `currentScaleValue`, `currentScale` and `spreadMode` (0 none, 1 odd, 2 even);
 *     the event bus sends `scalechanging` ({ scale, presetValue }) and `spreadmodechanged` ({ mode });
 *     and the option `spreadModeOnLoad` sets the spread mode of the next document.
 * The unit tests run {@link arrangeToolbar} on the vendored viewer.html, so `npm test` catches an
 * upgrade that moves the markup.
 */

/** The zoom percentages a user can type: the viewer's own range, whose top vendor-pdfjs.mjs sets. */
const MIN_ZOOM_PERCENT = 10;
const MAX_ZOOM_PERCENT = 1000;

/** A typed zoom: digits, an optional decimal part, an optional percent sign. */
const ZOOM_TEXT = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/;

/**
 * The viewer's spread-mode codes. Odd spreads pair page 1 with page 2; even spreads show page 1
 * alone, as a cover, and pair the rest from page 2.
 */
const SPREAD_NONE = 0;
const SPREAD_ODD = 1;
const SPREAD_EVEN = 2;

/** Thrown when an element the toolbar depends on is not in the viewer page, e.g. after a viewer upgrade. */
export class ToolbarMarkupError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolbarMarkupError';
    }
}

/**
 * Reads a zoom the user typed.
 * @param {string} text What is in the zoom field, such as `150`, `150%` or `87,5 %`.
 * @returns {number | undefined} The percentage, kept within the allowed range, or undefined when the text is not a number.
 */
export function parseZoomPercent(text) {
    const match = ZOOM_TEXT.exec(text);
    if (!match) { return undefined; }
    const percent = Number(match[1].replace(',', '.'));
    return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, percent));
}

/**
 * How the viewer is zoomed, as far as the fit toggle is concerned.
 * @param {string | undefined} scaleValue The viewer's scale value: a preset such as `page-width`, or a number as text.
 * @returns {'width' | 'page' | 'manual'} Fitted to the page width, fitted to the whole page, or neither.
 */
export function fitModeOf(scaleValue) {
    if (scaleValue === 'page-width') { return 'width'; }
    if (scaleValue === 'page-fit') { return 'page'; }
    return 'manual';
}

/**
 * The scale value the fit toggle switches to: from width to page, otherwise to width.
 * @param {string | undefined} scaleValue The viewer's current scale value.
 * @returns {'page-fit' | 'page-width'} The preset to apply.
 */
export function nextFitScaleValue(scaleValue) {
    return fitModeOf(scaleValue) === 'width' ? 'page-fit' : 'page-width';
}

/**
 * The viewer's spread mode for the two page and cover buttons.
 * @param {boolean} isTwoPage Whether pages are shown two to a row.
 * @param {boolean} coverSeparately Whether page 1 is shown alone, as a cover.
 * @returns {number} Single pages, odd spreads, or even spreads.
 */
export function spreadModeFor(isTwoPage, coverSeparately) {
    if (!isTwoPage) { return SPREAD_NONE; }
    return coverSeparately ? SPREAD_EVEN : SPREAD_ODD;
}

/** The zoom as the field shows it. */
function formatZoom(scale) {
    return `${Math.round(scale * 100)}%`;
}

function elementById(id) {
    const element = document.getElementById(id);
    if (!element) { throw new ToolbarMarkupError(`The viewer page has no element #${id}`); }
    return element;
}

/**
 * The group a control sits in, checked to hold the controls that belong with it.
 * @param {string} id The control.
 * @param {string[]} holds The ids of controls that must be in the same group.
 * @throws {ToolbarMarkupError} When the control has no group, or the group lacks one of those.
 */
function groupOf(id, holds) {
    const group = elementById(id).parentElement;
    if (!group) { throw new ToolbarMarkupError(`The viewer page has #${id} outside any group`); }
    for (const other of holds) {
        if (!group.contains(elementById(other))) {
            throw new ToolbarMarkupError(`The viewer page has #${id} and #${other} in different groups`);
        }
    }
    return group;
}

function createElement(tagName, className, attributes = {}) {
    const element = document.createElement(tagName);
    if (className) { element.className = className; }
    for (const [name, value] of Object.entries(attributes)) { element.setAttribute(name, value); }
    return element;
}

function createZoomField() {
    return createElement('input', 'toolbarField', {
        id: 'lpdfZoomInput',
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        spellcheck: 'false',
        title: 'Zoom: type a percentage',
        'aria-label': 'Zoom',
    });
}

function createFitButton() {
    return createElement('button', 'toolbarButton lpdf-fit', {
        id: 'lpdfFitButton',
        type: 'button',
        'data-next': 'width',
        title: 'Fit to width',
        'aria-label': 'Fit to width',
    });
}

/** A button that is on or off, drawn highlighted when on. */
function createToggleButton(id, label) {
    return createElement('button', 'toolbarButton lpdf-pages', {
        id,
        type: 'button',
        title: label,
        'aria-label': label,
        'aria-pressed': 'false',
    });
}

function setPressed(button, isPressed) {
    button.classList.toggle('toggled', isPressed);
    button.setAttribute('aria-pressed', String(isPressed));
}

/**
 * Moves the viewer's controls into the Lpdf layout and adds the new ones. Run it before the viewer
 * starts, while the page is still covered by the status message, so the stock layout is never seen.
 * @throws {ToolbarMarkupError} When the viewer page lacks an element the layout needs.
 */
export function arrangeToolbar() {
    const middle = elementById('toolbarViewerMiddle');
    const arrowGroup = groupOf('previous', ['next']);
    const pageGroup = groupOf('numPages', ['pageNumber']);
    const zoomOutButton = elementById('zoomOutButton');
    const zoomGroup = groupOf('zoomOutButton', ['zoomInButton']);
    const saveGroup = groupOf('downloadButton', []);
    const propertiesButton = elementById('documentProperties');
    const moreMenu = elementById('secondaryToolbarToggle');

    // The viewer starts with the page arrows; scrolling is continuous and the page box goes to any
    // page, so the arrows go. They stay in the page, hidden, because the viewer keeps them up to date.
    arrowGroup.classList.add('lpdf-hidden');

    // The page box moves in beside the zoom controls, and the dropdown of zoom levels is replaced
    // by a field to type in, a fit toggle and the two page buttons. The dropdown stays in the page,
    // hidden by CSS, because the viewer keeps it up to date.
    zoomGroup.querySelector('.splitToolbarButtonSeparator')?.remove();
    zoomOutButton.after(createZoomField());
    middle.prepend(pageGroup, createElement('div', 'verticalToolbarSeparator'));
    zoomGroup.after(
        createElement('div', 'verticalToolbarSeparator lpdf-fit'),
        createFitButton(),
        createToggleButton('lpdfTwoPageButton', 'Two page view'),
        createToggleButton('lpdfCoverButton', 'Show cover page separately'),
    );

    // The document properties button leaves the more menu, which then has nothing else in it, and
    // sits beside Save as an icon. The menu stays in the page, hidden, because the viewer wires it.
    propertiesButton.classList.remove('labeled');
    saveGroup.append(propertiesButton);
    moreMenu.classList.add('lpdf-hidden');
}

/**
 * Connects the new controls to the viewer. Run it once the viewer has started.
 * @param app The viewer application.
 * @param options The viewer's options.
 * @throws {ToolbarMarkupError} When a control {@link arrangeToolbar} adds is missing.
 */
export function connectToolbar(app, options) {
    const zoomField = elementById('lpdfZoomInput');
    const fitButton = elementById('lpdfFitButton');
    const twoPageButton = elementById('lpdfTwoPageButton');
    const coverButton = elementById('lpdfCoverButton');
    const { eventBus } = app;

    const showZoom = scale => { zoomField.value = formatZoom(scale); };
    const showFitTarget = scaleValue => {
        const target = nextFitScaleValue(scaleValue) === 'page-fit' ? 'page' : 'width';
        const label = target === 'page' ? 'Fit to page' : 'Fit to width';
        fitButton.dataset.next = target;
        fitButton.title = label;
        fitButton.setAttribute('aria-label', label);
    };

    // Every zoom change reaches here, whether it came from the buttons, the field, the fit toggle,
    // Ctrl and the mouse wheel, or a pinch.
    eventBus.on('scalechanging', ({ scale, presetValue }) => {
        if (document.activeElement !== zoomField) { showZoom(scale); }
        showFitTarget(presetValue ?? String(scale));
    });

    // A click into the field selects the zoom, so typing replaces it. The browser would put the
    // caret where the mouse went, so the selection is made again when the button comes up.
    let selectOnMouseUp = false;
    zoomField.addEventListener('mousedown', () => { selectOnMouseUp = document.activeElement !== zoomField; });
    zoomField.addEventListener('mouseup', event => {
        if (!selectOnMouseUp) { return; }
        selectOnMouseUp = false;
        event.preventDefault();
        zoomField.select();
    });
    zoomField.addEventListener('focus', () => zoomField.select());
    zoomField.addEventListener('change', () => {
        const percent = parseZoomPercent(zoomField.value);
        if (percent !== undefined && app.pdfDocument) {
            app.pdfViewer.currentScaleValue = String(percent / 100);
        }
        // Shows the zoom the viewer ended up with, and puts back the old one for text that was not a number.
        if (app.pdfDocument) { showZoom(app.pdfViewer.currentScale); }
    });
    zoomField.addEventListener('keydown', event => {
        if (event.key !== 'Escape') { return; }
        if (app.pdfDocument) { showZoom(app.pdfViewer.currentScale); }
        zoomField.blur();
    });

    fitButton.addEventListener('click', () => {
        if (!app.pdfDocument) { return; }
        app.pdfViewer.currentScaleValue = nextFitScaleValue(app.pdfViewer.currentScaleValue);
    });

    // The cover choice is kept while the two page view is off, so turning it back on restores it.
    let coverSeparately = false;
    const applySpreadMode = isTwoPage => {
        const mode = spreadModeFor(isTwoPage, coverSeparately);
        // The viewer forgets the spread mode when it opens another document, so the mode is also
        // kept as the option it applies on load; a re-render then keeps the page view.
        options.set('spreadModeOnLoad', mode);
        if (app.pdfDocument) { app.pdfViewer.spreadMode = mode; }
    };
    twoPageButton.addEventListener('click', () => {
        applySpreadMode(twoPageButton.getAttribute('aria-pressed') !== 'true');
    });
    coverButton.addEventListener('click', () => {
        coverSeparately = coverButton.getAttribute('aria-pressed') !== 'true';
        applySpreadMode(true);
    });
    eventBus.on('spreadmodechanged', ({ mode }) => {
        if (mode !== SPREAD_NONE) { coverSeparately = mode === SPREAD_EVEN; }
        setPressed(twoPageButton, mode !== SPREAD_NONE);
        setPressed(coverButton, coverSeparately);
        // The cover only has a meaning with two pages to a row, so the button waits for that.
        coverButton.disabled = mode === SPREAD_NONE;
    });
    coverButton.disabled = true;
}
