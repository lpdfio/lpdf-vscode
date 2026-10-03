import { describe, expect, it } from 'vitest';
import { parseXsdTree, XsdParseError } from './xsd-tree';

describe('parseXsdTree', () => {
    it('builds nested nodes with the namespace prefix removed', () => {
        const root = parseXsdTree('<?xml version="1.0"?><xs:schema xmlns:xs="x"><xs:element name="a"><xs:complexType/></xs:element></xs:schema>');
        expect(root.name).toBe('schema');
        expect(root.children[0].name).toBe('element');
        expect(root.children[0].attrs.name).toBe('a');
        expect(root.children[0].children[0].name).toBe('complexType');
    });

    it('attaches the comment directly above an element', () => {
        const root = parseXsdTree('<s>\n  <!-- e.g. "10pt"\n       or "1in" -->\n  <t name="a"/>\n  <t name="b"/>\n</s>');
        expect(root.children[0].comment).toBe('e.g. "10pt" or "1in"');
        expect(root.children[1].comment).toBeUndefined();
    });

    it('drops banner comments', () => {
        const root = parseXsdTree('<s><!-- ==== Simple Types ==== --><t name="a"/></s>');
        expect(root.children[0].comment).toBeUndefined();
    });

    it('does not attach a comment across a closing tag', () => {
        const root = parseXsdTree('<s><a><!-- last in a --></a><b/></s>');
        expect(root.children[1].comment).toBeUndefined();
    });

    it('does not read tags inside a comment', () => {
        const root = parseXsdTree('<s><!-- <td>: a table cell --><t/></s>');
        expect(root.children.map(child => child.name)).toEqual(['t']);
    });

    it('decodes entities and reads single-quoted attributes', () => {
        const root = parseXsdTree('<s><t a="x &lt; y" b=\'q\'/></s>');
        expect(root.children[0].attrs).toEqual({ a: 'x < y', b: 'q' });
    });

    it('throws when a closing tag does not match', () => {
        expect(() => parseXsdTree('<s><a></b></s>')).toThrow(XsdParseError);
    });

    it('throws when an element is never closed', () => {
        expect(() => parseXsdTree('<s><a>')).toThrow(XsdParseError);
    });

    it('throws when there is no root element', () => {
        expect(() => parseXsdTree('<!-- nothing -->')).toThrow(XsdParseError);
    });
});
