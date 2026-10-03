// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
    compareProperties,
    fillComparisonTable,
    formatFileSize,
    formatPageSize,
    PROPERTY_GROUPS,
    readDocumentProperties,
    summarizeComparison,
} from '../media/viewer/lpdf-diff-info.mjs';

const A4 = { view: [0, 0, 595.28, 841.89], userUnit: 1, rotate: 0 };

/** The date format of the viewer, for a date that the test knows. */
const shortDate = (date: Date): string => new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' }).format(date);

/** A PDF.js document with the metadata and the first page that a test gives it. */
function documentOf({ info = {}, metadata = null, page = A4, numPages = 3 }: {
    info?: Record<string, unknown>;
    metadata?: Record<string, unknown> | null;
    page?: Record<string, unknown>;
    numPages?: number;
} = {}) {
    return {
        numPages,
        getMetadata: async () => ({ info, metadata: metadata && { get: (key: string) => metadata[key] } }),
        getPage: async () => page,
    };
}

const noDates = () => null;

describe('formatFileSize', () => {
    it('gives kilobytes with three significant digits, and the bytes', () => {
        expect(formatFileSize(64008)).toBe('62.5 KB (64,008 bytes)');
    });

    it('gives megabytes from one megabyte up', () => {
        expect(formatFileSize(2 * 1024 * 1024)).toBe('2 MB (2,097,152 bytes)');
        expect(formatFileSize(1500000)).toBe('1.43 MB (1,500,000 bytes)');
    });

    it('gives nothing for an empty file, as the viewer does', () => {
        expect(formatFileSize(0)).toBeUndefined();
    });
});

describe('formatPageSize', () => {
    it('names A4 and gives the size in inches, as the viewer does', () => {
        expect(formatPageSize(A4)).toBe('8.27 × 11.69 in (A4, portrait)');
    });

    it('names Letter, Legal and A3', () => {
        expect(formatPageSize({ view: [0, 0, 612, 792] })).toBe('8.5 × 11 in (Letter, portrait)');
        expect(formatPageSize({ view: [0, 0, 612, 1008] })).toBe('8.5 × 14 in (Legal, portrait)');
        expect(formatPageSize({ view: [0, 0, 841.89, 1190.55] })).toBe('11.69 × 16.54 in (A3, portrait)');
    });

    it('says landscape for a page that is wider than it is high, and still names it', () => {
        expect(formatPageSize({ view: [0, 0, 841.89, 595.28] })).toBe('11.69 × 8.27 in (A4, landscape)');
    });

    it('turns a page that is rotated by a quarter turn', () => {
        expect(formatPageSize({ ...A4, rotate: 90 })).toBe('11.69 × 8.27 in (A4, landscape)');
        expect(formatPageSize({ ...A4, rotate: 180 })).toBe('8.27 × 11.69 in (A4, portrait)');
    });

    it('scales a page by its user unit', () => {
        expect(formatPageSize({ view: [0, 0, 297.64, 420.945], userUnit: 2 })).toBe('8.27 × 11.69 in (A4, portrait)');
    });

    it('measures a page from its box, which need not start at zero', () => {
        expect(formatPageSize({ view: [10, 20, 622, 812] })).toBe('8.5 × 11 in (Letter, portrait)');
    });

    it('gives no name to a size that has none', () => {
        expect(formatPageSize({ view: [0, 0, 300, 400] })).toBe('4.17 × 5.56 in (portrait)');
    });

    it('calls a page that is a hair off a metric size by the name, as the viewer does', () => {
        expect(formatPageSize({ view: [0, 0, 595.42, 842.03] })).toBe('8.27 × 11.69 in (A4, portrait)');
    });
});

describe('readDocumentProperties', () => {
    const options = { fileName: 'report.pdf', byteLength: 64008, parseDate: noDates };

    it('reads what the viewer lists from the information dictionary', async () => {
        const properties = await readDocumentProperties(documentOf({
            info: {
                Title: 'Benchmark Fixture L', Author: 'Ada', Subject: 'Tests', Keywords: 'a, b', Creator: 'Maker',
                Producer: 'Lpdf (lpdf.io)', PDFFormatVersion: '1.7', IsLinearized: false,
            },
        }), options);
        expect(properties).toEqual({
            fileName: 'report.pdf',
            fileSize: '62.5 KB (64,008 bytes)',
            title: 'Benchmark Fixture L',
            author: 'Ada',
            subject: 'Tests',
            keywords: 'a, b',
            creationDate: undefined,
            modificationDate: undefined,
            creator: 'Maker',
            producer: 'Lpdf (lpdf.io)',
            version: '1.7',
            pageCount: 3,
            pageSize: '8.27 × 11.69 in (A4, portrait)',
            linearized: 'No',
        });
    });

    it('prefers the XMP metadata, and joins its lists of authors and subjects with line breaks', async () => {
        const properties = await readDocumentProperties(documentOf({
            info: { Title: 'Old', Author: 'Old', Subject: 'Old', Keywords: 'old', Creator: 'Old', Producer: 'Old' },
            metadata: {
                'dc:title': 'New', 'dc:creator': ['Ada', 'Grace'], 'dc:subject': ['One', 'Two'],
                'pdf:keywords': 'new', 'xmp:creatortool': 'New tool', 'pdf:producer': 'New producer',
            },
        }), options);
        expect(properties).toMatchObject({
            title: 'New', author: 'Ada\nGrace', subject: 'One\nTwo', keywords: 'new', creator: 'New tool', producer: 'New producer',
        });
    });

    it('falls back to the information title for an XMP title of Untitled or with unassigned characters', async () => {
        for (const bad of ['Untitled', 'Broken ￿ title']) {
            const properties = await readDocumentProperties(documentOf({ info: { Title: 'Real' }, metadata: { 'dc:title': bad } }), options);
            expect(properties.title).toBe('Real');
        }
    });

    it('reads a date from the XMP metadata first, then from the information dictionary', async () => {
        const fromInfo = new Date(Date.UTC(2020, 0, 1));
        const parseDate = (value: unknown) => (value === 'D:2020' ? fromInfo : null);
        const both = await readDocumentProperties(documentOf({
            info: { CreationDate: 'D:2020', ModDate: 'D:2020' },
            metadata: { 'xmp:createdate': '2024-05-06T07:08:09Z' },
        }), { ...options, parseDate });
        expect(both.creationDate).toBe(shortDate(new Date('2024-05-06T07:08:09Z')));
        expect(both.modificationDate).toBe(shortDate(fromInfo));
    });

    it('writes the date as the short date and the time to the second', async () => {
        const properties = await readDocumentProperties(documentOf({ info: { CreationDate: 'x' } }), {
            ...options, parseDate: () => new Date(2024, 4, 6, 7, 8, 9),
        });
        expect(properties.creationDate).toMatch(/^5\/6\/24, 7:08:09\sAM$/);
    });

    it('says Yes for a linearized document', async () => {
        const properties = await readDocumentProperties(documentOf({ info: { IsLinearized: true } }), options);
        expect(properties.linearized).toBe('Yes');
    });

    it('lets a failure to read the first page reach the caller', async () => {
        const broken = { ...documentOf(), getPage: async () => { throw new Error('page 1 is damaged'); } };
        await expect(readDocumentProperties(broken, options)).rejects.toThrow('page 1 is damaged');
    });
});

describe('compareProperties', () => {
    const same = { fileName: 'a.pdf', fileSize: '1 KB (1,024 bytes)', title: 'T', pageCount: 3 };

    it('lists the properties in the groups of the viewer, with its labels', () => {
        const { groups } = compareProperties(same, same);
        expect(groups.map(group => group.map(row => row.id))).toEqual(PROPERTY_GROUPS.map(group => group.map(([id]) => id)));
        expect(groups[0][0].label).toBe('File name:');
        expect(groups[2][3].label).toBe('Page Size:');
        expect(groups[3][0].label).toBe('Fast Web View:');
    });

    it('marks a property that differs, and only that one', () => {
        const { groups, changed, total } = compareProperties(same, { ...same, title: 'T2', pageCount: 3 });
        const rows = groups.flat();
        expect(rows.filter(row => row.changed).map(row => row.id)).toEqual(['title']);
        expect(rows.find(row => row.id === 'title')).toMatchObject({ left: 'T', right: 'T2' });
        expect(changed).toBe(1);
        expect(total).toBe(14);
    });

    it('shows a dash for a property a document does not have, and does not count two dashes as a difference', () => {
        const { groups } = compareProperties({ author: 'Ada' }, {});
        const rows = groups.flat();
        expect(rows.find(row => row.id === 'author')).toMatchObject({ left: 'Ada', right: '-', changed: true });
        expect(rows.find(row => row.id === 'subject')).toMatchObject({ left: '-', right: '-', changed: false });
    });

    it('compares a page count as the number it is, and a count of zero is not missing', () => {
        const { groups } = compareProperties({ pageCount: 0 }, { pageCount: 2 });
        expect(groups.flat().find(row => row.id === 'pageCount')).toMatchObject({ left: '0', right: '2', changed: true });
    });
});

describe('summarizeComparison', () => {
    it('says so when nothing differs', () => {
        expect(summarizeComparison({ changed: 0, total: 14 })).toBe('The two documents have the same properties.');
    });

    it('counts what differs, in the singular for one', () => {
        expect(summarizeComparison({ changed: 1, total: 14 })).toBe('1 of 14 properties differs.');
        expect(summarizeComparison({ changed: 3, total: 14 })).toBe('3 of 14 properties differ.');
    });
});

describe('fillComparisonTable', () => {
    function filled(left: Record<string, unknown>, right: Record<string, unknown>): HTMLTableSectionElement {
        document.body.innerHTML = '<table><tbody><tr><td>old</td></tr></tbody></table>';
        const body = document.querySelector('tbody') as HTMLTableSectionElement;
        fillComparisonTable(body, compareProperties(left, right));
        return body;
    }

    it('replaces what the body held with a row for each property, and a gap row between the groups', () => {
        const body = filled({}, {});
        expect(body.textContent).not.toContain('old');
        expect(body.querySelectorAll('tr:not(.info-gap)')).toHaveLength(14);
        expect(body.querySelectorAll('tr.info-gap')).toHaveLength(PROPERTY_GROUPS.length - 1);
    });

    it('puts the label, then the text of each document, in each row', () => {
        const body = filled({ title: 'Before' }, { title: 'After' });
        const row = [...body.querySelectorAll('tr')].find(candidate => candidate.querySelector('th')?.textContent?.startsWith('Title:')) as HTMLElement;
        expect([...row.children].map(cell => cell.tagName)).toEqual(['TH', 'TD', 'TD']);
        expect([...row.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['Before', 'After']);
    });

    it('marks a row that differs with a class and with text that a screen reader reads', () => {
        const body = filled({ title: 'Before' }, { title: 'After' });
        const changed = body.querySelectorAll('tr.changed');
        expect(changed).toHaveLength(1);
        expect(changed[0].querySelector('th')?.textContent).toBe('Title: (differs)');
        expect(changed[0].querySelector('.visually-hidden')).not.toBeNull();
    });

    it('puts a title that holds markup in as text, never as markup', () => {
        const hostile = '<img src=x onerror="alert(1)"><b>bold</b>';
        const body = filled({ title: hostile }, { title: hostile });
        expect(body.querySelector('img')).toBeNull();
        expect(body.querySelector('b')).toBeNull();
        expect(body.textContent).toContain(hostile);
    });
});
