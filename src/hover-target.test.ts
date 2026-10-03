import { describe, expect, it } from 'vitest';
import { locateHoverTarget } from './hover-target';

const SCOPES = ['canvas', 'layout', 'tokens'];

const TEXT = [
    '<lpdf version="1">',
    '  <!-- <stack gap="m"> in a comment -->',
    '  <document size="a4">',
    '    <section>',
    '      <layout><stack gap="m"><text>hello</text></stack></layout>',
    '      <canvas><layer><text x="1pt">t</text></layer></canvas>',
    '    </section>',
    '  </document>',
    '</lpdf>',
].join('\n');

/** The offset `into` characters past the `nth` occurrence of `needle` (0-based). */
function offsetOf(needle: string, nth = 0, into = 0): number {
    let index = -1;
    for (let found = 0; found <= nth; found++) {
        index = TEXT.indexOf(needle, index + 1);
    }
    return index + into;
}

describe('locateHoverTarget', () => {
    it('finds an element name, with the range of the name', () => {
        // The stack in the layout, not the one in the comment.
        const at = offsetOf('<stack', 1, 2);
        const target = locateHoverTarget(TEXT, at, SCOPES);
        expect(target?.element).toBe('stack');
        expect(target?.attribute).toBeUndefined();
        expect(TEXT.slice(target!.start, target!.end)).toBe('stack');
    });

    it('finds the attribute name and its element', () => {
        const target = locateHoverTarget(TEXT, offsetOf('gap', 1, 1), SCOPES);
        expect(target).toMatchObject({ element: 'stack', attribute: 'gap' });
        expect(TEXT.slice(target!.start, target!.end)).toBe('gap');
    });

    it('finds the name in a closing tag', () => {
        expect(locateHoverTarget(TEXT, offsetOf('</stack', 0, 3), SCOPES)).toMatchObject({ element: 'stack' });
    });

    it('finds an attribute after another', () => {
        expect(locateHoverTarget(TEXT, offsetOf('size="a4"', 0, 1), SCOPES)).toMatchObject({ element: 'document', attribute: 'size' });
    });

    it('reports the layout scope inside a layout and the canvas scope inside a canvas', () => {
        expect(locateHoverTarget(TEXT, offsetOf('<text', 0, 2), SCOPES)?.scope).toBe('layout');
        expect(locateHoverTarget(TEXT, offsetOf('<text', 1, 2), SCOPES)?.scope).toBe('canvas');
    });

    it('reports no scope outside every scope element', () => {
        expect(locateHoverTarget(TEXT, offsetOf('<section', 0, 2), SCOPES)?.scope).toBeUndefined();
        expect(locateHoverTarget(TEXT, offsetOf('<layout', 0, 2), SCOPES)?.scope).toBeUndefined();
    });

    it('ends a scope at its closing tag', () => {
        const text = '<layout><stack/></layout><text/>';
        expect(locateHoverTarget(text, text.lastIndexOf('text') + 1, SCOPES)?.scope).toBeUndefined();
    });

    it('does not count a self-closing scope element as open', () => {
        const text = '<canvas/><text/>';
        expect(locateHoverTarget(text, text.lastIndexOf('text') + 1, SCOPES)?.scope).toBeUndefined();
    });

    it('steps over a commented-out scope element', () => {
        const text = '<!-- <canvas> --><text/>';
        expect(locateHoverTarget(text, text.lastIndexOf('text') + 1, SCOPES)?.scope).toBeUndefined();
    });

    it('finds nothing in text content', () => {
        expect(locateHoverTarget(TEXT, offsetOf('hello', 0, 2), SCOPES)).toBeUndefined();
    });

    it('finds nothing in an attribute value', () => {
        expect(locateHoverTarget(TEXT, offsetOf('"a4"', 0, 2), SCOPES)).toBeUndefined();
    });

    it('finds nothing inside a comment', () => {
        expect(locateHoverTarget(TEXT, offsetOf('<stack', 0, 2), SCOPES)).toBeUndefined();
        expect(locateHoverTarget(TEXT, offsetOf('in a comment', 0, 3), SCOPES)).toBeUndefined();
    });

    it('finds nothing in a tag that is still being typed', () => {
        const text = '<stack gap="m" pad';
        expect(locateHoverTarget(text, 2, SCOPES)).toBeUndefined();
    });

    it('finds nothing on the character after a tag ends', () => {
        const text = '<stack>x';
        expect(locateHoverTarget(text, text.length - 1, SCOPES)).toBeUndefined();
    });

    it('finds nothing in an empty document', () => {
        expect(locateHoverTarget('', 0, SCOPES)).toBeUndefined();
    });

    it('works with no scopes', () => {
        expect(locateHoverTarget(TEXT, offsetOf('<text', 0, 2), [])).toMatchObject({ element: 'text', scope: undefined });
    });
});
