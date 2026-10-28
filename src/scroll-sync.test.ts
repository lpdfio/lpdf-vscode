import { beforeEach, describe, expect, it } from 'vitest';
import { EDITOR_SETTLE_MS, MarkdownSource, ScrollSync } from './scroll-sync';

/** Headings on lines 2, 4 and 6; the lines before the first are above any section. */
const TEXT = 'preamble\n\n# One\n\n## Two\n\n# Three\n';
const TITLES = ['One', 'Two', 'Three'];

describe('ScrollSync', () => {
    let calls: string[];
    let now: number;
    let source: MarkdownSource & { text: string };
    let sync: ScrollSync;

    const edit = (text: string): void => { source.text = text; (source as { version: number }).version++; };

    beforeEach(() => {
        calls = [];
        now = 10_000;
        source = { version: 1, text: TEXT, getText() { return this.text; } };
        sync = new ScrollSync({
            scrollPreviewTo: entry => calls.push(`preview ${entry}`),
            revealLine: line => calls.push(`editor ${line}`),
        }, () => now);
        sync.outlineChanged(TITLES, -1);
    });

    describe('when the editor moves', () => {
        it('scrolls the preview to the heading above the line', () => {
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['preview 1']);
        });

        it('scrolls the preview to the top of the PDF for a line above the first heading', () => {
            sync.outlineChanged(TITLES, 2);
            sync.editorMoved(source, 0);
            expect(calls).toEqual(['preview -1']);
        });

        it('sends nothing while the line stays in one section', () => {
            sync.editorMoved(source, 5);
            sync.editorMoved(source, 5);
            sync.editorMoved(source, 4);
            expect(calls).toEqual(['preview 1']);
        });

        it('sends nothing for a line in the section the preview is at', () => {
            sync.outlineChanged(TITLES, 1);
            sync.editorMoved(source, 5);
            expect(calls).toEqual([]);
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

        it('keeps the preview where it is when a heading was written since the PDF was drawn', () => {
            sync.outlineChanged(TITLES, 0);
            edit('preamble\n\n# One\n\n## New and unsaved\n\n## Two\n\n# Three\n');
            sync.editorMoved(source, 5);
            expect(calls).toEqual([]);
        });

        it('works out the headings again after the text has been edited', () => {
            sync.editorMoved(source, 5);
            edit('one line more\n' + TEXT);
            sync.editorMoved(source, 7);
            expect(calls).toEqual(['preview 1', 'preview 2']);
        });
    });

    describe('when the preview moves', () => {
        it('scrolls the editor to the line of the heading', () => {
            sync.previewMoved(source, 1, true);
            expect(calls).toEqual(['editor 4']);
        });

        it('scrolls the editor to the top of the file for the place above the first heading', () => {
            sync.outlineChanged(TITLES, 2);
            sync.previewMoved(source, -1, true);
            expect(calls).toEqual(['editor 0']);
        });

        it('sends nothing for a heading both sides are at', () => {
            sync.outlineChanged(TITLES, 1);
            sync.previewMoved(source, 1, true);
            expect(calls).toEqual([]);
        });

        it('notes a move the author did not make, and leaves the editor where it is', () => {
            sync.previewMoved(source, 2, false);
            sync.editorMoved(source, 6);
            expect(calls).toEqual([]);
        });

        it('sends nothing for a file with no headings', () => {
            edit('just text\n');
            sync.previewMoved(source, 1, true);
            expect(calls).toEqual([]);
        });

        it('shows an entry that has no heading in the file at the heading before it', () => {
            sync.outlineChanged(['One', 'Missing', 'Three'], -1);
            sync.previewMoved(source, 1, true);
            expect(calls).toEqual(['editor 2']);
        });
    });

    describe('when one side answers the other', () => {
        it('passes over the editor\'s own events just after the preview scrolled it', () => {
            sync.previewMoved(source, 2, true);
            // The editor settles a line short of the heading, as it does at the end of a file.
            now += 50;
            sync.editorMoved(source, 5);
            expect(calls).toEqual(['editor 6']);
        });

        it('takes the editor\'s events again once it has settled', () => {
            sync.previewMoved(source, 2, true);
            now += EDITOR_SETTLE_MS;
            sync.editorMoved(source, 3);
            expect(calls).toEqual(['editor 6', 'preview 0']);
        });

        it('does not scroll the preview back for the editor arriving at the heading it was sent to', () => {
            sync.previewMoved(source, 1, true);
            now += EDITOR_SETTLE_MS * 2;
            sync.editorMoved(source, 4);
            expect(calls).toEqual(['editor 4']);
        });

        it('does not scroll the editor back for the preview arriving at the heading it was sent to', () => {
            sync.editorMoved(source, 5);
            sync.previewMoved(source, 1, true);
            sync.previewMoved(source, 1, false);
            expect(calls).toEqual(['preview 1']);
        });

        it('lets the preview drive again after the editor did', () => {
            sync.editorMoved(source, 5);
            sync.previewMoved(source, 2, true);
            sync.previewMoved(source, 0, true);
            expect(calls).toEqual(['preview 1', 'editor 6', 'editor 2']);
        });
    });

    describe('when the preview draws a new PDF', () => {
        it('takes the place it is at as the one both sides are at', () => {
            sync.editorMoved(source, 5);
            sync.outlineChanged(TITLES, 2);
            sync.editorMoved(source, 6);
            expect(calls).toEqual(['preview 1']);
        });

        it('pairs the headings with the new outline', () => {
            sync.outlineChanged(['Three'], -1);
            sync.editorMoved(source, 6);
            expect(calls).toEqual(['preview 0']);
        });
    });
});
