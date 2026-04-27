import * as vscode from 'vscode';
export declare function isLpdfDocument(doc: vscode.TextDocument): boolean;
/**
 * Associate the LPDF XSD with the specific file that was just confirmed to contain <lpdf.
 * Uses a per-file workspace pattern instead of **\/*.xml so only confirmed LPDF files
 * get schema validation — unrelated XML files in the workspace are unaffected.
 *
 * Also migrates away from any legacy **\/*.xml catch-all entry written by older versions,
 * and cleans up stale per-file entries the original implementation wrote to global config.
 */
export declare function ensureSchemaAssociation(doc: vscode.TextDocument, xsdPath: string): Promise<void>;
