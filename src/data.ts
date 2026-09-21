import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_KEY_PREFIX = 'lpdf.dataFile:';

// Fired whenever an explicit link is added or removed so CodeLens can refresh.
const _changeEmitter = new vscode.EventEmitter<void>();
export const onDidChangeDataLinks: vscode.Event<void> = _changeEmitter.event;

// Stored in place of a URI once the user unlinks, so an auto-discovered <name>.json stays
// ignored until a file is linked again.
const UNLINKED = 'unlinked';

function dataKey(xmlUri: vscode.Uri): string {
  return DATA_KEY_PREFIX + xmlUri.toString();
}

/** Returns the explicitly-linked JSON URI stored in workspaceState, or undefined. */
function getExplicitDataUri(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
): vscode.Uri | undefined {
  const stored = context.workspaceState.get<string>(dataKey(xmlUri));
  return stored && stored !== UNLINKED ? vscode.Uri.parse(stored) : undefined;
}

/**
 * Returns the effective linked JSON URI for an XML file.
 * Precedence: explicit workspaceState link > auto-discovered sidecar (<name>.json), unless
 * the user has unlinked the document.
 */
export function getLinkedDataUri(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
): vscode.Uri | undefined {
  const explicit = getExplicitDataUri(context, xmlUri);
  if (explicit) { return explicit; }
  if (context.workspaceState.get<string>(dataKey(xmlUri)) === UNLINKED) { return undefined; }

  // Auto-discovery: look for a same-name .json file in the same directory.
  const jsonPath = path.join(
    path.dirname(xmlUri.fsPath),
    path.basename(xmlUri.fsPath, '.xml') + '.json',
  );
  return fs.existsSync(jsonPath) ? vscode.Uri.file(jsonPath) : undefined;
}

/**
 * Reads and returns the JSON string for the linked data file, or null if
 * there is no linked file or it cannot be read.
 */
export function getLinkedDataJson(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
): string | null {
  const jsonUri = getLinkedDataUri(context, xmlUri);
  if (!jsonUri) { return null; }
  try {
    return fs.readFileSync(jsonUri.fsPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Stores or clears an explicit link in workspaceState and fires onDidChangeDataLinks.
 * Pass undefined to remove the explicit link (auto-discovery may still apply).
 */
export async function setLinkedDataUri(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
  jsonUri: vscode.Uri | undefined,
): Promise<void> {
  await context.workspaceState.update(dataKey(xmlUri), jsonUri?.toString());
  _changeEmitter.fire();
}

/**
 * Stops the XML file using any data file, an auto-discovered <name>.json included, and
 * fires onDidChangeDataLinks. Linking a file again turns data back on.
 */
export async function unlinkDataUri(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
): Promise<void> {
  await context.workspaceState.update(dataKey(xmlUri), UNLINKED);
  _changeEmitter.fire();
}

/**
 * Opens a file picker and links the chosen JSON file to the XML URI.
 * Returns the chosen URI, or undefined if the user cancelled.
 */
export async function promptLinkDataFile(
  context: vscode.ExtensionContext,
  xmlUri: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const picks = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { JSON: ['json'] },
    defaultUri: vscode.Uri.file(path.dirname(xmlUri.fsPath)),
    title: 'Select JSON data file for Lpdf preview',
  });
  if (!picks || picks.length === 0) { return undefined; }
  await setLinkedDataUri(context, xmlUri, picks[0]);
  return picks[0];
}
