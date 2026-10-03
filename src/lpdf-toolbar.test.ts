import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitModeOf, nextFitScaleValue, parseZoomPercent, spreadModeFor } from '../media/viewer/lpdf-toolbar.mjs';

const vendoredViewerHtml = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer', 'web', 'viewer.html'), 'utf8');

describe('parseZoomPercent', () => {
    it.each([
        ['150', 150],
        ['150%', 150],
        [' 150 % ', 150],
        ['87.5', 87.5],
        ['87,5%', 87.5],
    ])('reads %j as %d percent', (text, percent) => {
        expect(parseZoomPercent(text)).toBe(percent);
    });

    it.each([['5', 10], ['0', 10], ['5000', 1000]])('keeps %j within the allowed range, as %d', (text, percent) => {
        expect(parseZoomPercent(text)).toBe(percent);
    });

    it.each([[''], ['abc'], ['12abc'], ['-50'], ['1 5'], ['%']])('does not read %j', text => {
        expect(parseZoomPercent(text)).toBeUndefined();
    });
});

describe('fitModeOf', () => {
    it.each([
        ['page-width', 'width'],
        ['page-fit', 'page'],
        ['auto', 'manual'],
        ['page-actual', 'manual'],
        ['1.5', 'manual'],
        [undefined, 'manual'],
    ])('reads the scale value %j as %s', (scaleValue, mode) => {
        expect(fitModeOf(scaleValue)).toBe(mode);
    });
});

describe('nextFitScaleValue', () => {
    it('goes from fitted width to fitted page', () => {
        expect(nextFitScaleValue('page-width')).toBe('page-fit');
    });

    it.each([['page-fit'], ['auto'], ['2']])('goes from %j to fitted width', scaleValue => {
        expect(nextFitScaleValue(scaleValue)).toBe('page-width');
    });
});

describe('spreadModeFor', () => {
    it.each([
        [false, false, 0],
        [false, true, 0],
        [true, false, 1],
        [true, true, 2],
    ])('with two pages %j and a separate cover %j gives spread mode %d', (isTwoPage, cover, mode) => {
        expect(spreadModeFor(isTwoPage, cover)).toBe(mode);
    });
});

describe('the viewer page the toolbar is arranged from', () => {
    it.each([
        'toolbarViewerMiddle',
        'numPages',
        'zoomOutButton',
        'secondaryToolbarButtonContainer',
        'documentProperties',
        'downloadButton',
        'previous',
        'secondaryToolbarToggle',
        'scaleSelectContainer',
    ])('has an element with the id %s', id => {
        expect(vendoredViewerHtml).toContain(`id="${id}"`);
    });
});
