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
        const hover = elementHover('column');
        expect(hover.startsWith('```xml\n<column\n')).toBe(true);
        expect(hover).toContain('    align="start|center|end|stretch"\n');
    });

    it('names the type where a length can be written, since the values alone would mislead', () => {
        expect(elementHover('column')).toContain('    gap="TokenScaleOrPt"\n');
    });

    it('names the type where the values are too many to list', () => {
        expect(elementHover('font')).toContain('core="BuiltinFont"');
    });

    it('shows a numeric range after the type', () => {
        expect(elementHover('layer')).toContain('opacity="OpacityValue 0–1"');
        expect(elementHover('grid')).toContain('cols="positive integer 1–12"');
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
        const hover = elementHover('column');
        expect(hover).toContain('Data binding: `data-value`, `data-source`, `data-if`, `data-if-not`');
        expect(hover).not.toContain('data-value="');
    });

    it('says what a container holds', () => {
        expect(elementHover('column')).toContain('Contains: layout elements');
        expect(elementHover('frame')).toContain('Contains: one layout element');
        expect(elementHover('table')).toContain('Contains: `<thead>`, `<tr>`');
        expect(elementHover('layer')).toContain('Contains: layer elements');
    });

    it('says text may sit inside an element that holds text', () => {
        expect(elementHover('text')).toContain('Contains: text, `<span>`');
    });

    it('leaves the contents line off an element that has none', () => {
        expect(elementHover('divider')).not.toContain('Contains');
    });

    it('shows the attributes of a text-at in a layer, and of the text in the layout', () => {
        const textAt = elementHover('text-at');
        expect(textAt).toContain('anchor="');
        expect(textAt).toContain('max-lines="');
        expect(textAt).not.toContain('widows="');
        const text = elementHover('text');
        expect(text).toContain('widows="');
        expect(text).not.toContain('anchor="');
    });
});

describe('formatAttributeHover', () => {
    it('shows the type, its values and how to write others', () => {
        const hover = attributeHover('column', 'gap');
        expect(hover).toContain('**`gap`** · `TokenScaleOrPt`');
        expect(hover).toContain('`xs` | `s` | `m` | `l` | `xl` | `xxl`');
        expect(hover).toContain('slot, alias of a slot, or explicit pt value');
    });

    it('marks a required attribute and leaves the type off an unnamed enumeration', () => {
        const hover = attributeHover('barcode', 'type');
        expect(hover.startsWith('**`type`** · required')).toBe(true);
        expect(hover).toContain('`qr` | `code128` | `ean13`');
    });

    it('lists every value even when the signature shows the type name', () => {
        expect(attributeHover('font', 'core')).toContain('`Helvetica-Bold`');
    });

    it('says that a list takes any of its values, separated by spaces', () => {
        const hover = attributeHover('output', 'allow');
        expect(hover).toContain('**`allow`** · `Permissions`');
        expect(hover).toContain('Any of `print`, `modify`, `copy`, `annotate`, `fill-forms`, `accessibility`, `assemble`, separated by spaces');
        // The output's other attributes, such as pdfa, follow: this is about how the list shows.
        expect(elementHover('output')).toMatch(/<output encrypt="aes-256\|rc4-128" allow="Permissions"[^>]*\/>/);
    });

    it('shows the range', () => {
        expect(attributeHover('grid', 'cols')).toContain('Range: 1–12');
    });

    it('is one line for a plain string', () => {
        expect(attributeHover('column', 'font')).toBe('**`font`** · `string`');
    });
});
