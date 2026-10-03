import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { isLpdfDocument } from './schema';
import { buildSchemaDocs, findElement, SchemaDocs } from './schema-docs';
import { locateHoverTarget } from './hover-target';
import { formatAttributeHover, formatElementHover } from './hover-format';

/** Shows the signature of the tag or attribute under the cursor, read from the bundled XSD. */
class LpdfHoverProvider implements vscode.HoverProvider {
    private _docs: SchemaDocs | undefined;
    private _loadFailed = false;

    constructor(private readonly _xsdPath: string) {}

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!isLpdfDocument(document)) { return undefined; }
        const docs = this._load();
        if (!docs) { return undefined; }

        const target = locateHoverTarget(document.getText(), document.offsetAt(position), docs.scopes);
        const element = target && findElement(docs, target.element, target.scope);
        if (!target || !element) { return undefined; }

        let markdown: string;
        if (target.attribute === undefined) {
            markdown = formatElementHover(element);
        } else {
            const attribute = element.attributes.find(candidate => candidate.name === target.attribute);
            // Not in the schema, e.g. xmlns:xsi: the validator has its own say about it.
            if (!attribute) { return undefined; }
            markdown = formatAttributeHover(attribute);
        }
        const range = new vscode.Range(document.positionAt(target.start), document.positionAt(target.end));
        return new vscode.Hover(new vscode.MarkdownString(markdown), range);
    }

    /** Reads the XSD on the first hover. A failure is logged once, not shown: the hover is a convenience. */
    private _load(): SchemaDocs | undefined {
        if (this._docs || this._loadFailed) { return this._docs; }
        try {
            this._docs = buildSchemaDocs(fs.readFileSync(this._xsdPath, 'utf8'));
        } catch (e) {
            this._loadFailed = true;
            console.error('[lpdf] hover docs unavailable:', e);
        }
        return this._docs;
    }
}

/**
 * Registers the hover for Lpdf documents.
 *
 * @param xsdPath Absolute path of the bundled `lpdf.xsd`.
 */
export function registerHoverProvider(context: vscode.ExtensionContext, xsdPath: string): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ language: 'xml' }, new LpdfHoverProvider(xsdPath)),
    );
}
