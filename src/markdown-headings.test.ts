import { describe, expect, it } from 'vitest';
import { BEFORE_FIRST_ENTRY, entryAtLine, headingKey, lineOfEntry, markdownHeadings, pairHeadings } from './markdown-headings';

describe('headingKey', () => {
    it('is the letters and digits of the words in lower case', () => {
        expect(headingKey('Release Notes, v2.1!')).toBe('releasenotesv21');
    });

    it('is the same for the words as written and as the outline gives them', () => {
        expect(headingKey('Two *x* `c` [link](http://example.com/a?b=1)')).toBe(headingKey('Two x c link'));
        expect(headingKey('**Bold** and ~~struck~~ and _slanted_')).toBe(headingKey('Bold and struck and slanted'));
        expect(headingKey('Escaped \\* star')).toBe(headingKey('Escaped * star'));
    });

    it('leaves out an image and a footnote mark, which are not part of a label', () => {
        expect(headingKey('Logo ![the logo](logo.png) here[^1]')).toBe(headingKey('Logo here'));
    });

    it('reads a break as a space', () => {
        expect(headingKey('one<br>two')).toBe(headingKey('one two'));
    });

    it('keeps the words of a reference link', () => {
        expect(headingKey('See [the guide][guide]')).toBe(headingKey('See the guide'));
    });

    it('keeps letters beyond ASCII', () => {
        expect(headingKey('Größe und Übersicht')).toBe('größeundübersicht');
    });

    it('is empty for a heading with no words', () => {
        expect(headingKey(' ** ')).toBe('');
    });
});

describe('markdownHeadings', () => {
    it('lists the headings of every level with their lines', () => {
        const text = '# One\n\ntext\n\n## Two\n\n###### Six\n';
        expect(markdownHeadings(text)).toEqual([
            { line: 0, key: 'one' },
            { line: 4, key: 'two' },
            { line: 6, key: 'six' },
        ]);
    });

    it('reads a heading up to three spaces in, and not one that is indented further', () => {
        expect(markdownHeadings('   # Three\n\n    # Code\n').map(heading => heading.line)).toEqual([0]);
    });

    it('does not read seven hashes, or a hash with no space after it', () => {
        expect(markdownHeadings('####### Seven\n\n#hashtag\n')).toEqual([]);
    });

    it('drops the closing hashes', () => {
        expect(markdownHeadings('## Title ##\n')).toEqual([{ line: 0, key: 'title' }]);
    });

    it('skips a heading with no words', () => {
        expect(markdownHeadings('#\n\n## \n\n# Real\n')).toEqual([{ line: 4, key: 'real' }]);
    });

    it('does not read a heading inside a fenced block of code, of either fence', () => {
        const text = '# Before\n\n```sh\n# a comment\n```\n\n~~~\n# another\n~~~\n\n# After\n';
        expect(markdownHeadings(text).map(heading => heading.key)).toEqual(['before', 'after']);
    });

    it('ends a fence only with one at least as long, of the same kind', () => {
        const text = '````\n# inside\n```\n# still inside\n~~~~\n# and inside\n````\n# out\n';
        expect(markdownHeadings(text).map(heading => heading.key)).toEqual(['out']);
    });

    it('reads a fence that is never closed as running to the end of the file', () => {
        expect(markdownHeadings('# One\n\n```\n# Two\n')).toEqual([{ line: 0, key: 'one' }]);
    });

    it('does not take a line of inline code that starts with three backticks for a fence', () => {
        expect(markdownHeadings('```code``` is code\n\n# Next\n')).toEqual([{ line: 2, key: 'next' }]);
    });

    it('does not read the front matter', () => {
        const text = '---\ntitle: Report\n# not a heading\n---\n\n# Real\n';
        expect(markdownHeadings(text)).toEqual([{ line: 5, key: 'real' }]);
    });

    it('reads a first line of three dashes with no closing one as no front matter', () => {
        expect(markdownHeadings('---\n\n# Real\n')).toEqual([{ line: 2, key: 'real' }]);
    });

    it('counts lines the same for every kind of line end', () => {
        expect(markdownHeadings('# One\r\n\r\n# Two\r\n')).toEqual([{ line: 0, key: 'one' }, { line: 2, key: 'two' }]);
        expect(markdownHeadings('# One\r\r# Two\r').map(heading => heading.line)).toEqual([0, 2]);
    });

    it('is empty for a file with no headings', () => {
        expect(markdownHeadings('just text\n\nand more\n')).toEqual([]);
    });
});

describe('pairHeadings', () => {
    const TEXT = '# One\n\n## Two\n\n### Three\n\n# Four\n';

    it('pairs each entry of the outline with the heading of the same words', () => {
        expect(pairHeadings(TEXT, ['One', 'Two', 'Three', 'Four'])).toEqual([
            { line: 0, entry: 0 },
            { line: 2, entry: 1 },
            { line: 4, entry: 2 },
            { line: 6, entry: 3 },
        ]);
    });

    it('passes over the headings that are not bookmarks, which the outline does not list', () => {
        expect(pairHeadings(TEXT, ['One', 'Two', 'Four'])).toEqual([
            { line: 0, entry: 0 },
            { line: 2, entry: 1 },
            { line: 6, entry: 2 },
        ]);
    });

    it('passes over a heading written since the PDF was drawn, and keeps the lines of the text as it is now', () => {
        const edited = '# One\n\n## New and unsaved\n\n## Two\n';
        expect(pairHeadings(edited, ['One', 'Two'])).toEqual([
            { line: 0, entry: 0 },
            { line: 4, entry: 1 },
        ]);
    });

    it('gives an entry with no heading in the file no pair, and pairs the ones after it', () => {
        expect(pairHeadings('# One\n\n# Three\n', ['One', 'Two', 'Three'])).toEqual([
            { line: 0, entry: 0 },
            { line: 2, entry: 2 },
        ]);
    });

    it('pairs headings that repeat in the order they are written', () => {
        expect(pairHeadings('# Notes\n\n# Notes\n\n# Notes\n', ['Notes', 'Notes', 'Notes'])).toEqual([
            { line: 0, entry: 0 },
            { line: 2, entry: 1 },
            { line: 4, entry: 2 },
        ]);
    });

    it('pairs a heading that has markup with its entry, which does not', () => {
        expect(pairHeadings('# The `code` and *style*\n', ['The code and style'])).toEqual([{ line: 0, entry: 0 }]);
    });

    it('has no pairs for an empty outline, or a file with no headings', () => {
        expect(pairHeadings(TEXT, [])).toEqual([]);
        expect(pairHeadings('text only\n', ['One'])).toEqual([]);
    });
});

describe('entryAtLine and lineOfEntry', () => {
    const PAIRS = [
        { line: 2, entry: 0 },
        { line: 10, entry: 1 },
        { line: 20, entry: 3 },
    ];

    it('puts a line in the section of the last heading at or above it', () => {
        expect(entryAtLine(PAIRS, 2)).toBe(0);
        expect(entryAtLine(PAIRS, 9)).toBe(0);
        expect(entryAtLine(PAIRS, 10)).toBe(1);
        expect(entryAtLine(PAIRS, 500)).toBe(3);
    });

    it('puts a line above the first heading before the first entry', () => {
        expect(entryAtLine(PAIRS, 0)).toBe(BEFORE_FIRST_ENTRY);
        expect(entryAtLine([], 5)).toBe(BEFORE_FIRST_ENTRY);
    });

    it('shows an entry at the line of its heading', () => {
        expect(lineOfEntry(PAIRS, 0)).toBe(2);
        expect(lineOfEntry(PAIRS, 3)).toBe(20);
    });

    it('shows an entry with no heading of the file at the heading before it', () => {
        expect(lineOfEntry(PAIRS, 2)).toBe(10);
    });

    it('shows the place above the first entry at the top of the file', () => {
        expect(lineOfEntry(PAIRS, BEFORE_FIRST_ENTRY)).toBe(0);
    });

    it('agree: the entry at the line of an entry is that entry, for the ones that have a heading', () => {
        for (const pair of PAIRS) {
            expect(entryAtLine(PAIRS, lineOfEntry(PAIRS, pair.entry))).toBe(pair.entry);
        }
    });
});
