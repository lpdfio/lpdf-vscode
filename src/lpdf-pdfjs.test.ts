import { describe, expect, it } from 'vitest';
// @ts-expect-error The module is plain JavaScript, served to the webview as it is.
import { documentOptions, viewerLocations } from '../media/viewer/lpdf-pdfjs.mjs';

describe('viewerLocations', () => {
    it('finds the library, its worker and the viewer from the address of the viewer folder', () => {
        expect(viewerLocations('https://file.example/media/viewer')).toEqual({
            pdfjsUri: 'https://file.example/media/viewer/build/pdf.mjs',
            workerUri: 'https://file.example/media/viewer/build/pdf.worker.mjs',
            viewerUri: 'https://file.example/media/viewer/web/viewer.mjs',
            webRoot: 'https://file.example/media/viewer/web/',
        });
    });

    it('gives the same locations when the address ends in a slash', () => {
        expect(viewerLocations('https://file.example/media/viewer/')).toEqual(viewerLocations('https://file.example/media/viewer'));
    });
});

describe('documentOptions', () => {
    it('locates the character maps, colour profiles, standard fonts and decoders under the web folder', () => {
        expect(documentOptions('https://file.example/media/viewer/web/')).toEqual({
            cMapUrl: 'https://file.example/media/viewer/web/cmaps/',
            cMapPacked: true,
            iccUrl: 'https://file.example/media/viewer/web/iccs/',
            standardFontDataUrl: 'https://file.example/media/viewer/web/standard_fonts/',
            wasmUrl: 'https://file.example/media/viewer/web/wasm/',
            useWorkerFetch: false,
        });
    });

    it('has the page fetch the data files, because a request from the blob worker can wait 30 seconds', () => {
        expect(documentOptions('https://file.example/media/viewer/web/').useWorkerFetch).toBe(false);
    });
});
