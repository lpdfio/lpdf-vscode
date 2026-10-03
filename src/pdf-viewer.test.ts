import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.fn<(uri: unknown) => Promise<Uint8Array>>();

vi.mock('vscode', () => ({
    Uri: { joinPath: (base: unknown, ...parts: string[]) => ({ base, parts }), file: (path: string) => ({ fsPath: path }) },
    workspace: { fs: { readFile: (uri: unknown) => readFile(uri), writeFile: vi.fn() } },
    window: { showSaveDialog: vi.fn(), showInformationMessage: vi.fn() },
}));
vi.mock('./preview', () => ({ buildWebviewHtml: () => '<html></html>' }));

import { LpdfPdfViewerProvider } from './pdf-viewer';

type Listener = (message: { type: string; [key: string]: unknown }) => void;

/** A webview panel that keeps what the provider gives it, and what the provider posts to it. */
function fakePanel() {
    const state: { listener?: Listener; onDispose?: () => void; posted: unknown[] } = { posted: [] };
    const panel = {
        webview: {
            options: undefined as unknown,
            html: '',
            onDidReceiveMessage: (listener: Listener) => { state.listener = listener; },
            postMessage: async (message: unknown) => { state.posted.push(message); return true; },
        },
        onDidDispose: (callback: () => void) => { state.onDispose = callback; },
    };
    return { panel, state };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function openProvider() {
    const provider = new LpdfPdfViewerProvider({ extensionUri: {} } as never);
    const document = { uri: { fsPath: path.join('docs', 'report.pdf'), path: '/docs/report.pdf' }, dispose() {} };
    return { provider, document };
}

describe('LpdfPdfViewerProvider', () => {
    beforeEach(() => {
        readFile.mockReset();
    });

    it('listens for the page before the file has been read, so a page that is ready early is not missed', async () => {
        let finishRead: (bytes: Uint8Array) => void = () => {};
        readFile.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
        const { provider, document } = openProvider();
        const { panel, state } = fakePanel();

        const opened = provider.resolveCustomEditor(document, panel as never);
        expect(state.listener).toBeDefined();

        state.listener?.({ type: 'ready' });
        await flush();
        expect(state.posted).toEqual([]);

        finishRead(new Uint8Array([37, 80, 68, 70]));
        await opened;
        await flush();
        expect(state.posted).toEqual([{
            type: 'updatePdf', pdfBase64: Buffer.from('%PDF').toString('base64'), filename: 'report.pdf', zoom: 'fit',
        }]);
    });

    it('sends the PDF at once to a page that is ready after the file has been read', async () => {
        readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
        const { provider, document } = openProvider();
        const { panel, state } = fakePanel();

        await provider.resolveCustomEditor(document, panel as never);
        expect(state.posted).toEqual([]);
        state.listener?.({ type: 'ready' });
        await flush();

        expect(state.posted).toHaveLength(1);
        expect(state.posted[0]).toMatchObject({ type: 'updatePdf', pdfBase64: 'AQID' });
    });

    it('sends nothing to a panel that was closed before the file was read', async () => {
        let finishRead: (bytes: Uint8Array) => void = () => {};
        readFile.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
        const { provider, document } = openProvider();
        const { panel, state } = fakePanel();

        const opened = provider.resolveCustomEditor(document, panel as never);
        state.listener?.({ type: 'ready' });
        state.onDispose?.();
        finishRead(new Uint8Array([1]));
        await opened;
        await flush();

        expect(state.posted).toEqual([]);
    });

    it('tells the page why a file could not be read, and reports it to VS Code too', async () => {
        readFile.mockRejectedValue(new Error('EACCES: permission denied'));
        const { provider, document } = openProvider();
        const { panel, state } = fakePanel();

        const opened = provider.resolveCustomEditor(document, panel as never);
        state.listener?.({ type: 'ready' });
        await expect(opened).rejects.toThrow('EACCES: permission denied');
        await flush();

        expect(state.posted).toEqual([{ type: 'showError', message: 'Could not read report.pdf: EACCES: permission denied' }]);
    });

    it('lets scripts run in the page, and only reads files from the media folder', async () => {
        readFile.mockResolvedValue(new Uint8Array([1]));
        const { provider, document } = openProvider();
        const { panel } = fakePanel();

        await provider.resolveCustomEditor(document, panel as never);

        expect(panel.webview.options).toMatchObject({ enableScripts: true, localResourceRoots: [{ parts: ['media'] }] });
        expect(panel.webview.html).toBe('<html></html>');
    });
});
