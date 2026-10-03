import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const viewerDir = path.join(__dirname, '..', 'media', 'viewer');
const theme = fs.readFileSync(path.join(viewerDir, 'lpdf-theme.css'), 'utf8');
const viewerCss = fs.readFileSync(path.join(viewerDir, 'web', 'viewer.css'), 'utf8');

/** Every value a custom property is given in a stylesheet, without comments, on one line. */
function valuesOf(css: string, name: string): string[] {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [...withoutComments.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))];
    return found.map(match => match[1].replace(/\s+/g, ' ').trim());
}

/** The custom properties of the shared stylesheet that are PDF.js's own palette, and where PDF.js sets them. */
const MIRRORED: [string, string][] = [
    ['--lpdf-header-bg', '--toolbar-bg-color'],
    ['--lpdf-header-border', '--toolbar-border-color'],
    ['--lpdf-desk-bg', '--body-bg-color'],
    ['--lpdf-scrollbar', '--scrollbar-color'],
    ['--lpdf-scrollbar-bg', '--scrollbar-bg-color'],
    ['--lpdf-text', '--main-color'],
    ['--lpdf-icon-color', '--toolbar-icon-bg-color'],
    ['--lpdf-icon-opacity', '--toolbar-icon-opacity'],
    ['--lpdf-separator', '--separator-color'],
    ['--lpdf-field-text', '--field-color'],
    ['--lpdf-field-bg', '--field-bg-color'],
    ['--lpdf-field-border', '--field-border-color'],
    ['--lpdf-error', '--indicator-warning-color'],
    ['--lpdf-accent', '--progressBar-color'],
];

/**
 * The custom properties that are the fallback of PDF.js's own, which it sets as `var(--name, fallback)`
 * so that a host can override them: the buttons of its dialogs.
 */
const MIRRORED_FALLBACKS: [string, string][] = [
    ['--lpdf-dialog-button-text', '--button-secondary-fg-color'],
    ['--lpdf-dialog-button-bg', '--button-secondary-bg-color'],
    ['--lpdf-dialog-button-hover-bg', '--button-secondary-hover-bg-color'],
    ['--lpdf-dialog-button-active-bg', '--button-secondary-active-bg-color'],
];

/** The fallback in `var(--name, fallback)`, or the whole value when it is not one. */
function fallbackOf(value: string): string {
    return /^var\(\s*--[\w-]+\s*,\s*(.*?)\s*\)$/.exec(value)?.[1] ?? value;
}

/** The declarations of the first rule of the viewer's stylesheet with a selector, on one line. */
function ruleOf(selector: string): string {
    const withoutComments = viewerCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = withoutComments.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
    const body = /\{([^}]*)\}/.exec(withoutComments.slice(start))?.[1] ?? '';
    return body.replace(/\s+/g, ' ').trim();
}

const ICONS = ['minus', 'plus', 'fit-width', 'fit-page', 'two-page', 'cover'];

describe('lpdf-theme.css', () => {
    it.each(MIRRORED)('has %s as the viewer has %s, so the diff view looks like the viewer after a PDF.js upgrade', (mine, theirs) => {
        const value = valuesOf(theme, mine);
        expect(value).toHaveLength(1);
        expect(valuesOf(viewerCss, theirs)).toContain(value[0]);
    });

    it.each(MIRRORED_FALLBACKS)('has %s as the viewer has %s when nothing overrides it', (mine, theirs) => {
        const value = valuesOf(theme, mine);
        expect(value).toHaveLength(1);
        expect(valuesOf(viewerCss, theirs).map(fallbackOf)).toContain(value[0]);
    });

    it('has the page background that the viewer gives a page before it is drawn', () => {
        const [background] = valuesOf(theme, '--lpdf-page-bg');
        expect(ruleOf('.pdfViewer .page')).toContain(`background-color:var(--page-bg-color, ${background});`);
    });

    it('has the border, the shadow and the backdrop that the dialogs of the viewer have', () => {
        const [border] = valuesOf(theme, '--lpdf-dialog-border');
        const [shadow] = valuesOf(theme, '--lpdf-dialog-shadow');
        const [backdrop] = valuesOf(theme, '--lpdf-dialog-backdrop');
        expect(ruleOf('dialog')).toContain(`border:1px solid ${border};`);
        expect(ruleOf('dialog')).toContain(`box-shadow:${shadow};`);
        expect(ruleOf('dialog::backdrop')).toContain(`background-color:${backdrop};`);
    });

    it.each(ICONS)('has the %s icon as an inline SVG of 16 by 16 units', name => {
        const [value] = valuesOf(theme, `--lpdf-icon-${name}`);
        const payload = /^url\("data:image\/svg\+xml,([^"]+)"\)$/.exec(value)?.[1];
        expect(payload).toBeDefined();
        const svg = decodeURIComponent(payload ?? '');
        expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">');
        expect(svg).not.toMatch(/<script|<image|href=/);
    });

    it('draws every icon in black, which a mask turns into the icon colour', () => {
        for (const name of ICONS) {
            const svg = decodeURIComponent(/data:image\/svg\+xml,([^"]+)"/.exec(valuesOf(theme, `--lpdf-icon-${name}`)[0])?.[1] ?? '');
            expect(svg).toContain('#000');
            expect(svg).not.toMatch(/#(?!000)[0-9a-fA-F]{3,6}\b/);
        }
    });
});
