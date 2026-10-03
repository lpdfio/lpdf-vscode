import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSchemaDocs, ElementDoc, findElement, GLOBAL_SCOPE, SchemaDocs, SchemaDocsError } from './schema-docs';

// The XSD that ships in the extension, so these tests also pin what the schema says today.
const docs: SchemaDocs = buildSchemaDocs(fs.readFileSync(path.join(__dirname, '..', 'schema', 'lpdf.xsd'), 'utf8'));

function element(name: string, scope?: string): ElementDoc {
    const found = findElement(docs, name, scope);
    if (!found) { throw new Error(`No element ${name} in the schema docs`); }
    return found;
}

function attributeNames(name: string, scope?: string): string[] {
    return element(name, scope).attributes.map(attribute => attribute.name);
}

function attribute(elementName: string, attributeName: string, scope?: string) {
    const found = element(elementName, scope).attributes.find(candidate => candidate.name === attributeName);
    if (!found) { throw new Error(`No attribute ${attributeName} on ${elementName}`); }
    return found;
}

describe('buildSchemaDocs', () => {
    it('gives an attribute the values of its enumerated type', () => {
        const gap = attribute('stack', 'gap');
        expect(gap.type.name).toBe('TokenScaleOrPt');
        expect(gap.type.values).toEqual(['xs', 's', 'm', 'l', 'xl', 'xxl']);
        expect(gap.type.open).toBe(true);
        expect(gap.type.hint).toContain('token name or explicit pt value');
    });

    it('resolves a type declared after the first place it is used', () => {
        // HeightValue is a union with HeightMode, which the schema declares below it.
        expect(attribute('stack', 'height').type.values).toEqual(['full', 'fill']);
    });

    it('leaves the hint off a type that is only an enumeration', () => {
        const align = attribute('stack', 'align');
        expect(align.type.values).toEqual(['start', 'center', 'end', 'stretch']);
        expect(align.type.open).toBe(false);
        expect(align.type.hint).toBeUndefined();
    });

    it('reads an enumeration written inline on the attribute', () => {
        const barcodeType = attribute('barcode', 'type');
        expect(barcodeType.type.values).toEqual(['qr', 'code128', 'ean13']);
        expect(barcodeType.type.name).toBe('');
    });

    it('treats a boolean as true or false', () => {
        expect(attribute('stack', 'debug').type).toMatchObject({ name: 'boolean', values: ['true', 'false'], open: false });
    });

    it('reads numeric ranges', () => {
        expect(attribute('layer', 'opacity', 'canvas').type).toMatchObject({ name: 'decimal', range: '0–1' });
        expect(attribute('grid', 'cols').type).toMatchObject({ name: 'positive integer', range: '1–12' });
        expect(attribute('text', 'line-height', 'canvas').type.range).toBe('≥ 0');
    });

    it('marks required attributes', () => {
        const required = (name: string, scope?: string): string[] =>
            element(name, scope).attributes.filter(candidate => candidate.required).map(candidate => candidate.name);
        expect(required('barcode')).toEqual(['type', 'data']);
        expect(required('table')).toEqual(['cols']);
        expect(required('region', 'layout')).toEqual(['pin']);
        expect(required('stack')).toEqual([]);
    });

    it('follows attribute groups, and leaves gap off frame', () => {
        expect(attributeNames('stack')).toContain('gap');
        expect(attributeNames('frame')).not.toContain('gap');
        expect(attributeNames('frame')).toContain('padding');
    });

    it('records which attribute group each attribute came from', () => {
        const binding = element('stack').attributes.filter(candidate => candidate.group === 'DataBindingAttrs');
        expect(binding.map(candidate => candidate.name)).toEqual(['data-value', 'data-source', 'data-if', 'data-if-not']);
    });

    it('keeps the layout text and the canvas text apart', () => {
        expect(attributeNames('text')).toContain('width');
        expect(attributeNames('text')).not.toContain('x');
        expect(attributeNames('text', 'canvas')).toContain('x');
        expect(element('text').scope).toBe(GLOBAL_SCOPE);
        expect(element('text', 'canvas').scope).toBe('canvas');
    });

    it('files elements declared inside another under that element', () => {
        expect(element('region', 'layout').scope).toBe('layout');
        expect(element('layer', 'canvas').scope).toBe('canvas');
        expect(element('rect', 'canvas').scope).toBe('canvas');
        expect(element('grid', 'tokens').scope).toBe('tokens');
        expect(element('grid').scope).toBe(GLOBAL_SCOPE);
        expect([...docs.scopes].sort()).toEqual(['canvas', 'layout', 'tokens']);
    });

    it('gives the token rows the attributes of TokenScaleRow', () => {
        expect(attributeNames('space', 'tokens')).toEqual(['xs', 's', 'm', 'l', 'xl', 'xxl']);
    });

    it('describes what an element may contain', () => {
        expect(element('frame').children).toEqual([{ name: 'LayoutContent', kind: 'group', many: false }]);
        expect(element('stack').children).toEqual([{ name: 'LayoutContent', kind: 'group', many: true }]);
        expect(element('table').children.map(child => child.name)).toEqual(['thead', 'tr']);
        expect(element('divider').children).toEqual([]);
    });

    it('lists each child of section once, though the schema names each twice, once for each order', () => {
        expect(element('section').children.map(child => child.name)).toEqual(['layout', 'canvas']);
    });

    it('keeps layout and canvas inside a section: document holds only meta and sections', () => {
        expect(element('document').children.map(child => child.name)).toEqual(['meta', 'section']);
    });

    it('flags elements that hold text', () => {
        expect(element('text').text).toBe(true);
        expect(element('span').text).toBe(true);
        expect(element('stack').text).toBe(false);
    });

    it('rejects a schema that refers to an undefined type', () => {
        const broken = '<xs:schema xmlns:xs="x"><xs:element name="a"><xs:complexType><xs:attribute name="b" type="Missing"/></xs:complexType></xs:element></xs:schema>';
        expect(() => buildSchemaDocs(broken)).toThrow(SchemaDocsError);
    });

    it('rejects a document that is not a schema', () => {
        expect(() => buildSchemaDocs('<lpdf version="1"/>')).toThrow(SchemaDocsError);
    });
});

describe('findElement', () => {
    it('falls back to the global element when the scope has none', () => {
        expect(findElement(docs, 'stack', 'layout')?.scope).toBe(GLOBAL_SCOPE);
    });

    it('falls back to any element of that name', () => {
        // A canvas shape written outside a canvas is a validation error, but still has docs.
        expect(findElement(docs, 'rect')?.scope).toBe('canvas');
    });

    it('returns nothing for an unknown name', () => {
        expect(findElement(docs, 'nonsense')).toBeUndefined();
    });
});
