import { parseXsdTree, XsdNode } from './xsd-tree';

/** The scope of elements declared at the top of the schema. */
export const GLOBAL_SCOPE = 'global';

/** What an attribute accepts. */
export interface TypeDoc {
    /** The schema type name, e.g. `TokenScaleOrPt`. A built-in reads plainly (`decimal`); an unnamed enumeration has none. */
    name: string;
    /** Every fixed value the type accepts, in schema order. */
    values: string[];
    /** True when values outside `values` are accepted too, such as a length like `10pt`. */
    open: boolean;
    /** How to write a value that is not in `values`, from the comment above the type in the schema. Open types only. */
    hint?: string;
    /** The numeric range, e.g. `0–1`. */
    range?: string;
}

export interface AttributeDoc {
    name: string;
    type: TypeDoc;
    required: boolean;
    /** The attribute group it comes from, e.g. `DataBindingAttrs`. */
    group?: string;
}

/** One kind of child an element accepts. */
export interface ChildDoc {
    /** An element name, or a content group name such as `LayoutContent`. */
    name: string;
    kind: 'element' | 'group';
    /** True when the child can repeat. */
    many: boolean;
}

export interface ElementDoc {
    name: string;
    /**
     * `global` for an element declared at the top of the schema. Otherwise the top-level element
     * it is declared inside, e.g. `canvas` for `layer` and for the shapes in it. That is how the
     * canvas `text` is told apart from the layout `text`.
     */
    scope: string;
    attributes: AttributeDoc[];
    children: ChildDoc[];
    /** True when text may sit directly inside the element. */
    text: boolean;
}

export interface SchemaDocs {
    elements: ElementDoc[];
    /** The elements that declare elements of their own, e.g. `canvas`, `layout`, `tokens`. */
    scopes: string[];
}

/** Thrown when the schema refers to something it does not define. */
export class SchemaDocsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SchemaDocsError';
    }
}

const BUILTIN_TYPES: Partial<Record<string, { name: string; values?: string[] }>> = {
    string: { name: 'string' },
    boolean: { name: 'boolean', values: ['true', 'false'] },
    anyURI: { name: 'URI' },
    positiveInteger: { name: 'positive integer' },
    decimal: { name: 'decimal' },
};

function builtinType(name: string): TypeDoc {
    const known = BUILTIN_TYPES[name];
    return { name: known?.name ?? name, values: known?.values ?? [], open: known?.values === undefined };
}

function rangeOf(restriction: XsdNode): string | undefined {
    const min = restriction.children.find(child => child.name === 'minInclusive')?.attrs.value;
    const max = restriction.children.find(child => child.name === 'maxInclusive')?.attrs.value;
    if (min !== undefined && max !== undefined) { return `${min}–${max}`; }
    if (min !== undefined) { return `≥ ${min}`; }
    if (max !== undefined) { return `≤ ${max}`; }
    return undefined;
}

/** True when a particle can occur more than once. The XSD default for `maxOccurs` is 1. */
function repeats(particle: XsdNode): boolean {
    return particle.attrs.maxOccurs !== undefined && particle.attrs.maxOccurs !== '1';
}

function addChild(element: ElementDoc, child: ChildDoc): void {
    const existing = element.children.find(other => other.name === child.name && other.kind === child.kind);
    if (existing) {
        existing.many = existing.many || child.many;
    } else {
        element.children.push(child);
    }
}

/** Reads the parts of the schema the hover shows: elements, their attributes, types and children. */
class SchemaReader {
    private readonly _simpleTypes = new Map<string, XsdNode>();
    private readonly _complexTypes = new Map<string, XsdNode>();
    private readonly _attributeGroups = new Map<string, XsdNode>();
    private readonly _groups = new Map<string, XsdNode>();
    private readonly _resolvedTypes = new Map<string, TypeDoc>();
    private readonly _elements: ElementDoc[] = [];
    // `scope/name` of every element added, so a group walked twice adds its elements once.
    private readonly _registered = new Set<string>();

    constructor(private readonly _root: XsdNode) {
        if (_root.name !== 'schema') { throw new SchemaDocsError(`Expected an xs:schema root, found <${_root.name}>`); }
        for (const child of _root.children) {
            switch (child.name) {
                case 'simpleType': this._simpleTypes.set(child.attrs.name, child); break;
                case 'complexType': this._complexTypes.set(child.attrs.name, child); break;
                case 'attributeGroup': this._attributeGroups.set(child.attrs.name, child); break;
                case 'group': this._groups.set(child.attrs.name, child); break;
            }
        }
    }

    read(): SchemaDocs {
        for (const node of this._root.children) {
            if (node.name === 'element') { this._addElement(node, GLOBAL_SCOPE, node.attrs.name); }
        }
        const scopes = [...new Set(this._elements.map(element => element.scope))].filter(scope => scope !== GLOBAL_SCOPE);
        return { elements: this._elements, scopes };
    }

    /**
     * @param scope The scope to file the element under.
     * @param owner The top-level element that any elements declared inside this one belong to.
     */
    private _addElement(node: XsdNode, scope: string, owner: string): void {
        const name = node.attrs.name;
        const key = `${scope}/${name}`;
        if (this._registered.has(key)) { return; }
        this._registered.add(key);

        const complexType = node.children.find(child => child.name === 'complexType')
            ?? this._complexTypes.get(node.attrs.type ?? '');
        const element: ElementDoc = { name, scope, attributes: [], children: [], text: complexType?.attrs.mixed === 'true' };
        this._elements.push(element);
        if (complexType) {
            this._readAttributes(complexType, element, undefined);
            this._readContent(complexType, owner, false, element);
        }
    }

    private _readAttributes(container: XsdNode, element: ElementDoc, group: string | undefined): void {
        for (const child of container.children) {
            if (child.name === 'attribute') {
                const name = child.attrs.name;
                if (element.attributes.some(attribute => attribute.name === name)) { continue; }
                element.attributes.push({ name, type: this._attributeType(child), required: child.attrs.use === 'required', group });
            } else if (child.name === 'attributeGroup' && child.attrs.ref) {
                const referenced = this._attributeGroups.get(child.attrs.ref);
                if (!referenced) { throw new SchemaDocsError(`Unknown attribute group ${child.attrs.ref}`); }
                this._readAttributes(referenced, element, child.attrs.ref);
            }
        }
    }

    /**
     * Walks the content model. With an `element`, records its children. Without one, it is
     * walking a content group only to register the elements the group declares.
     */
    private _readContent(container: XsdNode, owner: string, inRepeat: boolean, element: ElementDoc | undefined): void {
        for (const child of container.children) {
            const many = inRepeat || repeats(child);
            switch (child.name) {
                case 'sequence':
                case 'choice':
                case 'all':
                    this._readContent(child, owner, many, element);
                    break;
                case 'element': {
                    const declared = child.attrs.ref === undefined;
                    if (element) { addChild(element, { name: child.attrs.ref ?? child.attrs.name, kind: 'element', many }); }
                    if (declared) { this._addElement(child, owner, owner); }
                    break;
                }
                case 'group': {
                    const referenced = this._groups.get(child.attrs.ref);
                    if (!referenced) { throw new SchemaDocsError(`Unknown group ${child.attrs.ref}`); }
                    if (element) { addChild(element, { name: child.attrs.ref, kind: 'group', many }); }
                    this._readContent(referenced, owner, false, undefined);
                    break;
                }
            }
        }
    }

    private _attributeType(attribute: XsdNode): TypeDoc {
        const inline = attribute.children.find(child => child.name === 'simpleType');
        return inline ? this._resolveSimpleType(inline, undefined) : this._namedType(attribute.attrs.type ?? 'xs:string');
    }

    private _namedType(qualified: string): TypeDoc {
        if (qualified.startsWith('xs:')) { return builtinType(qualified.slice(3)); }
        const cached = this._resolvedTypes.get(qualified);
        if (cached) { return cached; }
        const node = this._simpleTypes.get(qualified);
        if (!node) { throw new SchemaDocsError(`Unknown type ${qualified}`); }
        const resolved = this._resolveSimpleType(node, qualified);
        this._resolvedTypes.set(qualified, resolved);
        return resolved;
    }

    private _resolveSimpleType(node: XsdNode, name: string | undefined): TypeDoc {
        const body = node.children.find(child => child.name === 'restriction' || child.name === 'union');
        if (!body) { throw new SchemaDocsError(`Type ${name ?? '(unnamed)'} has neither a restriction nor a union`); }
        const resolved = body.name === 'union' ? this._union(body) : this._restriction(body);
        return {
            ...resolved,
            name: name ?? resolved.name,
            // A comment only helps where the values cannot be listed; on an enumeration it is a developer note.
            hint: resolved.open ? node.comment ?? resolved.hint : undefined,
        };
    }

    private _restriction(restriction: XsdNode): TypeDoc {
        const values = restriction.children.filter(child => child.name === 'enumeration').map(child => child.attrs.value);
        if (values.length > 0) { return { name: '', values, open: false }; }
        return { ...this._namedType(restriction.attrs.base), open: true, range: rangeOf(restriction) };
    }

    private _union(union: XsdNode): TypeDoc {
        const members = [
            ...(union.attrs.memberTypes ?? '').split(/\s+/).filter(Boolean).map(member => this._namedType(member)),
            ...union.children.filter(child => child.name === 'simpleType').map(child => this._resolveSimpleType(child, undefined)),
        ];
        return {
            name: '',
            values: [...new Set(members.flatMap(member => member.values))],
            open: members.some(member => member.open),
            hint: members.find(member => member.open && member.hint)?.hint,
        };
    }
}

/**
 * Reads what an XSD says about each element: its attributes and their types, and what may
 * sit inside it. Nothing is written by hand, so the result cannot disagree with the schema
 * that validates the document.
 *
 * @param xsd The schema text, i.e. `lpdf.xsd`.
 * @throws XsdParseError when the text is not well-formed.
 * @throws SchemaDocsError when the schema refers to a type or group it does not define.
 */
export function buildSchemaDocs(xsd: string): SchemaDocs {
    return new SchemaReader(parseXsdTree(xsd)).read();
}

/**
 * Finds an element by name. `scope` picks between elements that share a name, e.g. `text` in
 * `canvas` and in the layout. When the scope has no such element, the global one is used, then any.
 */
export function findElement(docs: SchemaDocs, name: string, scope?: string): ElementDoc | undefined {
    const named = docs.elements.filter(element => element.name === name);
    return named.find(element => element.scope === scope)
        ?? named.find(element => element.scope === GLOBAL_SCOPE)
        ?? named[0];
}
