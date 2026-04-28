import * as vscode from 'vscode';
import { LPDF_HEAD_SCAN_BYTES } from './constants';

interface XmlFileAssociation {
  systemId: string;
  pattern: string;
}

// Cache isLpdfDocument results keyed by URI → {version, result}.
// Avoids re-scanning the document on every CodeLens / status-bar refresh.
const _isLpdfCache = new Map<string, { version: number; result: boolean }>();

export function isLpdfDocument(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'xml') return false;
  const key    = doc.uri.toString();
  const cached = _isLpdfCache.get(key);
  if (cached && cached.version === doc.version) { return cached.result; }
  const result = /<lpdf\b/.test(doc.getText().substring(0, LPDF_HEAD_SCAN_BYTES));
  _isLpdfCache.set(key, { version: doc.version, result });
  return result;
}

/**
 * Associate the Lpdf XSD with the specific file that was just confirmed to contain <lpdf.
 * Uses a per-file workspace pattern instead of **\/*.xml so only confirmed Lpdf files
 * get schema validation — unrelated XML files in the workspace are unaffected.
 *
 * Also migrates away from any legacy **\/*.xml catch-all entry written by older versions,
 * and cleans up stale per-file entries the original implementation wrote to global config.
 */
export async function ensureSchemaAssociation(doc: vscode.TextDocument, xsdPath: string): Promise<void> {
  if (!isLpdfDocument(doc)) return;

  const systemId = vscode.Uri.file(xsdPath).toString();
  const config   = vscode.workspace.getConfiguration('xml');
  const inspection = config.inspect<XmlFileAssociation[]>('fileAssociations');

  // 1. Clean up stale global entries written by the original implementation.
  const globalEntries = inspection?.globalValue ?? [];
  const globalCleaned = globalEntries.filter(a => a.systemId !== systemId);
  if (globalCleaned.length !== globalEntries.length) {
    await config.update(
      'fileAssociations',
      globalCleaned.length > 0 ? globalCleaned : undefined,
      vscode.ConfigurationTarget.Global,
    );
  }

  // 2. Add a per-file entry; migrate away from the legacy **/*.xml catch-all if present.
  const filePattern = vscode.workspace.asRelativePath(doc.uri, false);
  const workspaceEntries = inspection?.workspaceValue ?? [];

  const hasLegacyWildcard = workspaceEntries.some(a => a.systemId === systemId && a.pattern === '**/*.xml');
  const hasFileEntry      = workspaceEntries.some(a => a.systemId === systemId && a.pattern === filePattern);

  if (!hasLegacyWildcard && hasFileEntry) { return; } // already correctly configured

  const base = hasLegacyWildcard
    ? workspaceEntries.filter(a => !(a.systemId === systemId && a.pattern === '**/*.xml'))
    : workspaceEntries;

  await config.update(
    'fileAssociations',
    [...base, ...(hasFileEntry ? [] : [{ systemId, pattern: filePattern }])],
    vscode.ConfigurationTarget.Workspace,
  );
}
