import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { buildLibraryPageHtml } from './library-page-html';
import { FOR_EACH_REF_ARGS, listRefs, missingVersionMessage, type GitRef } from './pdf-diff-refs';

/** Runs git in the repository and returns the raw stdout bytes as a Buffer. */
function runGit(repoPath: string, args: readonly string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const proc = spawn('git', args, { cwd: repoPath });
        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.on('close', code => {
            if (code === 0) { resolve(Buffer.concat(chunks)); }
            else { reject(new Error(`git ${args[0]} exited ${code}`)); }
        });
        proc.on('error', reject);
    });
}

// Minimal type declarations for the VS Code built-in git extension API.
interface GitRepository {
    readonly rootUri: vscode.Uri;
    show(ref: string, filePath: string): Promise<string>;
}

interface GitApi {
    readonly repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
    getAPI(version: 1): GitApi;
}

function buildDiffWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const viewerDir = vscode.Uri.joinPath(context.extensionUri, 'media', 'viewer');
    return buildLibraryPageHtml({
        pageHtml: fs.readFileSync(path.join(context.extensionPath, 'media', 'pdf-diff.html'), 'utf8'),
        viewerRoot: webview.asWebviewUri(viewerDir).toString(),
        cspSource: webview.cspSource,
        nonce: randomBytes(16).toString('hex'),
    });
}

/** What the left side is read from: its full name for git, and the name its labels show. */
type LeftRef = Pick<GitRef, 'ref' | 'name'>;

/** The version in the last commit, which "Compare PDF with HEAD" compares with. */
const HEAD: LeftRef = { ref: 'HEAD', name: 'HEAD' };

/** A PDF to compare, and where it is in its repository. */
interface DiffTarget {
    readonly fileUri: vscode.Uri;
    readonly repoPath: string;
    readonly relPath: string;
}

/** The PDF the command was run on and its repository, or undefined after telling the user why there is none. */
async function findTarget(uri?: vscode.Uri): Promise<DiffTarget | undefined> {
    const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) {
        void vscode.window.showErrorMessage('Lpdf: No PDF file selected.');
        return undefined;
    }

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        void vscode.window.showErrorMessage('Lpdf: Git extension is not available.');
        return undefined;
    }

    const gitApi = (gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate() as GitExtension
    ).getAPI(1);

    let repo = gitApi.getRepository(fileUri);
    if (!repo) {
        // Fallback: find the repo whose root is a parent of the file path.
        repo = gitApi.repositories.find(
            r => fileUri.fsPath.startsWith(r.rootUri.fsPath),
        ) ?? null;
    }
    if (!repo) {
        void vscode.window.showErrorMessage('Lpdf: No git repository found for this file.');
        return undefined;
    }

    const repoPath = repo.rootUri.fsPath;
    return { fileUri, repoPath, relPath: path.relative(repoPath, fileUri.fsPath).replace(/\\/g, '/') };
}

/** Opens the diff view: the PDF at the ref on the left, labelled with the ref's name, and the working copy on the right. */
async function showDiff(context: vscode.ExtensionContext, target: DiffTarget, ref: LeftRef): Promise<void> {
    const filename = path.basename(target.fileUri.fsPath);

    let oldBase64: string;
    try {
        const buf = await runGit(target.repoPath, ['show', `${ref.ref}:${target.relPath}`]);
        oldBase64 = buf.toString('base64');
    } catch {
        void vscode.window.showErrorMessage(missingVersionMessage(filename, ref.name));
        return;
    }

    const newBytes  = await vscode.workspace.fs.readFile(target.fileUri);
    const newBase64 = Buffer.from(newBytes).toString('base64');

    const panel = vscode.window.createWebviewPanel(
        'lpdf.pdfDiff',
        `Diff: ${filename}`,
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        },
    );

    panel.webview.html = buildDiffWebviewHtml(context, panel.webview);

    panel.webview.onDidReceiveMessage((msg: { type: string }) => {
        if (msg.type === 'ready') {
            void panel.webview.postMessage({ type: 'updateDiff', oldBase64, newBase64, filename, leftLabel: ref.name });
        }
    });
}

/** "Lpdf: Compare PDF with HEAD": the PDF as of the last commit against the working copy. */
export async function diffPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
    const target = await findTarget(uri);
    if (target) { await showDiff(context, target, HEAD); }
}

/**
 * "Lpdf: Compare PDF with branch...": asks for a branch or tag of the PDF's repository, the local
 * default branch first, and compares the PDF at it with the working copy.
 */
export async function diffPdfWithRef(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
    const target = await findTarget(uri);
    if (!target) { return; }

    let refs: GitRef[];
    try {
        refs = listRefs((await runGit(target.repoPath, FOR_EACH_REF_ARGS)).toString('utf8'));
    } catch {
        void vscode.window.showErrorMessage('Lpdf: The branches and tags of this repository could not be read.');
        return;
    }

    const filename = path.basename(target.fileUri.fsPath);
    const picked = await vscode.window.showQuickPick(
        refs.map(ref => ({ label: ref.name, description: ref.kind, ref })),
        { title: `Compare ${filename} with`, placeHolder: 'A branch or tag' },
    );
    if (picked) { await showDiff(context, target, picked.ref); }
}
