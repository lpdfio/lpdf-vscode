import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSchemaDocs, findElement, SchemaDocs } from './schema-docs';
import { formatAttributeHover, formatElementHover } from './hover-format';

const docs: SchemaDocs = buildSchemaDocs(fs.readFileSync(path.join(__dirname, '..', 'schema', 'lpdf.xsd'), 'utf8'));

function elementHover(name: string, scope?: string): string {
    const element = findElement(docs, name, scope);
    if (!element) { throw new Error(`No element ${name}`); }
    return formatElementHover(element);
}

function attributeHover(elementName: string, attributeName: string): string {
    const attribute = findElement(docs, elementName)?.attributes.find(candidate => candidate.name === attributeName);
    if (!attribute) { throw new Error(`No attribute ${attributeName} on ${elementName}`); }
    return formatAttributeHover(attribute);
}

describe('formatElementHover', () => {
    it('writes the signature in an xml code block', () => {
        const hover = elementHover('stack');
        expect(hover.startsWith('```xml\n<stack\n')).toBe(true);
        expect(hover).toContain('    align="start|center|end|stretch"\n');
    });

    it('names the type where a length can be written, since the values alone would mislead', () => {
        expect(elementHover('stack')).toContain('    gap="TokenScaleOrPt"\n');
    });

    it('names the type where the values are too many to list', () => {
        expect(elementHover('font')).toContain('core="BuiltinFont"');
    });

    it('shows a numeric range in place of the type', () => {
        expect(elementHover('layer', 'canvas')).toContain('opacity="decimal 0–1"');
    });

    it('closes an element that takes no children, and keeps a short signature on one line', () => {
        expect(elementHover('assets')).toContain('```xml\n<assets>\n```');
        expect(elementHover('layout')).not.toContain('/>');
        expect(elementHover('meta')).toContain('/>');
    });

    it('lists the required attributes', () => {
        expect(elementHover('barcode')).toContain('Required: `type`, `data`');
    });

    it('collapses data binding attributes to a line under the signature', () => {
        const hover = elementHover('stack');
        expect(hover).toContain('Data binding: `data-value`, `data-source`, `data-if`, `data-if-not`');
        expect(hover).not.toContain('data-value="');
    });

    it('says what a container holds', () => {
        expect(elementHover('stack')).toContain('Contains: layout elements');
        expect(elementHover('frame')).toContain('Contains: one layout element');
        expect(elementHover('table')).toContain('Contains: `<thead>`, `<tr>`');
        expect(elementHover('layer', 'canvas')).toContain('Contains: canvas shapes');
    });

    it('says text may sit inside an element that holds text', () => {
        expect(elementHover('text')).toContain('Contains: text, `<span>`');
    });

    it('leaves the contents line off an element that has none', () => {
        expect(elementHover('divider')).not.toContain('Contains');
    });

    it('uses the canvas text when the scope says so', () => {
        expect(elementHover('text', 'canvas')).toContain('anchor="');
        expect(elementHover('text')).not.toContain('anchor="');
    });
});

describe('formatAttributeHover', () => {
    it('shows the type, its values and how to write others', () => {
        const hover = attributeHover('stack', 'gap');
        expect(hover).toContain('**`gap`** · `TokenScaleOrPt`');
        expect(hover).toContain('`xs` | `s` | `m` | `l` | `xl` | `xxl`');
        expect(hover).toContain('token name or explicit pt value');
    });

    it('marks a required attribute and leaves the type off an unnamed enumeration', () => {
        const hover = attributeHover('barcode', 'type');
        expect(hover.startsWith('**`type`** · required')).toBe(true);
        expect(hover).toContain('`qr` | `code128` | `ean13`');
    });

    it('lists every value even when the signature shows the type name', () => {
        expect(attributeHover('font', 'core')).toContain('`Helvetica-Bold`');
    });

    it('shows the range', () => {
        expect(attributeHover('grid', 'cols')).toContain('Range: 1–12');
    });

    it('is one line for a plain string', () => {
        expect(attributeHover('stack', 'font')).toBe('**`font`** · `string`');
    });
});
