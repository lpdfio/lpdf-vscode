import * as vscode from 'vscode';

/** Returns true if the document follows the *.lpdf.xml naming convention. */
export function isLpdfDocument(doc: vscode.TextDocument): boolean {
  return doc.uri.fsPath.endsWith('.lpdf.xml');
}

/** Returns true if the systemId looks like an lpdf XSD from any extension version. */
function isLpdfSchemaSystemId(systemId: string): boolean {
  return /[/\\]lpdf[^/\\]*[/\\]schema[/\\]lpdf\.xsd$/i.test(systemId)
    || /[/\\]docs[/\\]schema[/\\]lpdf\.xsd$/i.test(systemId)
    || /[/\\]pages[/\\]schema[/\\]lpdf\.xsd$/i.test(systemId);
}

/**
 * Registers a single **\/*.lpdf.xml glob in xml.fileAssociations (workspace scope)
 * pointing to the bundled XSD. Called once on activation.
 *
 * Also cleans up any stale per-file entries or old-version entries written by
 * previous extension versions, and removes any lpdf entries from global config.
 */
export async function registerSchemaAssociation(xsdPath: string): Promise<void> {
  const systemId = vscode.Uri.file(xsdPath).toString();
  const pattern  = '**/*.lpdf.xml';
  const config   = vscode.workspace.getConfiguration('xml');
  const inspection = config.inspect<{ systemId: string; pattern: string }[]>('fileAssociations');

  // Clean up stale global entries (any lpdf XSD, any version).
  const globalEntries = inspection?.globalValue ?? [];
  const globalCleaned = globalEntries.filter(a => !isLpdfSchemaSystemId(a.systemId));
  if (globalCleaned.length !== globalEntries.length) {
    await config.update(
      'fileAssociations',
      globalCleaned.length > 0 ? globalCleaned : undefined,
      vscode.ConfigurationTarget.Global,
    );
  }

  // Replace all lpdf entries with the single glob; keep non-lpdf entries.
  const workspaceEntries = inspection?.workspaceValue ?? [];
  const base = workspaceEntries.filter(a => !isLpdfSchemaSystemId(a.systemId));
  const alreadySet =
    base.length === workspaceEntries.length - 1 &&
    workspaceEntries.some(a => a.systemId === systemId && a.pattern === pattern);
  if (alreadySet) { return; }

  await config.update(
    'fileAssociations',
    [...base, { systemId, pattern }],
    vscode.ConfigurationTarget.Workspace,
  );
}
