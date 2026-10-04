import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { sidecarDataPath } from './data';
import { DocumentTemplate, loadTemplates } from './templates';

/** The folder of starters inside the extension; see templates.ts for what goes in it. */
const TEMPLATES_FOLDER = 'templates';

interface TemplateItem extends vscode.QuickPickItem {
  template: DocumentTemplate;
}

/**
 * Registers **Lpdf: New Document...**, which the command palette, File > New File... and a
 * folder's context menu in the Explorer offer.
 */
export function registerNewDocumentCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('lpdf.newDocument', (target?: vscode.Uri) => newDocument(context.extensionPath, target)),
  );
}

/**
 * Starts a document from a template: the user picks a template and where to save it; the XML, the
 * template's data and its fonts and images next to it, are written there; the XML opens with its
 * preview beside it.
 * @param extensionPath The extension's folder, which holds the templates.
 * @param target The folder the Explorer's context menu was opened on, if it was; the file's folder for a file.
 * @returns The new document, or undefined when nothing was created.
 */
export async function newDocument(extensionPath: string, target?: vscode.Uri): Promise<vscode.Uri | undefined> {
  let templates: DocumentTemplate[];
  try {
    templates = loadTemplates(path.join(extensionPath, TEMPLATES_FOLDER));
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: ${(error as Error).message}`);
    return undefined;
  }
  const items: TemplateItem[] = templates.map(template => ({ label: template.label, detail: template.description, template }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Lpdf: New Document', placeHolder: 'Choose a template' });
  if (!picked) { return undefined; }
  const { template } = picked;

  const folder = await startFolder(target);
  const xmlUri = await vscode.window.showSaveDialog({
    title: 'Save the new Lpdf document',
    defaultUri: folder
      ? vscode.Uri.joinPath(folder, `${template.fileName}.xml`)
      : vscode.Uri.file(path.join(os.homedir(), `${template.fileName}.xml`)),
    filters: { 'Lpdf XML': ['xml'] },
  });
  if (!xmlUri) { return undefined; }

  // The save dialog has asked about replacing the XML; the data next to it is asked about here.
  const dataUri = template.dataPath
    ? vscode.Uri.joinPath(xmlUri, '..', path.basename(sidecarDataPath(xmlUri.fsPath)))
    : undefined;
  if (dataUri && await exists(dataUri)) {
    const replace = 'Replace';
    const answer = await vscode.window.showWarningMessage(
      `${path.basename(dataUri.fsPath)} is already there. Replace it with the template's data?`,
      { modal: true, detail: 'The new document reads its data from the .json file with the same name.' },
      replace,
    );
    if (answer !== replace) { return undefined; }
  }

  // The fonts and images go where the XML names them, `assets/...` next to it. A file that is there
  // already and the same is left alone; one that differs is asked about, as the data is.
  const assets = await assetsToWrite(template, xmlUri);
  const differing = assets.filter(asset => asset.differs);
  if (differing.length > 0) {
    const replace = 'Replace';
    const answer = await vscode.window.showWarningMessage(
      `${differing.length === 1 ? differing[0].relativePath + ' is' : differing.length + ' files in assets/ are'} already there. Replace ${differing.length === 1 ? 'it' : 'them'} with the template's?`,
      { modal: true, detail: 'The new document names its fonts and images in the assets folder next to it.' },
      replace,
    );
    if (answer !== replace) { return undefined; }
  }

  try {
    await vscode.workspace.fs.writeFile(xmlUri, fs.readFileSync(template.xmlPath));
    if (dataUri && template.dataPath) { await vscode.workspace.fs.writeFile(dataUri, fs.readFileSync(template.dataPath)); }
    for (const asset of assets) {
      if (asset.write) { await vscode.workspace.fs.writeFile(asset.uri, fs.readFileSync(asset.sourcePath)); }
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Lpdf: could not create ${path.basename(xmlUri.fsPath)}: ${(error as Error).message}`);
    return undefined;
  }

  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(xmlUri));
  await vscode.commands.executeCommand('lpdf.previewPdf', xmlUri);
  return xmlUri;
}

interface PlannedAsset {
  relativePath: string;
  sourcePath: string;
  /** Where it is written. */
  uri: vscode.Uri;
  /** False when the same file is there already. */
  write: boolean;
  /** True when a different file is there. */
  differs: boolean;
}

/** Where each of a template's assets goes next to the new document, and whether it needs writing. */
async function assetsToWrite(template: DocumentTemplate, xmlUri: vscode.Uri): Promise<PlannedAsset[]> {
  const planned: PlannedAsset[] = [];
  for (const asset of template.assets) {
    const uri = vscode.Uri.joinPath(xmlUri, '..', ...asset.relativePath.split('/'));
    const present = await readIfThere(uri);
    const same = present !== undefined && Buffer.from(present).equals(fs.readFileSync(asset.sourcePath));
    planned.push({ ...asset, uri, write: !same, differs: present !== undefined && !same });
  }
  return planned;
}

async function readIfThere(uri: vscode.Uri): Promise<Uint8Array | undefined> {
  try {
    return await vscode.workspace.fs.readFile(uri);
  } catch {
    return undefined;
  }
}

/** The folder the save dialog starts in: the one the Explorer menu was opened on, else the first workspace folder. */
async function startFolder(target?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (target) {
    try {
      const stat = await vscode.workspace.fs.stat(target);
      return stat.type & vscode.FileType.Directory ? target : vscode.Uri.joinPath(target, '..');
    } catch { /* gone since the menu opened; fall back below */ }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
