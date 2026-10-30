/** A branch or tag that a PDF can be compared with. */
export interface GitRef {
    /** The full name, such as `refs/heads/main`, which a branch and a tag of the same name cannot mix up. */
    readonly ref: string;
    /** The name to show, such as `main`, `origin/main` or `v0.30.0`. */
    readonly name: string;
    readonly kind: GitRefKind;
}

export type GitRefKind = 'branch' | 'remote branch' | 'tag';

/**
 * The arguments of the `git for-each-ref` that `listRefs` reads: every branch, remote branch and
 * tag, the newest first, each with what it points to when it is a symbolic ref such as `origin/HEAD`.
 */
export const FOR_EACH_REF_ARGS: readonly string[] = [
    'for-each-ref', '--sort=-creatordate', '--format=%(refname)%00%(symref)',
    'refs/heads', 'refs/remotes', 'refs/tags',
];

const KIND_ORDER: readonly GitRefKind[] = ['branch', 'remote branch', 'tag'];

/** The prefix of each kind's full names. */
const PREFIXES: ReadonlyArray<[string, GitRefKind]> = [
    ['refs/heads/', 'branch'],
    ['refs/remotes/', 'remote branch'],
    ['refs/tags/', 'tag'],
];

/**
 * The branches and tags of a repository, in the order the picker shows them: the local default
 * branch first, then the other local branches, the remote branches and the tags, each newest first.
 * The default branch is the one `origin/HEAD` points to (another remote's HEAD when there is no
 * origin), else `main`, else `master`. The local branch of that name comes first, not the remote one.
 * @param listing What `git for-each-ref` printed for `FOR_EACH_REF_ARGS`.
 */
export function listRefs(listing: string): GitRef[] {
    const refs: GitRef[] = [];
    const remoteDefaults = new Map<string, string>();
    for (const line of listing.split(/\r?\n/)) {
        const [ref, target] = line.split('\0');
        if (!ref) { continue; }
        const remoteHead = /^refs\/remotes\/([^/]+)\/HEAD$/.exec(ref);
        if (remoteHead) {
            const prefix = `refs/remotes/${remoteHead[1]}/`;
            if (target?.startsWith(prefix)) { remoteDefaults.set(remoteHead[1], target.slice(prefix.length)); }
            continue;
        }
        const entry = PREFIXES.find(([prefix]) => ref.startsWith(prefix));
        if (entry) { refs.push({ ref, name: ref.slice(entry[0].length), kind: entry[1] }); }
    }

    const hasBranch = (name: string) => refs.some(r => r.kind === 'branch' && r.name === name);
    const defaultName = remoteDefaults.get('origin')
        ?? remoteDefaults.values().next().value
        ?? ['main', 'master'].find(hasBranch);
    const rank = (r: GitRef) => r.kind === 'branch' && r.name === defaultName ? -1 : KIND_ORDER.indexOf(r.kind);
    return refs.sort((a, b) => rank(a) - rank(b));
}

/** The error for a PDF that the chosen branch or tag has no version of. */
export function missingVersionMessage(fileName: string, refName: string): string {
    return `Lpdf: ${fileName} has no version at ${refName}.`;
}
