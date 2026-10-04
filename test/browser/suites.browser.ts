import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/** The suites, each a script in this folder. Those with a theme or a display scaling run once for each. */
const SUITES: ReadonlyArray<{ name: string; file: string; args?: string[] }> = [
    { name: 'full viewer page', file: 'viewer.mjs' },
    { name: 'full viewer header', file: 'header.mjs' },
    { name: 'full viewer zoom cap', file: 'zoom-cap.mjs' },
    { name: 'full viewer save, with form input', file: 'save.mjs' },
    { name: 'full viewer page shadow, dark', file: 'page-shadow.mjs', args: ['dark'] },
    { name: 'full viewer page shadow, light', file: 'page-shadow.mjs', args: ['light'] },
    { name: 'diff view, dark', file: 'diff.mjs', args: ['dark'] },
    { name: 'diff view, light', file: 'diff.mjs', args: ['light'] },
    { name: 'diff view properties dialogs, dark', file: 'info.mjs', args: ['dark'] },
    { name: 'diff view properties dialogs, light', file: 'info.mjs', args: ['light'] },
    { name: 'diff view scrolling, 2x display', file: 'scroll.mjs', args: ['2'] },
    { name: 'diff view high zoom, 2x display', file: 'high-zoom.mjs', args: ['2'] },
    { name: 'diff view high zoom, 3x display', file: 'high-zoom.mjs', args: ['3'] },
    { name: 'diff view draws content at a high zoom', file: 'ink.mjs', args: ['2'] },
];

/** Runs one suite as a process of its own and collects what it printed. */
function runSuite(file: string, args: string[]): Promise<{ code: number | null; output: string }> {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [path.join(__dirname, file), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('close', code => resolve({ code, output }));
    });
}

describe.each(SUITES)('$name', ({ file, args = [] }) => {
    it('passes every check', async () => {
        const { code, output } = await runSuite(file, args);
        const failed = output.split('\n').filter(line => line.startsWith('FAIL'));
        expect(failed, output.slice(-2000)).toEqual([]);
        expect(code, output.slice(-2000)).toBe(0);
    });
});
