import { describe, expect, it } from 'vitest';
import { Anchor, anchorsOf, headingKey, lineAtPosition, markdownHeadings, pairHeadings, positionAtLine, titleKey, TOP_OF_PDF } from './markdown-headings';

describe('headingKey', () => {
    it('is the letters and digits of the words in lower case', () => {
        expect(headingKey('Release Notes, v2.1!')).toBe('releasenotesv21');
    });

    it('is the same for the words as written and as the outline gives them', () => {
        expect(headingKey('Two *x* `c` [link](http://example.com/a?b=1)')).toBe(titleKey('Two x c link'));
        expect(headingKey('**Bold** and ~~struck~~ and _slanted_')).toBe(titleKey('Bold and struck and slanted'));
        expect(headingKey('Escaped \\* star')).toBe(titleKey('Escaped * star'));
    });

    it('leaves out an image and a footnote mark, which are not part of a label', () => {
        expect(headingKey('Logo ![the logo](logo.png) here[^1]')).toBe(titleKey('Logo here'));
    });

    it('reads a break as a space', () => {
        expect(headingKey('one<br>two')).toBe(titleKey('one two'));
    });

    it('keeps the words of a reference link', () => {
        expect(headingKey('See [the guide][guide]')).toBe(titleKey('See the guide'));
    });

    it('keeps a tag that is in a span of code, which the outline has as text', () => {
        expect(headingKey('`<rect>`')).toBe(titleKey('<rect>'));
        expect(headingKey('The `<line>` and <br> the ``<b>`` element')).toBe(titleKey('The <line> and the <b> element'));
    });

    it('keeps letters beyond ASCII', () => {
        expect(headingKey('Größe und Übersicht')).toBe('größeundübersicht');
    });

    it('is empty for a heading with no words', () => {
        expect(headingKey(' ** ')).toBe('');
    });
});

describe('titleKey', () => {
    it('is the letters and digits of the title in lower case, the characters of a tag included', () => {
        expect(titleKey('Release Notes, v2.1!')).toBe('releasenotesv21');
        expect(titleKey('<rect>')).toBe('rect');
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

    it('pairs a heading that is a tag in a span of code with its entry', () => {
        expect(pairHeadings('# `<rect>`\n\n# `<line>`\n', ['<rect>', '<line>'])).toEqual([
            { line: 0, entry: 0 },
            { line: 2, entry: 1 },
        ]);
    });

    it('has no pairs for an empty outline, or a file with no headings', () => {
        expect(pairHeadings(TEXT, [])).toEqual([]);
        expect(pairHeadings('text only\n', ['One'])).toEqual([]);
    });
});

describe('anchorsOf', () => {
    it('are the top of both, the heading of each pair, and the end of both', () => {
        expect(anchorsOf([{ line: 2, entry: 0 }, { line: 10, entry: 1 }], 2, 30)).toEqual([
            { line: 0, position: TOP_OF_PDF },
            { line: 2, position: 0 },
            { line: 10, position: 1 },
            { line: 29, position: 2 },
        ]);
    });

    it('are only the top and the end for a file with no pairs', () => {
        expect(anchorsOf([], 0, 5)).toEqual([{ line: 0, position: TOP_OF_PDF }, { line: 4, position: 0 }]);
    });

    it('end at the last heading when the file has fewer lines than that, as when the text has just been cut', () => {
        expect(anchorsOf([{ line: 8, entry: 0 }], 1, 3).at(-1)).toEqual({ line: 8, position: 1 });
    });
});

describe('positionAtLine and lineAtPosition', () => {
    // Headings at lines 10 and 30 of a file of 51 lines, which are entries 0 and 1 of an outline of 3.
    const ANCHORS: Anchor[] = [
        { line: 0, position: TOP_OF_PDF },
        { line: 10, position: 0 },
        { line: 30, position: 1 },
        { line: 50, position: 3 },
    ];

    it('puts a heading at the position of its entry', () => {
        expect(positionAtLine(ANCHORS, 10)).toBe(0);
        expect(positionAtLine(ANCHORS, 30)).toBe(1);
    });

    it('puts the top and the end of the file at the top and the end of the PDF', () => {
        expect(positionAtLine(ANCHORS, 0)).toBe(TOP_OF_PDF);
        expect(positionAtLine(ANCHORS, 50)).toBe(3);
    });

    it('puts a line between two headings the same fraction of the way along', () => {
        expect(positionAtLine(ANCHORS, 20)).toBeCloseTo(0.5);
        expect(positionAtLine(ANCHORS, 5)).toBeCloseTo(-0.5);
        expect(positionAtLine(ANCHORS, 35)).toBeCloseTo(1.5);
    });

    it('spreads the entries that have no heading in the file over the stretch between the headings that do', () => {
        expect(positionAtLine(ANCHORS, 40)).toBeCloseTo(2);
    });

    it('puts a line past the end of the file at the end of the PDF', () => {
        expect(positionAtLine(ANCHORS, 500)).toBe(3);
    });

    it('is, for a heading on the first line, the position of its entry', () => {
        const heading = [{ line: 0, position: TOP_OF_PDF }, { line: 0, position: 0 }, { line: 9, position: 1 }];
        expect(positionAtLine(heading, 0)).toBe(0);
        expect(positionAtLine(heading, 3)).toBeCloseTo(1 / 3);
    });

    it('goes the other way: a position is the line it came from', () => {
        for (const line of [0, 3, 10, 17.5, 30, 41, 50]) {
            expect(lineAtPosition(ANCHORS, positionAtLine(ANCHORS, line))).toBeCloseTo(line);
        }
    });

    it('puts a position between two entries the same fraction of the way along the lines', () => {
        expect(lineAtPosition(ANCHORS, 0.25)).toBeCloseTo(15);
        expect(lineAtPosition(ANCHORS, 2)).toBeCloseTo(40);
    });

    it('puts a position past the end of the PDF at the end of the file', () => {
        expect(lineAtPosition(ANCHORS, 7)).toBe(50);
    });
});
