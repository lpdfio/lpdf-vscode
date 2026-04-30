import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface WasmCodegen {
    codegen_wasm(xml: string, options_json: string): string;
}

type Target = 'js' | 'dotnet' | 'python' | 'php';

const TARGETS: Array<{ label: string; description: string; target: Target; langId: string }> = [
    { label: 'TypeScript / Node.js', description: '.ts',  target: 'js',     langId: 'typescript' },
    { label: 'C# / .NET',           description: '.cs',  target: 'dotnet', langId: 'csharp'     },
    { label: 'Python',               description: '.py',  target: 'python', langId: 'python'     },
    { label: 'PHP',                  description: '.php', target: 'php',    langId: 'php'        },
];

let _wasm: WasmCodegen | undefined;

function getWasm(extensionPath: string): WasmCodegen {
    if (!_wasm) {
        const wasmPath = path.join(extensionPath, 'wasm', 'lpdf.js');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        _wasm = require(wasmPath) as WasmCodegen;
    }
    return _wasm;
}

function resolveUri(uri?: vscode.Uri): vscode.Uri | undefined {
    return uri ?? vscode.window.activeTextEditor?.document.uri;
}

async function runCodegen(extensionPath: string, xmlUri: vscode.Uri, target: Target): Promise<void> {
    let xml: string;
    try {
        xml = fs.readFileSync(xmlUri.fsPath, 'utf-8');
    } catch (e) {
        void vscode.window.showErrorMessage(`Lpdf: could not read file — ${e instanceof Error ? e.message : String(e)}`);
        return;
    }

    let source: string;
    try {
        source = getWasm(extensionPath).codegen_wasm(xml, JSON.stringify({ target, indent: 4 }));
    } catch (e) {
        void vscode.window.showErrorMessage(`Lpdf: codegen failed — ${e instanceof Error ? e.message : String(e)}`);
        return;
    }

    const langId = TARGETS.find(t => t.target === target)!.langId;
    const doc = await vscode.workspace.openTextDocument({ language: langId, content: source });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function pickAndGenerate(extensionPath: string, uri?: vscode.Uri): Promise<void> {
    const xmlUri = resolveUri(uri);
    if (!xmlUri) { return; }

    const picked = await vscode.window.showQuickPick(TARGETS, {
        title: 'Lpdf: Generate Code',
        placeHolder: 'Choose target language…',
    });
    if (!picked) { return; }

    await runCodegen(extensionPath, xmlUri, picked.target);
}

export function registerCodegenCommands(context: vscode.ExtensionContext): void {
    const ext = context.extensionPath;
    context.subscriptions.push(
        vscode.commands.registerCommand('lpdf.generateTs',   (uri?: vscode.Uri) => { const u = resolveUri(uri); if (u) { return runCodegen(ext, u, 'js'); } }),
        vscode.commands.registerCommand('lpdf.generateCs',   (uri?: vscode.Uri) => { const u = resolveUri(uri); if (u) { return runCodegen(ext, u, 'dotnet'); } }),
        vscode.commands.registerCommand('lpdf.generatePy',   (uri?: vscode.Uri) => { const u = resolveUri(uri); if (u) { return runCodegen(ext, u, 'python'); } }),
        vscode.commands.registerCommand('lpdf.generatePhp',  (uri?: vscode.Uri) => { const u = resolveUri(uri); if (u) { return runCodegen(ext, u, 'php'); } }),
        vscode.commands.registerCommand('lpdf.generateHere', (uri?: vscode.Uri) => pickAndGenerate(ext, uri)),
    );
}
