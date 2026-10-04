import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    IMAGES_DIR,
    labelPageHtml,
    LabelSpecError,
    LABEL_STYLE,
    planImage,
    pngSize,
    readSpec,
    SOURCE_DIR,
} from '../scripts/label-screenshots.mjs';

const SIZE = { width: 1000, height: 600 };

/** The first 24 bytes of a PNG: the signature, then the header chunk with the size. */
function pngHeader(width: number, height: number): Buffer {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
}

describe('pngSize', () => {
    it('reads the size from the header', () => {
        expect(pngSize(pngHeader(1458, 925))).toEqual({ width: 1458, height: 925 });
    });

    it('rejects a file that is not a PNG', () => {
        expect(() => pngSize(Buffer.from('GIF89a and then some more bytes'))).toThrow(LabelSpecError);
        expect(() => pngSize(Buffer.alloc(4))).toThrow(LabelSpecError);
    });
});

describe('planImage', () => {
    it('keeps the whole screenshot when there is no crop', () => {
        const plan = planImage('a', { source: 'a.png', labels: [{ n: 1, x: 10, y: 20 }] }, SIZE);
        expect(plan.crop).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
        expect(plan.labels).toEqual([{ n: 1, x: 10, y: 20 }]);
    });

    it('gives the labels in the pixels of the cropped image, though the spec has them in the source\'s', () => {
        const plan = planImage('a', {
            source: 'a.png',
            crop: { x: 100, y: 50, width: 400, height: 300 },
            labels: [{ n: 1, x: 150, y: 80 }],
        }, SIZE);
        expect(plan.labels).toEqual([{ n: 1, x: 50, y: 30 }]);
    });

    it.each([
        ['a crop that goes past the right edge', { x: 800, y: 0, width: 300, height: 100 }],
        ['a crop that goes past the bottom', { x: 0, y: 500, width: 100, height: 200 }],
        ['an empty crop', { x: 0, y: 0, width: 0, height: 100 }],
        ['a crop with a fraction in it', { x: 0.5, y: 0, width: 100, height: 100 }],
        ['a crop with a negative corner', { x: -1, y: 0, width: 100, height: 100 }],
    ])('rejects %s', (_name, crop) => {
        expect(() => planImage('a', { source: 'a.png', crop }, SIZE)).toThrow(LabelSpecError);
    });

    it('rejects a label that falls outside the crop, even if it is inside the screenshot', () => {
        const entry = { source: 'a.png', crop: { x: 100, y: 100, width: 200, height: 200 }, labels: [{ n: 1, x: 50, y: 150 }] };
        expect(() => planImage('a', entry, SIZE)).toThrow(/label 1 is outside the crop/);
    });

    it('rejects a number used twice, and a number that is not a counting number', () => {
        const label = { x: 10, y: 10 };
        expect(() => planImage('a', { source: 'a.png', labels: [{ n: 1, ...label }, { n: 1, ...label }] }, SIZE)).toThrow(/twice/);
        expect(() => planImage('a', { source: 'a.png', labels: [{ n: 0, ...label }] }, SIZE)).toThrow(LabelSpecError);
    });

    it('rejects an entry with no source, and names the entry', () => {
        expect(() => planImage('diff', {}, SIZE)).toThrow(/diff: "source" is missing/);
    });
});

describe('labelPageHtml', () => {
    it('puts each label on its centre, and the screenshot at the crop\'s corner', () => {
        const plan = planImage('a', {
            source: 'a.png',
            crop: { x: 100, y: 50, width: 400, height: 300 },
            labels: [{ n: 3, x: 150, y: 80 }],
        }, SIZE);
        const html = labelPageHtml('data:image/png;base64,AAAA', plan);
        const radius = LABEL_STYLE.diameter / 2;
        expect(html).toContain(`left:${50 - radius}px;top:${30 - radius}px">3</span>`);
        expect(html).toContain('left: -100px; top: -50px');
        expect(html).toContain('width: 400px; height: 300px');
    });

    it('uses the brand orange with a dark number that is readable on it', () => {
        expect(LABEL_STYLE.fill).toBe('#d76f04');
        const luminance = (hex: string): number => {
            const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
                .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const [light, dark] = [luminance(LABEL_STYLE.fill), luminance(LABEL_STYLE.text)].sort((a, b) => b - a);
        expect((light + 0.05) / (dark + 0.05)).toBeGreaterThan(4.5);
    });
});

describe('the screenshots of the README', () => {
    const spec = readSpec() as Record<string, { source: string }>;

    it.each(Object.keys(spec))('%s has its raw screenshot, a spec that fits it, and a finished image', name => {
        const source = path.join(SOURCE_DIR, spec[name].source);
        expect(fs.existsSync(source), `${source} is missing`).toBe(true);
        expect(() => planImage(name, spec[name], pngSize(fs.readFileSync(source)))).not.toThrow();
        expect(fs.existsSync(path.join(IMAGES_DIR, `${name}.png`)), `run npm run docs:images: ${name}.png is missing`).toBe(true);
    });

    it('are all used by the README, and the README uses nothing else from docs/images', () => {
        const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
        const used = [...readme.matchAll(/docs\/images\/([\w-]+)\.png/g)].map(match => match[1]);
        expect([...new Set(used)].sort()).toEqual(Object.keys(spec).sort());
    });

    it('are not in the package', () => {
        const ignore = fs.readFileSync(path.join(__dirname, '..', '.vscodeignore'), 'utf8').split(/\r?\n/);
        expect(ignore).toContain('docs/');
    });
});
