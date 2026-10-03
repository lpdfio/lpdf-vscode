/** One element of a parsed XSD file. */
export interface XsdNode {
    /** The element name without its namespace prefix: `xs:element` gives `element`. */
    name: string;
    attrs: Record<string, string>;
    children: XsdNode[];
    /** The comment written directly above the element, on one line. Banner comments are dropped. */
    comment?: string;
}

/** Thrown when the schema text is not well-formed enough to build a tree from. */
export class XsdParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'XsdParseError';
    }
}

// Matches, in this order: a comment, a processing instruction such as the XML declaration, and
// a tag. The XSD has no CDATA, and no `>` inside an attribute value, so nothing more is needed.
const TOKEN_RE = /<!--([\s\S]*?)-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const BANNER_RE = /={3,}/;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

function localName(qualified: string): string {
    return qualified.slice(qualified.indexOf(':') + 1);
}

function decodeEntities(value: string): string {
    return value.replace(/&(lt|gt|amp|quot|apos);/g, (_entity, name: string) => ENTITIES[name]);
}

function readAttributes(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of source.matchAll(ATTRIBUTE_RE)) {
        attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
    }
    return attrs;
}

/** A comment worth keeping: one line of text. Section banners and empty comments are not. */
function cleanComment(body: string): string | undefined {
    const text = body.replace(/\s+/g, ' ').trim();
    return text === '' || BANNER_RE.test(text) ? undefined : text;
}

/**
 * Parses an XSD file into a tree of elements, keeping only what the schema model needs:
 * element names, attributes, and the comment directly above each element. Text between tags
 * is ignored.
 *
 * @param xsd The schema text.
 * @returns The root element, `xs:schema` for a valid XSD.
 * @throws XsdParseError when tags do not nest, or the text has no root element.
 */
export function parseXsdTree(xsd: string): XsdNode {
    const open: XsdNode[] = [];
    let root: XsdNode | undefined;
    let pendingComment: string | undefined;

    for (const match of xsd.matchAll(TOKEN_RE)) {
        const [, commentBody, closing, qualifiedName, rawAttributes, selfClosing]: (string | undefined)[] = match;
        if (qualifiedName === undefined) {
            // A comment, or a processing instruction (which leaves a pending comment alone).
            if (commentBody !== undefined) { pendingComment = cleanComment(commentBody); }
            continue;
        }

        const name = localName(qualifiedName);
        if (closing) {
            const expected = open.pop();
            if (expected?.name !== name) {
                throw new XsdParseError(`Closing tag </${qualifiedName}> does not match the open <${expected?.name ?? 'nothing'}>`);
            }
            pendingComment = undefined;
            continue;
        }

        const node: XsdNode = { name, attrs: readAttributes(rawAttributes ?? ''), children: [], comment: pendingComment };
        pendingComment = undefined;
        const parent = open[open.length - 1];
        if (parent) {
            parent.children.push(node);
        } else if (root) {
            throw new XsdParseError(`A second root element <${qualifiedName}> follows <${root.name}>`);
        } else {
            root = node;
        }
        if (!selfClosing) { open.push(node); }
    }

    if (open.length > 0) { throw new XsdParseError(`Element <${open[open.length - 1].name}> is never closed`); }
    if (!root) { throw new XsdParseError('The schema has no root element'); }
    return root;
}
