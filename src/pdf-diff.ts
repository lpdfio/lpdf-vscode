import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/** Runs `git show <ref>:<relPath>` and returns the raw stdout bytes as a Buffer. */
function gitShowBuffer(repoPath: string, relPath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const proc = spawn('git', ['show', `HEAD:${relPath}`], { cwd: repoPath });
        proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        proc.on('close', code => {
            if (code === 0) { resolve(Buffer.concat(chunks)); }
            else { reject(new Error(`git show exited ${code}`)); }
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
    const mediaUri  = vscode.Uri.joinPath(context.extensionUri, 'media');
    const pdfJsUri  = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'pdf.min.mjs'));
    const workerUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'pdf.worker.min.mjs'));
    const nonce     = randomBytes(16).toString('hex');
    const htmlPath  = path.join(context.extensionPath, 'media', 'pdf-diff.html');
    return fs.readFileSync(htmlPath, 'utf8')
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__NONCE__/g, nonce)
        .replace('__PDF_JS_URI__', pdfJsUri.toString())
        .replace('__WORKER_URI__', workerUri.toString());
}

export async function diffPdf(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
    const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) {
        void vscode.window.showErrorMessage('Lpdf: No PDF file selected.');
        return;
    }

    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExtension) {
        void vscode.window.showErrorMessage('Lpdf: Git extension is not available.');
        return;
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
        return;
    }

    const relPath = path.relative(repo.rootUri.fsPath, fileUri.fsPath).replace(/\\/g, '/');

    let oldBase64: string;
    try {
        const buf = await gitShowBuffer(repo.rootUri.fsPath, relPath);
        oldBase64 = buf.toString('base64');
    } catch {
        void vscode.window.showErrorMessage('Lpdf: File has no previous version in git HEAD.');
        return;
    }

    const newBytes  = await vscode.workspace.fs.readFile(fileUri);
    const newBase64 = Buffer.from(newBytes).toString('base64');
    const filename  = path.basename(fileUri.fsPath);

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
            void panel.webview.postMessage({ type: 'updateDiff', oldBase64, newBase64, filename });
        }
    });
}
