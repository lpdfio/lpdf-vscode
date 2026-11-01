import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: { parse: (text: string) => ({ fsPath: text.replace(/^file:\/\//, '') }) },
  workspace: { getWorkspaceFolder: () => undefined },
}));
vi.mock('./engine', () => ({ LpdfRenderError: class extends Error {} }));

import * as vscode from 'vscode';
import { loadAssets } from './assets';

let folder: string;
const documentUri = (): vscode.Uri => ({ scheme: 'file', fsPath: path.join(folder, 'invoice.xml') }) as vscode.Uri;
const withAttachments = (files: string): string =>
  `<lpdf version="1"><document><attachments>${files}</attachments><section/></document></lpdf>`;

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lpdf-assets-'));
  fs.writeFileSync(path.join(folder, 'invoice-data.xml'), '<invoice/>');
});

describe('loadAssets of the color profiles a document declares', () => {
  const withProfiles = (profiles: string): string =>
    `<lpdf version="1"><assets>${profiles}</assets><document><section/></document></lpdf>`;

  it('reads each profile from its src next to the document, under its ref or name, and watches it', async () => {
    fs.writeFileSync(path.join(folder, 'press.icc'), 'not really a profile');
    const loaded = await loadAssets(withProfiles('<profile name="press" src="press.icc"/><profile name="other" ref="fogra39" src="press.icc"/>'), documentUri());
    expect([...loaded.assets.profiles!.keys()]).toEqual(['press', 'fogra39']);
    expect(Buffer.from(loaded.assets.profiles!.get('press')!).toString()).toBe('not really a profile');
    expect(loaded.files).toContain(path.join(folder, 'press.icc'));
  });

  it('is an error that names a profile with no src, or one whose src is not there', async () => {
    await expect(loadAssets(withProfiles('<profile name="press"/>'), documentUri())).rejects.toThrow("profile 'press' has no src");
    await expect(loadAssets(withProfiles('<profile name="press" src="missing.icc"/>'), documentUri())).rejects.toThrow(/profile 'press': cannot find missing\.icc/);
  });
});

describe('loadAssets of the files a document carries', () => {
  it('reads each file from its src next to the document, under its ref or name, and watches it', async () => {
    const xml = withAttachments('<file name="invoice.xml" src="invoice-data.xml"/><file name="copy.xml" ref="copy" src="invoice-data.xml"/>');
    const loaded = await loadAssets(xml, documentUri());
    expect([...loaded.assets.files!.keys()]).toEqual(['invoice.xml', 'copy']);
    expect(Buffer.from(loaded.assets.files!.get('invoice.xml')!).toString()).toBe('<invoice/>');
    expect(loaded.files).toContain(path.join(folder, 'invoice-data.xml'));
  });

  it('is an error that names a file with no src, or one whose src is not there', async () => {
    await expect(loadAssets(withAttachments('<file name="a.xml"/>'), documentUri())).rejects.toThrow("file 'a.xml' has no src");
    await expect(loadAssets(withAttachments('<file name="b.xml" src="missing.xml"/>'), documentUri())).rejects.toThrow(/file 'b\.xml': cannot find missing\.xml/);
  });

  it('leaves out a file in a comment', async () => {
    const loaded = await loadAssets(withAttachments('<!-- <file name="a.xml"/> -->'), documentUri());
    expect(loaded.assets.files!.size).toBe(0);
  });

  it('leaves out what a CDATA section shows as text, a file or an image', async () => {
    const xml = '<lpdf version="1"><document><section><layout>'
      + '<code><![CDATA[<attachments><file name="a.xml" src="missing.xml"/></attachments>]]></code>'
      + '<code><![CDATA[<assets><image name="logo" src="missing.png"/></assets>]]></code>'
      + '</layout></section></document></lpdf>';
    const loaded = await loadAssets(xml, documentUri());
    expect(loaded.assets.files!.size).toBe(0);
    expect(loaded.assets.images.size).toBe(0);
  });
});
