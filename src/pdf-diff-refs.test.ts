import { describe, expect, it } from 'vitest';
import { FOR_EACH_REF_ARGS, listRefs, missingVersionMessage } from './pdf-diff-refs';

/** What `git for-each-ref` prints for these lines of full name and symbolic target, newest first. */
const listing = (...lines: [string, string?][]) => lines.map(([ref, target = '']) => `${ref}\0${target}`).join('\n') + '\n';

/** A repository on a work branch, newer than main, with a tag and origin's branches. */
const REPO = listing(
    ['refs/heads/fix-header'],
    ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
    ['refs/remotes/origin/main'],
    ['refs/tags/v0.30.0'],
    ['refs/heads/main'],
    ['refs/remotes/origin/new-cover'],
    ['refs/heads/old-work'],
    ['refs/tags/v0.29.0'],
);

describe('the branches and tags of the picker', () => {
    it('asks git for every branch, remote branch and tag, the newest first, with what a symbolic ref points to', () => {
        expect(FOR_EACH_REF_ARGS).toEqual([
            'for-each-ref', '--sort=-creatordate', '--format=%(refname)%00%(symref)',
            'refs/heads', 'refs/remotes', 'refs/tags',
        ]);
    });

    it('puts the local default branch first, then the local branches, the remote branches and the tags, each newest first', () => {
        expect(listRefs(REPO).map(r => r.name)).toEqual([
            'main', 'fix-header', 'old-work', 'origin/main', 'origin/new-cover', 'v0.30.0', 'v0.29.0',
        ]);
    });

    it('puts the local default branch first, not the remote one of the same name', () => {
        const [first] = listRefs(REPO);
        expect(first).toEqual({ ref: 'refs/heads/main', name: 'main', kind: 'branch' });
    });

    it('says what kind each one is and keeps its full name, so a branch and a tag of the same name do not mix', () => {
        const refs = listRefs(listing(['refs/heads/release'], ['refs/tags/release'], ['refs/remotes/origin/release']));
        expect(refs).toEqual([
            { ref: 'refs/heads/release', name: 'release', kind: 'branch' },
            { ref: 'refs/remotes/origin/release', name: 'origin/release', kind: 'remote branch' },
            { ref: 'refs/tags/release', name: 'release', kind: 'tag' },
        ]);
    });

    it('does not list origin/HEAD, which is only a pointer to the default branch', () => {
        expect(listRefs(REPO).some(r => r.name.endsWith('/HEAD'))).toBe(false);
    });

    it('takes the default branch from origin/HEAD whatever its name', () => {
        const refs = listRefs(listing(
            ['refs/heads/main'],
            ['refs/heads/develop'],
            ['refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'],
        ));
        expect(refs.map(r => r.name)).toEqual(['develop', 'main']);
    });

    it('prefers the HEAD of origin to that of another remote', () => {
        const refs = listRefs(listing(
            ['refs/heads/trunk'],
            ['refs/heads/main'],
            ['refs/remotes/upstream/HEAD', 'refs/remotes/upstream/trunk'],
            ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
        ));
        expect(refs[0].name).toBe('main');
    });

    it('takes the HEAD of another remote when there is no origin', () => {
        const refs = listRefs(listing(['refs/heads/main'], ['refs/heads/trunk'], ['refs/remotes/upstream/HEAD', 'refs/remotes/upstream/trunk']));
        expect(refs[0].name).toBe('trunk');
    });

    it('takes main, else master, as the default branch of a repository with no remote HEAD', () => {
        expect(listRefs(listing(['refs/heads/work'], ['refs/heads/master'], ['refs/heads/main']))[0].name).toBe('main');
        expect(listRefs(listing(['refs/heads/work'], ['refs/heads/master']))[0].name).toBe('master');
        expect(listRefs(listing(['refs/heads/work'], ['refs/heads/other'])).map(r => r.name)).toEqual(['work', 'other']);
    });

    it('reads a listing with Windows line ends', () => {
        expect(listRefs(REPO.replace(/\n/g, '\r\n')).map(r => r.name)).toEqual(listRefs(REPO).map(r => r.name));
    });

    it('is empty for a repository with no branches or tags', () => {
        expect(listRefs('')).toEqual([]);
    });
});

describe('the error for a PDF the chosen ref has no version of', () => {
    it('names the file and the ref', () => {
        expect(missingVersionMessage('report.pdf', 'main')).toBe('Lpdf: report.pdf has no version at main.');
    });
});
