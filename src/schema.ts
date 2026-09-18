import * as vscode from 'vscode';
import { LPDF_HEAD_SCAN_BYTES } from './constants';

/** A schema association, in the shape Red Hat XML's `xml.fileAssociations` uses. */
interface XmlFileAssociation {
  systemId: string;
  pattern: string;
}

/** The part of Red Hat XML's extension API this extension uses. */
interface XmlExtensionApi {
  addXMLFileAssociations(associations: XmlFileAssociation[]): void;
  removeXMLFileAssociations(associations: XmlFileAssociation[]): void;
}

// The root element, after any BOM, XML declaration, processing instructions,
// comments and DOCTYPE. Matching the root rather than any `<lpdf` keeps a file
// that merely contains an lpdf element from being treated as an lpdf document.
const LPDF_ROOT_RE = /^﻿?(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*<lpdf(?:[\s/>]|$)/;

// Cache keyed by URI → {version, result}, so CodeLens, status bar and change
// events don't rescan the same document version.
const _rootCache = new Map<string, { version: number; result: boolean }>();

/** Returns true if the document is XML and its root element is `<lpdf>`, whatever the file is named. */
export function isLpdfDocument(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'xml') { return false; }
  const key    = doc.uri.toString();
  const cached = _rootCache.get(key);
  if (cached?.version === doc.version) { return cached.result; }
  const head   = doc.getText(new vscode.Range(new vscode.Position(0, 0), doc.positionAt(LPDF_HEAD_SCAN_BYTES)));
  const result = LPDF_ROOT_RE.test(head);
  _rootCache.set(key, { version: doc.version, result });
  return result;
}

/**
 * The association pattern for exactly one file.
 *
 * Red Hat XML's server never matches a bare absolute path, in any form, but does
 * match a pattern that starts with `**`, so the path goes in after `**` with its
 * drive letter dropped. `[ ] { } * ?` are glob syntax and must be escaped; spaces
 * and parentheses need nothing. Checked against lemminx 0.31.2 (Red Hat XML 0.29.3).
 */
function filePattern(fsPath: string): string {
  const path = fsPath.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
  return '**' + path.replace(/[[\]{}*?]/g, c => '\\' + c);
}

/**
 * Keeps Red Hat XML's schema associations in step with the documents VS Code has
 * open: each file whose root is `<lpdf>` is validated against the bundled XSD,
 * and no other XML file is.
 *
 * Red Hat XML matches associations by path and cannot look inside a file, so each
 * lpdf document gets an association of its own. They go through its extension
 * API, which holds them in memory: nothing is written to settings, it works with
 * no folder open, and nothing is left behind when either extension goes away.
 */
class LpdfSchemaAssociations implements vscode.Disposable {
  // Registered associations keyed by document URI. Kept when a document closes,
  // so reopening it costs nothing; `sync` on open corrects any that went stale.
  private readonly _registered = new Map<string, XmlFileAssociation>();

  constructor(
    private readonly _api: XmlExtensionApi,
    private readonly _systemId: string,
  ) {}

  /**
   * Adds or removes the document's association to match whether its root is `<lpdf>`.
   *
   * Runs on every edit, so it calls the API only when that answer changes: each call
   * makes Red Hat XML push its settings to the server, which revalidates every open XML file.
   */
  sync(doc: vscode.TextDocument): void {
    // An unsaved document has no path for a pattern to match.
    if (doc.uri.scheme !== 'file') { return; }
    const key        = doc.uri.toString();
    const registered = this._registered.get(key);
    if (isLpdfDocument(doc)) {
      if (registered) { return; }
      const association = { systemId: this._systemId, pattern: filePattern(doc.uri.fsPath) };
      this._api.addXMLFileAssociations([association]);
      this._registered.set(key, association);
    } else if (registered) {
      this._api.removeXMLFileAssociations([registered]);
      this._registered.delete(key);
    }
  }

  dispose(): void {
    if (this._registered.size > 0) {
      this._api.removeXMLFileAssociations([...this._registered.values()]);
    }
    this._registered.clear();
  }
}

/**
 * Validates every open lpdf document against the bundled XSD, and keeps doing so
 * as documents open and change. Waits for Red Hat XML to activate, which is when
 * its API becomes available.
 *
 * @param context The extension context; the listeners are disposed with it.
 * @param xsdPath Absolute path of the bundled `lpdf.xsd`.
 * @throws Error when Red Hat XML is installed but fails to activate.
 */
export async function startSchemaAssociations(context: vscode.ExtensionContext, xsdPath: string): Promise<void> {
  const xmlExtension = vscode.extensions.getExtension<XmlExtensionApi>('redhat.vscode-xml');
  // Declared in extensionDependencies, so this only happens if it was uninstalled
  // or disabled; preview and export still work without validation.
  if (!xmlExtension) { return; }
  const api = await xmlExtension.activate();

  const associations = new LpdfSchemaAssociations(api, vscode.Uri.file(xsdPath).toString());
  context.subscriptions.push(
    associations,
    vscode.workspace.onDidOpenTextDocument(doc => associations.sync(doc)),
    // Edits matter too: a new file gets its <lpdf> root typed in, and a root can be renamed.
    vscode.workspace.onDidChangeTextDocument(event => associations.sync(event.document)),
  );
  // Documents already open, e.g. restored at start-up. Red Hat XML has handed them to its
  // server by now, and registering straight away still revalidates them: checked in
  // VS Code 1.138, where a restored file showed its schema errors within about 1.5s.
  for (const doc of vscode.workspace.textDocuments) { associations.sync(doc); }
}
