import { AttributeDoc, ChildDoc, ElementDoc, TypeDoc } from './schema-docs';

/** The longest value list written inside a signature; a longer one shows the type name. */
const MAX_INLINE_VALUES = 6;

/** A signature this short stays on one line. */
const MAX_SINGLE_LINE_SIGNATURE = 72;

/** Attribute groups shown as one line under the signature, not attribute by attribute. */
const COLLAPSED_GROUPS = new Map([['DataBindingAttrs', 'Data binding']]);

/** How the schema's content groups read in a sentence. A group not listed shows its own name. */
const GROUP_LABELS = new Map([
    ['LayoutContent', 'layout element'],
    ['CanvasPrimitives', 'canvas shape'],
]);

/** What goes inside the quotes of an attribute in the signature. */
function signatureValue(type: TypeDoc): string {
    if (type.range) { return `${type.name} ${type.range}`; }
    if (!type.open && type.values.length > 0 && type.values.length <= MAX_INLINE_VALUES) {
        return type.values.join('|');
    }
    return type.name;
}

function signature(element: ElementDoc, attributes: AttributeDoc[]): string {
    // An element that takes no children closes itself, which tells the reader so.
    const close = element.children.length === 0 && !element.text ? '/>' : '>';
    const pairs = attributes.map(attribute => `${attribute.name}="${signatureValue(attribute.type)}"`);
    const oneLine = `${[`<${element.name}`, ...pairs].join(' ')}${close}`;
    if (pairs.length === 0 || oneLine.length <= MAX_SINGLE_LINE_SIGNATURE) { return oneLine; }
    return [`<${element.name}`, ...pairs.map(pair => `    ${pair}`), close].join('\n');
}

function names(attributes: AttributeDoc[]): string {
    return attributes.map(attribute => `\`${attribute.name}\``).join(', ');
}

function describeChild(child: ChildDoc): string {
    if (child.kind === 'element') { return `\`<${child.name}>\``; }
    const label = GROUP_LABELS.get(child.name) ?? child.name;
    return child.many ? `${label}s` : `one ${label}`;
}

/**
 * The hover for a tag: its signature in a code block, so the editor's own theme colours it,
 * then the required attributes, the collapsed attribute groups, and what may sit inside.
 */
export function formatElementHover(element: ElementDoc): string {
    const shown = element.attributes.filter(attribute => !attribute.group || !COLLAPSED_GROUPS.has(attribute.group));
    const parts = [`\`\`\`xml\n${signature(element, shown)}\n\`\`\``];

    const required = element.attributes.filter(attribute => attribute.required);
    if (required.length > 0) { parts.push(`Required: ${names(required)}`); }

    for (const [group, label] of COLLAPSED_GROUPS) {
        const members = element.attributes.filter(attribute => attribute.group === group);
        if (members.length > 0) { parts.push(`${label}: ${names(members)}`); }
    }

    const contents = [...(element.text ? ['text'] : []), ...element.children.map(describeChild)];
    if (contents.length > 0) { parts.push(`Contains: ${contents.join(', ')}`); }
    return parts.join('\n\n');
}

/** The hover for an attribute name: its type, the values it accepts, and how to write others. */
export function formatAttributeHover(attribute: AttributeDoc): string {
    const { type } = attribute;
    const title = [`**\`${attribute.name}\`**`, type.name && `\`${type.name}\``, attribute.required && 'required']
        .filter(Boolean)
        .join(' · ');
    const parts = [title];
    if (type.values.length > 0) { parts.push(type.values.map(value => `\`${value}\``).join(' | ')); }
    if (type.hint) { parts.push(type.hint); }
    if (type.range) { parts.push(`Range: ${type.range}`); }
    return parts.join('\n\n');
}
