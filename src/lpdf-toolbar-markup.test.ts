// @vitest-environment happy-dom
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { arrangeToolbar, ToolbarMarkupError } from '../media/viewer/lpdf-toolbar.mjs';

const vendoredViewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer', 'web', 'viewer.html'), 'utf8');

/** The body of the vendored viewer page, which is what the toolbar is arranged in. */
function vendoredBody(): string {
    const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(vendoredViewerHtml);
    if (!match) { throw new Error('The vendored viewer.html has no body'); }
    return match[1];
}

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) { throw new Error(`No element #${id}`); }
    return element;
}

/** The ids of the controls in the middle group, in order, whatever group they sit in. */
function middleIds(): string[] {
    return [...byId('toolbarViewerMiddle').querySelectorAll('[id]')].map(element => element.id);
}

beforeEach(() => {
    document.body.innerHTML = vendoredBody();
});

describe('arrangeToolbar on the vendored viewer page', () => {
    it('arranges the toolbar of the viewer that ships in this folder, which is the upgrade check', () => {
        expect(() => arrangeToolbar()).not.toThrow();
    });

    it('puts the page box, the zoom controls and the page view buttons in the middle, in that order', () => {
        arrangeToolbar();
        const ids = middleIds().filter(id => ['pageNumber', 'numPages', 'zoomOutButton', 'lpdfZoomInput', 'zoomInButton', 'lpdfFitButton', 'lpdfTwoPageButton', 'lpdfCoverButton'].includes(id));
        expect(ids).toEqual(['pageNumber', 'numPages', 'zoomOutButton', 'lpdfZoomInput', 'zoomInButton', 'lpdfFitButton', 'lpdfTwoPageButton', 'lpdfCoverButton']);
    });

    it('puts the zoom field between the zoom buttons, which no longer have the split separator between them', () => {
        arrangeToolbar();
        const group = byId('zoomOutButton').parentElement as HTMLElement;
        expect([...group.children].map(child => child.id)).toEqual(['zoomOutButton', 'lpdfZoomInput', 'zoomInButton']);
        expect(group.querySelector('.splitToolbarButtonSeparator')).toBeNull();
    });

    it('hides the page arrows and the more menu but leaves them in the page, which the viewer wires by id', () => {
        arrangeToolbar();
        expect(byId('previous').parentElement?.classList.contains('lpdf-hidden')).toBe(true);
        expect(byId('next').parentElement?.classList.contains('lpdf-hidden')).toBe(true);
        expect(byId('secondaryToolbarToggle').classList.contains('lpdf-hidden')).toBe(true);
        expect(byId('secondaryToolbarToggleButton')).toBeTruthy();
    });

    it('moves document properties next to Save, as an icon rather than a menu row', () => {
        arrangeToolbar();
        const properties = byId('documentProperties');
        expect(properties.parentElement).toBe(byId('downloadButton').parentElement);
        expect(properties.classList.contains('labeled')).toBe(false);
    });

    it('adds the fit, two page and cover buttons, the last two as toggles that start off', () => {
        arrangeToolbar();
        expect(byId('lpdfFitButton').dataset.next).toBe('width');
        expect(byId('lpdfTwoPageButton').getAttribute('aria-pressed')).toBe('false');
        expect(byId('lpdfCoverButton').getAttribute('aria-pressed')).toBe('false');
    });
});

describe('arrangeToolbar on a viewer page that has changed', () => {
    it.each(['toolbarViewerMiddle', 'previous', 'next', 'pageNumber', 'numPages', 'zoomOutButton', 'zoomInButton', 'downloadButton', 'documentProperties', 'secondaryToolbarToggle'])(
        'names #%s when it is gone',
        id => {
            // The more menu holds the document properties button, so that one is taken out first.
            if (id === 'secondaryToolbarToggle') { document.body.append(byId('documentProperties')); }
            byId(id).remove();
            expect(() => arrangeToolbar()).toThrow(new ToolbarMarkupError(`The viewer page has no element #${id}`));
        },
    );

    it('names the two controls when they are no longer in one group', () => {
        document.body.append(byId('zoomInButton'));
        expect(() => arrangeToolbar()).toThrow(/#zoomOutButton and #zoomInButton in different groups/);
    });

    it('fails with a ToolbarMarkupError, not with a TypeError, when the page number is moved out of its group', () => {
        document.body.append(byId('pageNumber'));
        expect(() => arrangeToolbar()).toThrow(ToolbarMarkupError);
    });
});
