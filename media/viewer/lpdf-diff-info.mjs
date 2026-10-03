/**
 * The document properties of the diff view (media/pdf-diff.html): the properties of the HEAD
 * document and of the working copy side by side, as the full viewer's own dialog lists them, with
 * the ones that differ marked. The dialog's text and its formats are the viewer's, which is
 * English with the formats of en-US, the only language the viewer ships, so a figure reads the
 * same here as there.
 */

/** The language of the viewer's strings and of its number and date formats. */
const LOCALE = 'en-US';

/** What the viewer shows for a property that a document does not have. */
const MISSING = '-';

/** The pages the viewer names, by their size in inches and in millimetres, portrait: width by height. */
const US_PAGE_NAMES = { '8.5x11': 'Letter', '8.5x14': 'Legal' };
const METRIC_PAGE_NAMES = { '297x420': 'A3', '210x297': 'A4' };

/** How far, in millimetres, a page may be from a named size and still be called by its name. */
const NAME_TOLERANCE_MM = 0.1;

const MM_PER_INCH = 25.4;
const POINTS_PER_INCH = 72;

/**
 * The properties, in the groups and with the labels of the viewer's dialog. Each is a property's
 * name in what {@link readDocumentProperties} returns, and its label.
 */
export const PROPERTY_GROUPS = [
    [['fileName', 'File name:'], ['fileSize', 'File size:']],
    [
        ['title', 'Title:'], ['author', 'Author:'], ['subject', 'Subject:'], ['keywords', 'Keywords:'],
        ['creationDate', 'Creation Date:'], ['modificationDate', 'Modification Date:'], ['creator', 'Creator:'],
    ],
    [['producer', 'PDF Producer:'], ['version', 'PDF Version:'], ['pageCount', 'Page Count:'], ['pageSize', 'Page Size:']],
    [['linearized', 'Fast Web View:']],
];

/**
 * A size in bytes as the viewer writes it: kilobytes, or megabytes from one up, with three
 * significant digits, and the bytes in brackets.
 * @param {number} bytes The size of the file.
 * @returns {string | undefined} The text, or undefined for an empty file.
 */
export function formatFileSize(bytes) {
    const kilobytes = bytes / 1024;
    if (!kilobytes) { return undefined; }
    const megabytes = kilobytes / 1024;
    const figure = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 });
    const exact = new Intl.NumberFormat(LOCALE).format(bytes);
    return megabytes >= 1
        ? `${figure.format(megabytes)} MB (${exact} bytes)`
        : `${figure.format(kilobytes)} KB (${exact} bytes)`;
}

/** The name of a size in a table of names, whichever way up the page is. */
function pageNameOf(size, isPortrait, names) {
    const width = isPortrait ? size.width : size.height;
    const height = isPortrait ? size.height : size.width;
    return names[`${width}x${height}`];
}

/**
 * A page's size as the viewer writes it, in inches: `8.27 × 11.69 in (A4, portrait)`, with the
 * name left out for a size it has none for.
 * @param {{ view: number[], userUnit?: number, rotate?: number }} page A PDF.js page: its box in
 *     points, the size of a unit and its own rotation.
 * @returns {string}
 */
export function formatPageSize({ view, userUnit = 1, rotate = 0 }) {
    const [x1, y1, x2, y2] = view;
    const width = (x2 - x1) / POINTS_PER_INCH * userUnit;
    const height = (y2 - y1) / POINTS_PER_INCH * userUnit;
    const turned = rotate % 180 !== 0;
    const inches = turned ? { width: height, height: width } : { width, height };
    const isPortrait = inches.width <= inches.height;

    let rounded = { width: Math.round(inches.width * 100) / 100, height: Math.round(inches.height * 100) / 100 };
    const millimetres = {
        width: Math.round(inches.width * MM_PER_INCH * 10) / 10,
        height: Math.round(inches.height * MM_PER_INCH * 10) / 10,
    };
    let name = pageNameOf(rounded, isPortrait, US_PAGE_NAMES) || pageNameOf(millimetres, isPortrait, METRIC_PAGE_NAMES);

    // A page that is whole millimetres off a metric size is that size: A4 drawn at 595.28 by 841.89 points.
    if (!name && !(Number.isInteger(millimetres.width) && Number.isInteger(millimetres.height))) {
        const whole = { width: Math.round(millimetres.width), height: Math.round(millimetres.height) };
        const near = Math.abs(inches.width * MM_PER_INCH - whole.width) < NAME_TOLERANCE_MM
            && Math.abs(inches.height * MM_PER_INCH - whole.height) < NAME_TOLERANCE_MM;
        name = near ? pageNameOf(whole, isPortrait, METRIC_PAGE_NAMES) : undefined;
        if (name) {
            rounded = { width: Math.round(whole.width / MM_PER_INCH * 100) / 100, height: Math.round(whole.height / MM_PER_INCH * 100) / 100 };
        }
    }

    const number = new Intl.NumberFormat(LOCALE);
    const orientation = isPortrait ? 'portrait' : 'landscape';
    const size = `${number.format(rounded.width)} × ${number.format(rounded.height)} in`;
    return name ? `${size} (${name}, ${orientation})` : `${size} (${orientation})`;
}

/**
 * A date as the viewer writes it: the short date and the time to the second, in the viewer's time zone.
 * @param {Date | null | undefined} date
 * @returns {string | undefined}
 */
function formatDate(date) {
    return date ? new Intl.DateTimeFormat(LOCALE, { dateStyle: 'short', timeStyle: 'medium' }).format(date) : undefined;
}

/**
 * A date of the document: the one in its XMP metadata when that reads, else the one in its
 * information dictionary, which is how the viewer chooses too.
 */
function dateOf(metadataDate, infoDate, parseDate) {
    const fromMetadata = Date.parse(metadataDate);
    return formatDate(fromMetadata ? new Date(fromMetadata) : parseDate(infoDate));
}

/**
 * The title: the one in the XMP metadata unless it is the placeholder "Untitled" or has the
 * unassigned characters that a broken encoder leaves, else the one in the information dictionary.
 */
function titleOf(info, metadata) {
    const title = metadata?.get('dc:title');
    if (title && title !== 'Untitled' && !/[￰-￿]/.test(title)) { return title; }
    return info.Title;
}

/**
 * Reads the properties of a document that the viewer's dialog lists, as the viewer reads them:
 * from the XMP metadata first, else from the information dictionary.
 * @param {object} pdfDocument A PDF.js document.
 * @param {{ fileName: string, byteLength: number, parseDate: (value: unknown) => Date | null }} options
 *     The name and size of the file, which the document does not know, and PDF.js's reader of
 *     the date strings of a PDF.
 * @returns {Promise<Record<string, string | number | undefined>>} Each property, by the names of
 *     {@link PROPERTY_GROUPS}; undefined for one the document does not have.
 */
export async function readDocumentProperties(pdfDocument, { fileName, byteLength, parseDate }) {
    const { info = {}, metadata = null } = await pdfDocument.getMetadata();
    // The dialog of the viewer describes the page it is on; this one describes the first.
    const page = await pdfDocument.getPage(1);
    return {
        fileName,
        fileSize: formatFileSize(byteLength),
        title: titleOf(info, metadata),
        author: metadata?.get('dc:creator')?.join('\n') || info.Author,
        subject: metadata?.get('dc:subject')?.join('\n') || info.Subject,
        keywords: metadata?.get('pdf:keywords') || info.Keywords,
        creationDate: dateOf(metadata?.get('xmp:createdate'), info.CreationDate, parseDate),
        modificationDate: dateOf(metadata?.get('xmp:modifydate'), info.ModDate, parseDate),
        creator: metadata?.get('xmp:creatortool') || info.Creator,
        producer: metadata?.get('pdf:producer') || info.Producer,
        version: info.PDFFormatVersion,
        pageCount: pdfDocument.numPages,
        pageSize: formatPageSize(page),
        linearized: info.IsLinearized ? 'Yes' : 'No',
    };
}

/** What a property reads as: its text, or the viewer's dash for a document that does not have it. */
function shown(value) {
    return value || value === 0 ? String(value) : MISSING;
}

/**
 * Puts the properties of two documents side by side.
 * @param {Record<string, unknown>} left The properties of the first document, from {@link readDocumentProperties}.
 * @param {Record<string, unknown>} right The properties of the second.
 * @returns {{ groups: { id: string, label: string, left: string, right: string, changed: boolean }[][], changed: number, total: number }}
 *     The rows in the groups of the viewer's dialog, each with the two texts and whether they
 *     differ; and how many rows differ out of how many there are.
 */
export function compareProperties(left, right) {
    const groups = PROPERTY_GROUPS.map(group => group.map(([id, label]) => {
        const [first, second] = [shown(left[id]), shown(right[id])];
        return { id, label, left: first, right: second, changed: first !== second };
    }));
    const rows = groups.flat();
    return { groups, changed: rows.filter(row => row.changed).length, total: rows.length };
}

/**
 * One line that says how the two documents compare.
 * @param {{ changed: number, total: number }} comparison From {@link compareProperties}.
 * @returns {string}
 */
export function summarizeComparison({ changed, total }) {
    if (changed === 0) { return 'The two documents have the same properties.'; }
    return `${changed} of ${total} properties ${changed === 1 ? 'differs' : 'differ'}.`;
}

/**
 * Fills the body of the dialog's table with the rows of a comparison: the groups apart by a gap
 * row, and a row that differs marked with a class and with text for those who do not see the
 * colour. The text of a document is put in as text, never as markup.
 * @param {HTMLTableSectionElement} body The `<tbody>` to fill; what it holds is replaced.
 * @param {{ groups: { label: string, left: string, right: string, changed: boolean }[][] }} comparison
 *     From {@link compareProperties}.
 */
export function fillComparisonTable(body, { groups }) {
    const document = body.ownerDocument;
    const make = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text !== undefined) { element.textContent = text; }
        if (className) { element.className = className; }
        return element;
    };
    const rows = [];
    groups.forEach((group, index) => {
        if (index > 0) {
            const gap = make('tr', undefined, 'info-gap');
            const cell = make('td');
            cell.colSpan = 3;
            gap.append(cell);
            rows.push(gap);
        }
        for (const entry of group) {
            const row = make('tr', undefined, entry.changed ? 'changed' : undefined);
            const label = make('th', entry.label);
            label.scope = 'row';
            if (entry.changed) { label.append(make('span', ' (differs)', 'visually-hidden')); }
            row.append(label, make('td', entry.left), make('td', entry.right));
            rows.push(row);
        }
    });
    body.replaceChildren(...rows);
}
