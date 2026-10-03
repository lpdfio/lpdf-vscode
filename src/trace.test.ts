import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendLine = vi.fn();
const createOutputChannel = vi.fn(() => ({ appendLine, dispose: vi.fn() }));

vi.mock('vscode', () => ({
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  window: { createOutputChannel: (name: string) => createOutputChannel(name) },
}));

import { initTrace, isTraceEnabled, trace, TRACE_ENV } from './trace';

const PRODUCTION = 1;
const DEVELOPMENT = 2;
const TEST = 3;

function context(mode: number) {
  return { extensionMode: mode, subscriptions: [] as unknown[] };
}

describe('isTraceEnabled', () => {
  it('is on in a development host', () => {
    expect(isTraceEnabled(DEVELOPMENT as never, {})).toBe(true);
  });

  it('is off for an installed extension, which is what a user has', () => {
    expect(isTraceEnabled(PRODUCTION as never, {})).toBe(false);
    expect(isTraceEnabled(TEST as never, {})).toBe(false);
  });

  it('is on for an installed extension when VS Code was started with LPDF_TRACE', () => {
    expect(isTraceEnabled(PRODUCTION as never, { [TRACE_ENV]: '1' })).toBe(true);
    expect(isTraceEnabled(PRODUCTION as never, { [TRACE_ENV]: 'true' })).toBe(true);
  });

  it.each(['', '0'])('is off when LPDF_TRACE is %j', value => {
    expect(isTraceEnabled(PRODUCTION as never, { [TRACE_ENV]: value })).toBe(false);
  });
});

describe('trace', () => {
  beforeEach(() => {
    appendLine.mockClear();
    createOutputChannel.mockClear();
  });

  it('creates no channel and writes nothing for an installed extension', () => {
    initTrace(context(PRODUCTION) as never);
    trace('nobody sees this');
    expect(createOutputChannel).not.toHaveBeenCalled();
    expect(appendLine).not.toHaveBeenCalled();
  });

  it('writes to an "Lpdf" channel, with a time on each line, in a development host', () => {
    const extensionContext = context(DEVELOPMENT);
    initTrace(extensionContext as never);
    expect(createOutputChannel).toHaveBeenCalledWith('Lpdf');
    expect(extensionContext.subscriptions).toHaveLength(1);

    trace('render started');
    expect(appendLine).toHaveBeenLastCalledWith(expect.stringMatching(/^\d\d:\d\d:\d\d\.\d{3} {2}render started$/));
  });
});
