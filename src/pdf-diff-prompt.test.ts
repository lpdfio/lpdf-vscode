import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeUri = { scheme: string; fsPath: string; toString(): string };

const uri = (scheme: string, fsPath: string): FakeUri => ({ scheme, fsPath, toString: () => `${scheme}:${fsPath}` });

const state = {
  listener: undefined as undefined | ((event: { opened: unknown[]; changed: unknown[] }) => void),
  setting: true,
  message: vi.fn(),
  close: vi.fn(),
  run: vi.fn(),
  update: vi.fn(),
};

vi.mock('vscode', () => ({
  TabInputTextDiff: class { constructor(public original: FakeUri, public modified: FakeUri) {} },
  ConfigurationTarget: { Global: 1 },
  window: {
    tabGroups: {
      onDidChangeTabs: (listener: (event: { opened: unknown[]; changed: unknown[] }) => void) => { state.listener = listener; return { dispose() {} }; },
      close: (...args: unknown[]) => state.close(...args),
    },
    showInformationMessage: (...args: unknown[]) => state.message(...args),
  },
  commands: { executeCommand: (...args: unknown[]) => state.run(...args) },
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback: boolean) => state.setting ?? fallback, update: (...args: unknown[]) => state.update(...args) }),
  },
}));

import * as vscode from 'vscode';
import { pdfDiffTarget, registerPdfDiffPrompt } from './pdf-diff-prompt';

const diff = (original: FakeUri, modified: FakeUri) => new vscode.TabInputTextDiff(original as never, modified as never);
const gitSide = (name: string) => uri('git', `/repo/${name}`);
const fileSide = (name: string) => uri('file', `/repo/${name}`);

/** Starts the prompt and returns a function that opens a tab with this input. */
function start() {
  registerPdfDiffPrompt({ subscriptions: [] } as never);
  const open = (input: unknown) => {
    const tab = { input };
    state.listener?.({ opened: [tab], changed: [] });
    return tab;
  };
  /** A tab that was already open and now shows this input, as a preview tab does. */
  open.change = (input: unknown) => {
    const tab = { input };
    state.listener?.({ opened: [], changed: [tab] });
    return tab;
  };
  return open;
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  for (const mock of [state.message, state.close, state.run, state.update]) { mock.mockReset(); }
  state.setting = true;
  state.listener = undefined;
});

describe('pdfDiffTarget', () => {
  it('is the file on disk when a PDF is compared with its git version', () => {
    const modified = fileSide('docs/a.pdf');
    expect(pdfDiffTarget(diff(gitSide('docs/a.pdf'), modified))).toBe(modified);
  });

  it('knows the extension in any case', () => {
    expect(pdfDiffTarget(diff(gitSide('A.PDF'), fileSide('A.PDF')))).toBeDefined();
  });

  it.each([
    ['a text file', diff(gitSide('a.xml'), fileSide('a.xml'))],
    ['a staged change, git on both sides', diff(gitSide('a.pdf'), uri('git', '/repo/a.pdf'))],
    ['two files, not a change against git', diff(fileSide('a.pdf'), fileSide('b.pdf'))],
    ['a tab that is not a diff', { uri: fileSide('a.pdf') }],
    ['no tab input', undefined],
  ])('is nothing for %s', (_case, input) => {
    expect(pdfDiffTarget(input)).toBeUndefined();
  });
});

describe('registerPdfDiffPrompt', () => {
  it('asks, in plain words, with three ways to answer, when a changed PDF opens as a text diff', async () => {
    state.message.mockResolvedValue(undefined);
    start()(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    const [text, ...buttons] = state.message.mock.calls[0];
    expect(text).toContain('Comparing changes to a.pdf?');
    expect(buttons).toEqual(['Open in Lpdf', 'Not now', 'Don\'t ask again']);
  });

  it('closes the text diff and opens the visual one when accepted', async () => {
    state.message.mockResolvedValue('Open in Lpdf');
    const modified = fileSide('a.pdf');
    const tab = start()(diff(gitSide('a.pdf'), modified));
    await flush();
    expect(state.close).toHaveBeenCalledWith(tab);
    expect(state.run).toHaveBeenCalledWith('lpdf.diffPdf', modified);
  });

  it('leaves the text diff alone on "Not now" or when the message is dismissed', async () => {
    state.message.mockResolvedValueOnce('Not now').mockResolvedValueOnce(undefined);
    const open = start();
    open(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    open(diff(gitSide('b.pdf'), fileSide('b.pdf')));
    await flush();
    expect(state.close).not.toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('switches the setting off for good on "Don\'t ask again"', async () => {
    state.message.mockResolvedValue('Don\'t ask again');
    start()(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    expect(state.update).toHaveBeenCalledWith('promptPdfDiff', false, 1);
    expect(state.close).not.toHaveBeenCalled();
  });

  it('does not ask when the setting is off', async () => {
    state.setting = false;
    start()(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    expect(state.message).not.toHaveBeenCalled();
  });

  it('asks once while the message for a file is up, and for another file at the same time', async () => {
    state.message.mockReturnValue(new Promise(() => {}));
    const open = start();
    open(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    open(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    open(diff(gitSide('b.pdf'), fileSide('b.pdf')));
    await flush();
    expect(state.message).toHaveBeenCalledTimes(2);
  });

  it('asks again when the diff is opened again after the message went away', async () => {
    state.message.mockResolvedValue(undefined);
    const open = start();
    open(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    open(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    expect(state.message).toHaveBeenCalledTimes(2);
  });

  it('asks when a tab that was open moves to a changed PDF', async () => {
    state.message.mockResolvedValue(undefined);
    start().change(diff(gitSide('a.pdf'), fileSide('a.pdf')));
    await flush();
    expect(state.message).toHaveBeenCalledTimes(1);
  });

  it('does not ask about tabs that are not changed PDFs', async () => {
    const open = start();
    open(diff(gitSide('a.xml'), fileSide('a.xml')));
    open({ other: true });
    await flush();
    expect(state.message).not.toHaveBeenCalled();
  });
});
