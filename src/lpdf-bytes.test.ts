import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../media/viewer/lpdf-bytes.mjs';

describe('bytesToBase64', () => {
    it('encodes as Node does', () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 255, 37, 80, 68, 70]);
        expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    });

    it('encodes a PDF larger than one chunk, which a single String.fromCharCode call could not take', () => {
        const bytes = new Uint8Array(5 * 1024 * 1024);
        for (let index = 0; index < bytes.length; index++) { bytes[index] = (index * 31) % 256; }
        expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    });

    it('encodes nothing as nothing', () => {
        expect(bytesToBase64(new Uint8Array(0))).toBe('');
    });
});

describe('base64ToBytes', () => {
    it('gives back the bytes that were encoded', () => {
        const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 0, 255]);
        expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    });
});
