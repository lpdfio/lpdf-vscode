import * as vscode from 'vscode';

/** The environment variable that switches tracing on in an installed extension: set it before starting VS Code. */
export const TRACE_ENV = 'LPDF_TRACE';

let channel: vscode.OutputChannel | undefined;

/**
 * Whether the extension writes its trace. It does while it is being developed (an Extension Development
 * Host) and when VS Code was started with `LPDF_TRACE` set to something other than empty or `0`. There is
 * no setting for it: a user has no use for the trace, and a developer has these two ways to ask for it.
 * @param mode How VS Code is running the extension.
 * @param env The environment VS Code was started with.
 * @returns True when tracing is on.
 */
export function isTraceEnabled(mode: vscode.ExtensionMode, env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = env[TRACE_ENV];
  return mode === vscode.ExtensionMode.Development || (requested !== undefined && requested !== '' && requested !== '0');
}

/**
 * Starts the trace if it is switched on: it goes to an "Lpdf" channel in the Output panel.
 * Call once, when the extension activates.
 * @param context The extension's context; the channel is disposed with it.
 */
export function initTrace(context: vscode.ExtensionContext): void {
  if (!isTraceEnabled(context.extensionMode)) { return; }
  channel = vscode.window.createOutputChannel('Lpdf');
  context.subscriptions.push(channel);
  trace(`trace on (${context.extensionMode === vscode.ExtensionMode.Development ? 'development host' : `${TRACE_ENV} is set`})`);
}

/**
 * Writes one line to the trace, with the time to the millisecond. Does nothing when tracing is off.
 * @param message What happened. Times in it, such as `+12ms`, are since the start of the thing it describes.
 */
export function trace(message: string): void {
  channel?.appendLine(`${new Date().toISOString().slice(11, 23)}  ${message}`);
}
