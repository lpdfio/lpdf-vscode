import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = path.join(__dirname, '..', 'wasm', 'lpdf.js');

const TYPED = `<lpdf version="1"><document debug="false"><section><layout>
<grid cols="3" opacity="0.5"><text bold="true" line-height="1.5">a</text><text line-height="m">b</text></grid>
</layout></section></document></lpdf>`;

// The engine is downloaded into wasm/ before a build, locally and in CI; without it there is nothing to generate with.
describe.skipIf(!fs.existsSync(ENGINE))('the Generate commands', () => {
    const { codegen_wasm } = createRequire(__filename)(ENGINE) as { codegen_wasm(xml: string, options: string): string };
    const generate = (target: string): string => codegen_wasm(TYPED, JSON.stringify({ target, indent: 4 }));

    it.each([
        ['js', ['{ debug: false }', 'L.grid({ cols: 3, opacity: 0.5 }', 'L.text({ bold: true, lineHeight: 1.5 }', "{ lineHeight: 'm' }"]],
        ['python', ['debug=False', 'GridAttr(cols=3, opacity=0.5)', 'TextAttr(bold=True, line_height=1.5)', "line_height='m'"]],
        ['php', ['debug: false', 'new GridAttr(cols: 3, opacity: 0.5)', 'new TextAttr(bold: true, lineHeight: 1.5)', "lineHeight: 'm'"]],
        ['dotnet', ['Debug = false', 'new() { Cols = 3, Opacity = 0.5 }', 'new() { Bold = true, LineHeight = 1.5 }', 'LineHeight = "m"']],
    ])('write each typed attribute as a literal of its type in %s', (target, literals) => {
        const code = generate(target);
        for (const literal of literals) {
            expect(code, literal).toContain(literal);
        }
    });

    it('refuse a value the engine refuses, with its error', () => {
        expect(() => codegen_wasm(TYPED.replace('bold="true"', 'bold="1"'), JSON.stringify({ target: 'js', indent: 4 })))
            .toThrow(/bold must be true or false, not "1"/);
    });
});
