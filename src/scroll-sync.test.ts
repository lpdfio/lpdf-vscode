import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR_SETTLE_MS, MarkdownSource, ScrollSync } from './scroll-sync';

/** Headings on lines 2, 4 and 6 of 8 lines; the end of the file is line 7. */
const TEXT = 'preamble\n\n# One\n\n## Two\n\n# Three\n';
const TITLES = ['One', 'Two', 'Three'];

describe('ScrollSync', () => {
    let calls: string[];
    let now: number;
    let source: MarkdownSource & { text: string };
    let sync: ScrollSync;

    const edit = (text: string): void => {
        source.text = text;
        (source as { version: number }).version++;
        (source as { lineCount: number }).lineCount = text.split('\n').length;
    };

    beforeEach(() => {
        calls = [];
        now = 10_000;
        source = { version: 1, lineCount: 8, text: TEXT, getText() { return this.text; } };
        sync = new ScrollSync({
            scrollPreviewTo: position => calls.push(`preview ${position}`),
            revealLine: line => calls.push(`editor ${line}`),
        }, () => now);
        sync.outlineChanged(TITLES);
    });

    describe('when the editor moves', () => {
        it('scrolls the preview to the position of the line at the top', () => {
            sync.editorMoved(source, 4);
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1', 'preview 1.5']);
        });

        it('scrolls the preview part way into a section for a line part way into it', () => {
            sync.editorMoved(source, 3);
            expect(calls).toEqual(['preview 0.5']);
        });

        it('scrolls the preview part way down the top of the PDF for a line above the first heading', () => {
            sync.editorMoved(source, 1);
            sync.editorMoved(source, 0);
            expect(calls).toEqual(['preview -0.5', 'preview -1']);
        });

        it('scrolls the preview to the end of the PDF for the end of the file', () => {
            sync.editorMoved(source, 7);
            expect(calls).toEqual(['preview 3']);
        });

        it('sends nothing when the line has not changed', () => {
            sync.editorMoved(source, 5);
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1.5']);
        });

        it('sends nothing before the preview has drawn a PDF with an outline', () => {
            sync.reset();
            sync.editorMoved(source, 5);
            expect(calls).toEqual([]);
        });

        it('sends nothing for a file with no headings', () => {
            edit('just text\n\nand more\n');
            sync.editorMoved(source, 1);
            expect(calls).toEqual([]);
        });

        it('goes through a heading written since the PDF was drawn as if it were not there', () => {
            edit('preamble\n\n# One\n\n## New and unsaved\n\n## Two\n\n# Three\n');
            sync.editorMoved(source, 4);
            sync.editorMoved(source, 6);
            expect(calls).toEqual(['preview 0.5', 'preview 1']);
        });

        it('works out the headings again after the text has been edited', () => {
            sync.editorMoved(source, 4);
            edit('one line more\n' + TEXT);
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1', 'preview 1']);
        });
    });

    describe('when the preview moves', () => {
        it('scrolls the editor to the line at the position', () => {
            sync.previewMoved(source, 1.5);
            expect(calls).toEqual(['editor 5']);
        });

        it('scrolls the editor to the nearest line', () => {
            sync.previewMoved(source, 0.4);
            sync.previewMoved(source, 0.1);
            expect(calls).toEqual(['editor 3', 'editor 2']);
        });

        it('scrolls the editor to the top of the file for the top of the PDF, and the end for the end', () => {
            sync.previewMoved(source, -1);
            now += EDITOR_SETTLE_MS;
            sync.previewMoved(source, 3);
            expect(calls).toEqual(['editor 0', 'editor 7']);
        });

        it('sends nothing when the line has not changed', () => {
            sync.previewMoved(source, 1.5);
            sync.previewMoved(source, 1.51);
            expect(calls).toEqual(['editor 5']);
        });

        it('sends nothing for a file with no headings', () => {
            edit('just text\n');
            sync.previewMoved(source, 1);
            expect(calls).toEqual([]);
        });

        it('spreads an entry that has no heading in the file over the stretch between the headings that do', () => {
            sync.outlineChanged(['One', 'Missing', 'Three']);
            sync.previewMoved(source, 1);
            expect(calls).toEqual(['editor 4']);
        });
    });

    describe('when one side answers the other', () => {
        it('passes over the editor\'s own events just after the preview scrolled it', () => {
            sync.previewMoved(source, 2);
            // The editor settles a line short of the heading, as it does at the end of a file.
            now += 50;
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['editor 6']);
        });

        it('takes the editor\'s events again once it has settled', () => {
            sync.previewMoved(source, 2);
            now += EDITOR_SETTLE_MS;
            sync.editorMoved(source, 3);
            expect(calls).toEqual(['editor 6', 'preview 0.5']);
        });

        it('does not scroll the preview back for the editor arriving at the line it was sent to', () => {
            sync.previewMoved(source, 1.5);
            now += EDITOR_SETTLE_MS * 2;
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['editor 5']);
        });

        it('does not scroll the editor back for the preview arriving at the place it was sent to', () => {
            sync.editorMoved(source, 5);
            sync.previewMoved(source, 1.5);
            expect(calls).toEqual(['preview 1.5']);
        });

        it('lets the editor drive again after the preview did, back to a line it had before', () => {
            sync.editorMoved(source, 5);
            sync.previewMoved(source, 2);
            now += EDITOR_SETTLE_MS;
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1.5', 'editor 6', 'preview 1.5']);
        });
    });

    describe('when the preview draws a new PDF', () => {
        it('sends the editor\'s line again, to a preview that has lost its place', () => {
            sync.editorMoved(source, 5);
            sync.outlineChanged(TITLES);
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1.5', 'preview 1.5']);
        });

        it('pairs the headings with the new outline', () => {
            sync.outlineChanged(['Three']);
            sync.editorMoved(source, 6);
            expect(calls).toEqual(['preview 0']);
        });
    });
});
