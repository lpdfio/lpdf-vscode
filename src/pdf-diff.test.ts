import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What the fake git prints for a command, by its arguments joined with spaces; a missing one fails. */
const git = new Map<string, Buffer>();
const state = {
    gitCalls: [] as { args: string[]; cwd: string }[],
    error: vi.fn(),
    pick: vi.fn(),
    posted: [] as unknown[],
    panels: 0,
    /** The listener the command put on its page's messages. */
    listener: undefined as undefined | ((msg: { type: string }) => void),
};

vi.mock('node:child_process', () => ({
    spawn: (_command: string, args: string[], options: { cwd: string }) => {
        state.gitCalls.push({ args, cwd: options.cwd });
        const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter() });
        setTimeout(() => {
            const out = git.get(args.join(' '));
            if (out) { proc.stdout.emit('data', out); }
            proc.emit('close', out ? 0 : 128);
        }, 0);
        return proc;
    },
}));

vi.mock('vscode', () => ({
    ViewColumn: { Active: -1 },
    Uri: { joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: path.join(base.fsPath, ...parts) }) },
    extensions: {
        getExtension: () => ({
            isActive: true,
            exports: { getAPI: () => ({ repositories: [], getRepository: () => ({ rootUri: { fsPath: '/repo' } }) }) },
        }),
    },
    workspace: { fs: { readFile: async () => Buffer.from('new pdf') } },
    window: {
        activeTextEditor: undefined,
        showErrorMessage: (...args: unknown[]) => state.error(...args),
        showQuickPick: (...args: unknown[]) => state.pick(...args),
        createWebviewPanel: () => {
            state.panels++;
            return {
                webview: {
                    html: '',
                    cspSource: 'vscode-webview:',
                    asWebviewUri: () => ({ toString: () => 'vscode-webview://viewer/' }),
                    onDidReceiveMessage: (listener: (msg: { type: string }) => void) => { state.listener = listener; },
                    postMessage: async (msg: unknown) => {
                        state.posted.push(msg);
                        return true;
                    },
                },
            };
        },
    },
}));

import { diffPdf, diffPdfWithRef } from './pdf-diff';

const context = { extensionPath: path.join(__dirname, '..'), extensionUri: { fsPath: path.join(__dirname, '..') } } as never;
const pdf = { fsPath: '/repo/out/report.pdf' } as never;

const REFS = [
    'refs/heads/fix-header\0',
    'refs/remotes/origin/HEAD\0refs/remotes/origin/main',
    'refs/remotes/origin/main\0',
    'refs/tags/v0.30.0\0',
    'refs/heads/main\0',
].join('\n') + '\n';
const FOR_EACH_REF = 'for-each-ref --sort=-creatordate --format=%(refname)%00%(symref) refs/heads refs/remotes refs/tags';

/** Runs a command and then tells it that its page is ready, as the page does once it has loaded. */
async function run(command: Promise<void>): Promise<void> {
    await command;
    state.listener?.({ type: 'ready' });
}

beforeEach(() => {
    git.clear();
    git.set(FOR_EACH_REF, Buffer.from(REFS));
    git.set('show HEAD:out/report.pdf', Buffer.from('head pdf'));
    git.set('show refs/heads/main:out/report.pdf', Buffer.from('main pdf'));
    state.gitCalls = [];
    state.posted = [];
    state.panels = 0;
    state.listener = undefined;
    state.error.mockReset();
    state.pick.mockReset();
});

describe('Compare PDF with HEAD', () => {
    it('shows the PDF of the last commit on the left, labelled HEAD, and the working copy on the right', async () => {
        await run(diffPdf(context, pdf));
        expect(state.gitCalls).toEqual([{ args: ['show', 'HEAD:out/report.pdf'], cwd: '/repo' }]);
        expect(state.posted).toEqual([{
            type: 'updateDiff',
            oldBase64: Buffer.from('head pdf').toString('base64'),
            newBase64: Buffer.from('new pdf').toString('base64'),
            filename: 'report.pdf',
            leftLabel: 'HEAD',
        }]);
    });

    it('names HEAD in the error for a PDF that the last commit has no version of', async () => {
        git.delete('show HEAD:out/report.pdf');
        await run(diffPdf(context, pdf));
        expect(state.error).toHaveBeenCalledWith('Lpdf: report.pdf has no version at HEAD.');
        expect(state.panels).toBe(0);
    });
});

describe('Compare PDF with branch...', () => {
    it('offers the branches and tags with the local default branch first, and says what each is', async () => {
        await run(diffPdfWithRef(context, pdf));
        const [items, options] = state.pick.mock.calls[0] as [{ label: string; description: string }[], { title: string }];
        expect(items.map(i => [i.label, i.description])).toEqual([
            ['main', 'branch'],
            ['fix-header', 'branch'],
            ['origin/main', 'remote branch'],
            ['v0.30.0', 'tag'],
        ]);
        expect(options.title).toBe('Compare report.pdf with');
    });

    it('shows the PDF at the chosen branch on the left, labelled with its name, and the working copy on the right', async () => {
        state.pick.mockImplementation(async (items: unknown[]) => items[0]);
        await run(diffPdfWithRef(context, pdf));
        expect(state.gitCalls[1]).toEqual({ args: ['show', 'refs/heads/main:out/report.pdf'], cwd: '/repo' });
        expect(state.posted).toEqual([{
            type: 'updateDiff',
            oldBase64: Buffer.from('main pdf').toString('base64'),
            newBase64: Buffer.from('new pdf').toString('base64'),
            filename: 'report.pdf',
            leftLabel: 'main',
        }]);
    });

    it('reads a tag by its full name and labels it with its short one', async () => {
        git.set('show refs/tags/v0.30.0:out/report.pdf', Buffer.from('tag pdf'));
        state.pick.mockImplementation(async (items: { label: string }[]) => items.find(i => i.label === 'v0.30.0'));
        await run(diffPdfWithRef(context, pdf));
        expect(state.gitCalls[1].args).toEqual(['show', 'refs/tags/v0.30.0:out/report.pdf']);
        expect(state.posted).toMatchObject([{ leftLabel: 'v0.30.0' }]);
    });

    it('names the chosen ref in the error for a PDF that it has no version of, and opens no diff', async () => {
        state.pick.mockImplementation(async (items: { label: string }[]) => items.find(i => i.label === 'origin/main'));
        await run(diffPdfWithRef(context, pdf));
        expect(state.error).toHaveBeenCalledWith('Lpdf: report.pdf has no version at origin/main.');
        expect(state.panels).toBe(0);
    });

    it('does nothing more when the picker is dismissed', async () => {
        state.pick.mockResolvedValue(undefined);
        await run(diffPdfWithRef(context, pdf));
        expect(state.gitCalls).toHaveLength(1);
        expect(state.panels).toBe(0);
        expect(state.error).not.toHaveBeenCalled();
    });

    it('says so when git cannot list the branches and tags', async () => {
        git.delete(FOR_EACH_REF);
        await run(diffPdfWithRef(context, pdf));
        expect(state.error).toHaveBeenCalledWith('Lpdf: The branches and tags of this repository could not be read.');
        expect(state.pick).not.toHaveBeenCalled();
    });
});
