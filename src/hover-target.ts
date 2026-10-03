/** The tag or attribute name under the cursor. */
export interface HoverTarget {
    /** The element the cursor is on, or the element the attribute belongs to. */
    element: string;
    /** The attribute name. Not set when the cursor is on the element name. */
    attribute?: string;
    /** The scope element the tag sits inside, e.g. `canvas`. Not set outside all of them. */
    scope?: string;
    /** Where the name starts in the text. */
    start: number;
    /** Where the name ends in the text, exclusive. */
    end: number;
}

// One whole tag, matched from its `<`. The attribute part only matches well-formed `name="value"`
// pairs, so a tag that is still being typed gives no hover.
const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=<>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/y;
const ATTRIBUTE_RE = /([^\s=<>/]+)\s*=\s*(?:"[^"]*"|'[^']*')/g;

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The scope element still open at the end of `before`, if any. Scope elements (`canvas`,
 * `layout`, `tokens`) never nest, so one value is enough: an opening tag sets it, its
 * closing tag clears it.
 */
function enclosingScope(before: string, scopes: readonly string[]): string | undefined {
    if (scopes.length === 0) { return undefined; }
    const names = scopes.map(escapeRegExp).join('|');
    // Comments are matched too, so a commented-out <canvas> is stepped over.
    const scopeTag = new RegExp(`<!--[\\s\\S]*?-->|<(/?)(${names})(?=[\\s/>])[^>]*?(/?)>`, 'g');
    let current: string | undefined;
    for (const match of before.matchAll(scopeTag)) {
        const [, closing, name, selfClosing]: (string | undefined)[] = match;
        if (name === undefined) { continue; }
        if (closing) {
            if (current === name) { current = undefined; }
        } else if (!selfClosing) {
            current = name;
        }
    }
    return current;
}

/**
 * Finds the element or attribute name at `offset`, and the scope the tag sits in.
 * Nothing is found in text content, in an attribute value, in a comment, or in a tag that is
 * not complete.
 *
 * @param text The whole document text.
 * @param offset The character under the cursor.
 * @param scopes Names of the elements that scope what their children mean, from `SchemaDocs.scopes`.
 */
export function locateHoverTarget(text: string, offset: number, scopes: readonly string[]): HoverTarget | undefined {
    const tagStart = text.lastIndexOf('<', offset);
    if (tagStart < 0) { return undefined; }
    TAG_RE.lastIndex = tagStart;
    const match = TAG_RE.exec(text);
    if (!match || offset >= tagStart + match[0].length) { return undefined; }

    const before = text.slice(0, tagStart);
    if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) { return undefined; }

    const [, closing, element, attributes] = match;
    const nameStart = tagStart + 1 + closing.length;
    const nameEnd = nameStart + element.length;
    const scope = enclosingScope(before, scopes);
    if (offset >= nameStart && offset < nameEnd) {
        return { element, scope, start: nameStart, end: nameEnd };
    }

    // `attributes` begins where the element name ends, so a match index is relative to `nameEnd`.
    for (const found of attributes.matchAll(ATTRIBUTE_RE)) {
        const start = nameEnd + (found.index ?? 0);
        const end = start + found[1].length;
        if (offset >= start && offset < end) {
            return { element, attribute: found[1], scope, start, end };
        }
    }
    return undefined;
}
