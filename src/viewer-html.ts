import { buildPdfjsCsp } from './pdfjs-csp';

/** Thrown when the vendored viewer.html has no <body>, so its markup cannot be reused. */
export class ViewerMarkupError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ViewerMarkupError';
    }
}

/** What {@link buildViewerHtml} needs to place the PDF.js viewer in a webview. */
export interface ViewerHtmlOptions {
    /** Contents of `media/viewer/web/viewer.html`. Only its `<body>` markup is used, unchanged. */
    viewerHtml: string;
    /** Webview URI of `media/viewer/`. */
    viewerRoot: string;
    /** `webview.cspSource`. */
    cspSource: string;
    /** Per-page nonce for the scripts this page runs. */
    nonce: string;
}

/**
 * Toolbar controls that have no use here. A webview cannot print. The zoom dropdown is replaced by
 * a field to type a zoom in and a fit toggle; the viewer still keeps the dropdown up to date, so
 * it stays in the page, hidden.
 */
const HIDDEN_CONTROLS = [
    '#printButton',
    '#scaleSelectContainer',
];

/**
 * The classes with which the viewer hides parts of its toolbar below fixed window widths. They are
 * taken off, because those widths were chosen for a toolbar with more in it than this one, and
 * {@link RESPONSIVE_STYLE} decides from the width of the toolbar itself.
 */
const WINDOW_WIDTH_CLASSES = ['hiddenMediumView', 'hiddenSmallView', 'visibleMediumView'];

/**
 * VS Code styles every webview body with `padding: 0 20px`. The viewer makes its body 100% wide
 * and fills the webview edge to edge, so that padding would push it 40px past the right edge:
 * a horizontal scrollbar, and the last toolbar button cut off. `html body` outranks VS Code's
 * plain `body` rule whichever of the two style blocks comes first.
 */
const PAGE_RESET_STYLE = `
    html body { padding: 0; }
`;

/** A CSS `url()` for an address, safe inside a `<style>` block. */
function cssUrl(uri: string): string {
    return `url("${uri.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3c ')}")`;
}

/**
 * The viewer's toolbar is 32px high with 16px icons; here it is 36px with 18px icons, which reads
 * at a glance without looking oversized (a quarter larger, 40px and 20px, was too much). The
 * buttons fill the bar less its 2px of padding top and bottom, so they are 32px.
 */
const TOOLBAR_HEIGHT = 36;
const ICON_SIZE = 18;

/** The one gap between neighbouring controls in the left, middle and right groups of the toolbar. */
const TOOLBAR_GAP = 6;

/** Room added on each side of a divider, so it stands apart from the controls and labels beside it. */
const DIVIDER_MARGIN = 6;

/**
 * The look of what lpdf-toolbar.mjs adds and moves. The viewer sets its text fields in the
 * system's message font, which comes out larger than the 12px of the labels beside them, so the
 * fields take the labels' size, and the page and zoom boxes are only as wide as their longest
 * entry (a four-digit page, 1000%). The line inside a box is the icon size less the 1px border above
 * and below, so that line is as high as an icon; 2px of padding above and below it make the box
 * 4px higher than the icons, 22px. The height is also set outright: the Chromium of older VS Code versions
 * (measured in 124 and 128) does not take a line height below the font's own for a text box,
 * which made the box 21.3px high there.
 * The page number is set against the right edge of its box, so that box has 6px at the
 * sides to keep it off the edge; the zoom, centred, needs only 2px. Every control in the left,
 * middle and right groups sits one {@link TOOLBAR_GAP} from the next, and a divider has a
 * {@link DIVIDER_MARGIN} more on each side, so the viewer's own spacing (its spacer between the
 * sidebar button and search, which it also closes on narrow windows, the 1px between buttons, and
 * the margin of the page count) is replaced. The stock separator before the more button, and the
 * button itself, are not used: document properties sits beside Save, drawn with the viewer's own info
 * icon. That icon is named by its address, because the viewer's variable for it holds a relative
 * address, which a style block of this page would resolve against the page.
 */
function controlsStyle(webRoot: string): string {
    const infoIcon = cssUrl(`${webRoot}images/secondaryToolbarButton-documentProperties.svg`);
    return `
    :root {
        --toolbar-height: ${TOOLBAR_HEIGHT}px;
        --icon-size: ${ICON_SIZE}px;
        --toolbar-bg-color: var(--lpdf-header-bg);
        --body-bg-color: var(--lpdf-desk-bg);
        --toolbarButton-zoomOut-icon: var(--lpdf-icon-minus);
        --toolbarButton-zoomIn-icon: var(--lpdf-icon-plus);
    }
    .lpdf-hidden { display: none !important; }
    #toolbarViewerLeft, #toolbarViewerMiddle, #toolbarViewerRight,
    #toolbarViewerLeft > .toolbarHorizontalGroup, #toolbarViewerMiddle > .toolbarHorizontalGroup,
    #toolbarViewerRight > .toolbarHorizontalGroup { gap: ${TOOLBAR_GAP}px; }
    #toolbarContainer #toolbarViewer .toolbarButtonSpacer { display: none; }
    #toolbarContainer #toolbarViewer .verticalToolbarSeparator { margin-inline: ${DIVIDER_MARGIN}px; }
    #toolbarContainer #toolbarViewer #numPages { margin: 0; padding-inline: 0; }
    #toolbarContainer #toolbarViewer .toolbarField {
        box-sizing: border-box; height: calc(var(--icon-size) + 4px);
        font-size: 12px; line-height: calc(var(--icon-size) - 2px); padding-block: 2px;
    }
    #toolbarContainer #toolbarViewer #pageNumber { width: 4ch; padding-inline: 6px; }
    #toolbarContainer #toolbarViewer #lpdfZoomInput { width: 5.5ch; padding-inline: 2px; text-align: center; }
    #toolbarViewerRight > .verticalToolbarSeparator { display: none; }
    #lpdfFitButton[data-next="width"]::before {
        -webkit-mask-image: var(--lpdf-icon-fit-width); mask-image: var(--lpdf-icon-fit-width);
    }
    #lpdfFitButton[data-next="page"]::before {
        -webkit-mask-image: var(--lpdf-icon-fit-page); mask-image: var(--lpdf-icon-fit-page);
    }
    #lpdfTwoPageButton::before {
        -webkit-mask-image: var(--lpdf-icon-two-page); mask-image: var(--lpdf-icon-two-page);
    }
    #lpdfCoverButton::before {
        -webkit-mask-image: var(--lpdf-icon-cover); mask-image: var(--lpdf-icon-cover);
    }
    #documentProperties::before {
        -webkit-mask-image: ${infoIcon}; mask-image: ${infoIcon};
    }
`;
}

/**
 * The viewer spreads its toolbar's left, middle and right groups apart, which centres the middle
 * one only while the other two are about as wide. Letting the left and right groups share the
 * free space equally keeps the middle one centred; on a window too narrow for that, each group
 * keeps its own width and the middle is pushed aside. The viewer also refuses to be narrower than
 * 350px, which a narrow editor column is; without that minimum it follows the column.
 */
const TOOLBAR_STYLE = `
    #mainContainer { min-width: 0; }
    #toolbarContainer #toolbarViewer #toolbarViewerLeft,
    #toolbarContainer #toolbarViewer #toolbarViewerRight { flex: 1 1 0; }
    #toolbarContainer #toolbarViewer #toolbarViewerLeft { justify-content: flex-start; }
    #toolbarContainer #toolbarViewer #toolbarViewerRight { justify-content: flex-end; }
`;

/** The orange of the Lpdf mark (media/lpdf-mark.svg), and the near-black that reads on it: 5.4:1, where white would be 3.4:1. */
const BRAND_ORANGE = '#d76f04';
const TEXT_ON_BRAND = '#15141a';

/** The height of the buttons in the header of the Pages panel, which the viewer sets at 32px. */
const PANEL_BUTTON_SIZE = 32;

/** The width of the ring round the current and the hovered page: the viewer's is 6px, which is loud. */
const PAGE_RING_WIDTH = 2;

/** The gap between the pages of the Pages panel: half the viewer's 44px. */
const PAGE_GAP = 22;

/**
 * The Pages panel, made to sit with the toolbar above it.
 *
 * - Its header is as high as the toolbar: the viewer pads the row of buttons by 12px above and
 *   below, which makes it 56px, and here it has what is left of the toolbar height round its 32px buttons.
 * - Its background, and that of its header, are the toolbar's, in place of the viewer's own
 *   translucent panel colours, so the blur behind them goes too.
 * - The current page and the page under the mouse are ringed in {@link PAGE_RING_WIDTH}px, the
 *   current one in the brand orange, with dark text on the orange page number: 5.4:1, where white
 *   would be 3.4:1. The viewer draws both rings from one width, so this is the one setting.
 * - The pages are {@link PAGE_GAP}px apart.
 *
 * The viewer sets these colours on the panel itself, so the panel is what is named here, and its
 * own selectors are repeated to outrank its rules. When the system forces its colours the
 * viewer's colours stay: it draws the rings as outlines in system colours.
 */
const PAGES_PANEL_STYLE = `
    #viewsManager #viewsManagerHeader #viewsManagerTitle { padding-block: calc((var(--toolbar-height) - ${PANEL_BUTTON_SIZE}px) / 2); }
    #viewsManager #viewsManagerContent #thumbnailsView { gap: ${PAGE_GAP}px; }
    @media not (forced-colors: active) {
        #viewsManager {
            --sidebar-bg-color: var(--toolbar-bg-color);
            --sidebar-backdrop-filter: none;
            --header-bg: var(--toolbar-bg-color);
            --image-border-width: ${PAGE_RING_WIDTH}px;
            --image-current-border-color: ${BRAND_ORANGE};
            --image-current-page-number-fg: ${TEXT_ON_BRAND};
        }
    }
`;

/**
 * The dialogs (document properties, and the password a locked PDF asks for) take the toolbar's
 * background, in place of the viewer's own panel colour, so they sit with the header they open
 * from. Under forced colours the viewer's system colours stay.
 */
const DIALOG_STYLE = `
    @media not (forced-colors: active) {
        dialog { background-color: var(--toolbar-bg-color); }
    }
`;

/**
 * The pages cast the shadow that the pages of the diff view cast, from the same token of
 * lpdf-theme.css. The viewer gives each page a 9px border that is transparent, so a shadow on the
 * page itself would stand 9px off its edge; the shadow is on a pseudo-element that covers the page
 * inside that border instead. It paints nothing inside its own box, so the page shows as it did,
 * and it takes no clicks. Under forced colours the viewer's outline round each page stays.
 */
const PAGE_SHADOW_STYLE = `
    @media not (forced-colors: active) {
        .pdfViewer .page::before {
            content: ''; position: absolute; inset: 0; pointer-events: none;
            box-shadow: var(--lpdf-page-shadow);
        }
    }
`;

/**
 * Toolbar widths, in px, at and below which the toolbar drops a control, one after another as it
 * narrows. Measured with a three-digit page count: all controls need 509px, without the page
 * buttons 433px, without the page count too 392px, without the fit toggle as well 336px, and
 * without the zoom buttons 260px. Each limit is 14px above the need of the controls it drops,
 * which leaves room for a longer page count and for a system font wider than the one measured.
 */
const DROP_PAGE_VIEW_BUTTONS_BELOW = 523;
const DROP_PAGE_COUNT_BELOW = 447;
const DROP_FIT_TOGGLE_BELOW = 406;
const DROP_ZOOM_BUTTONS_BELOW = 350;

/**
 * The viewer hides parts of its toolbar by window width, which ignores the sidebar taking space
 * from the toolbar and hides controls that would still fit. This drops them by the width of the
 * toolbar itself, and only when they no longer fit: the two page and cover buttons first, then the
 * page count, the fit toggle and the zoom buttons. The sidebar button, search, the page box, the
 * zoom field, save and document properties always stay.
 */
const RESPONSIVE_STYLE = `
    #toolbarContainer { container-type: inline-size; }
    @container (max-width: ${DROP_PAGE_VIEW_BUTTONS_BELOW}px) { .lpdf-pages { display: none; } }
    @container (max-width: ${DROP_PAGE_COUNT_BELOW}px) { #numPages { display: none; } }
    @container (max-width: ${DROP_FIT_TOGGLE_BELOW}px) { .lpdf-fit { display: none; } }
    @container (max-width: ${DROP_ZOOM_BUTTONS_BELOW}px) { #zoomOutButton, #zoomInButton { display: none; } }
`;

const STATUS_STYLE = `
    #lpdf-status {
        position: fixed; inset: 0; z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        background: var(--body-bg-color, #525659); color: var(--main-color, #ccc);
        font: 14px/1.6 sans-serif; text-align: center; padding: 16px;
    }
    #lpdf-status[hidden] { display: none; }
    #lpdf-status.error { color: #e88; }
`;

/** The `<body>` inner markup of the stock viewer page. */
function extractBody(viewerHtml: string): { attributes: string; markup: string } {
    const match = /<body([^>]*)>([\s\S]*)<\/body>/i.exec(viewerHtml);
    if (!match) { throw new ViewerMarkupError('viewer.html has no <body> element'); }
    return { attributes: match[1], markup: match[2] };
}

/** The markup without the classes that hide parts of the toolbar by window width. */
function withoutWindowWidthClasses(markup: string): string {
    return WINDOW_WIDTH_CLASSES.reduce((result, name) => result.replace(new RegExp(String.raw`\s*\b${name}\b`, 'g'), ''), markup);
}

/** A URI that ends in `/`, so file names can be appended to it. */
function directoryUri(uri: string): string {
    return uri.endsWith('/') ? uri : `${uri}/`;
}

/** Text that is safe inside a double-quoted HTML attribute. */
function attributeValue(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** JSON that is safe to place inside a `<script type="application/json">` block. */
function jsonForScriptBlock(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Builds the webview page that shows PDFs in the stock PDF.js viewer.
 *
 * The vendored `viewer.html` is not edited: its body markup is reused as it is, and the head is
 * replaced with one that carries the webview's CSP and loads the viewer through `lpdf-host.mjs`.
 * That script starts the viewer itself, because the worker has to be set up before the viewer runs.
 *
 * @param options The viewer page, where the viewer files are served from, and the webview's CSP source and nonce.
 * @returns The complete HTML document.
 * @throws {ViewerMarkupError} When `viewerHtml` has no `<body>`.
 */
export function buildViewerHtml(options: ViewerHtmlOptions): string {
    const root = directoryUri(options.viewerRoot);
    const webRoot = `${root}web/`;
    const body = extractBody(options.viewerHtml);
    const config = {
        pdfjsUri: `${root}build/pdf.mjs`,
        workerUri: `${root}build/pdf.worker.mjs`,
        viewerUri: `${webRoot}viewer.mjs`,
        webRoot,
    };
    const csp = buildPdfjsCsp({ cspSource: options.cspSource, nonce: options.nonce });
    const hiddenControls = `${HIDDEN_CONTROLS.join(', ')} { display: none !important; }`;

    return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${attributeValue(csp)}">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <title>Lpdf Viewer</title>
    <link rel="resource" type="application/l10n" href="${attributeValue(webRoot)}locale/locale.json">
    <link rel="stylesheet" href="${attributeValue(webRoot)}viewer.css">
    <link rel="stylesheet" href="${attributeValue(root)}lpdf-theme.css">
    <style>${PAGE_RESET_STYLE}${TOOLBAR_STYLE}${controlsStyle(webRoot)}${PAGES_PANEL_STYLE}${DIALOG_STYLE}${PAGE_SHADOW_STYLE}${RESPONSIVE_STYLE}${STATUS_STYLE}    ${hiddenControls}
    </style>
    <script type="application/json" id="lpdf-viewer-config">${jsonForScriptBlock(config)}</script>
    <script type="module" nonce="${attributeValue(options.nonce)}" src="${attributeValue(root)}lpdf-host.mjs"></script>
</head>
<body${body.attributes}>${withoutWindowWidthClasses(body.markup)}
    <div id="lpdf-status">Rendering&#x2026;</div>
</body>
</html>
`;
}
