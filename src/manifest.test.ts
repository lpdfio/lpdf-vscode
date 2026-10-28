import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALGORITHM_SETTING, DEFAULT_ALGORITHM } from './encryption';

const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string; title: string }[];
    menus: Record<string, { command: string; when?: string; group?: string }[]>;
    configuration: { properties: Record<string, { type: string; enum?: string[]; default?: string; scope?: string }> };
  };
};
const extensionSource = readFileSync(join(__dirname, 'extension.ts'), 'utf8');

describe('the Markdown preview in the manifest', () => {
  const entries = manifest.contributes.menus['explorer/context'].filter(e => e.when === 'resourceLangId == markdown');

  it('has the commands for the styles, the Lpdf document and the linked file that the extension registers', () => {
    for (const name of [
      'linkMarkdownStyles', 'unlinkMarkdownStyles',
      'createLpdfDocument', 'unlinkLpdfDocument', 'linkMarkdownFile', 'unlinkMarkdownFile',
    ]) {
      expect(manifest.contributes.commands.some(c => c.command === `lpdf.${name}`), name).toBe(true);
      expect(extensionSource).toContain(`registerCommand('lpdf.${name}'`);
    }
  });

  it('offers preview, export, the styles and the Lpdf document on a .md file in the Explorer, each in a group of its own', () => {
    expect(entries.map(e => e.command)).toEqual([
      'lpdf.previewPdf', 'lpdf.exportPdf', 'lpdf.exportEncryptedPdf',
      'lpdf.linkMarkdownStyles', 'lpdf.createLpdfDocument',
    ]);
    expect(new Set(entries.map(e => e.group)).size).toBe(entries.length);
  });

  it('has no command for a template, since the Lpdf document is the template', () => {
    expect(manifest.contributes.commands.filter(c => /template/i.test(c.command))).toEqual([]);
    expect(extensionSource).not.toMatch(/Template'/);
  });

  it('shows the preview button on a .md file in the editor title', () => {
    const button = manifest.contributes.menus['editor/title'].find(e => e.when === 'resourceLangId == markdown');
    expect(button?.command).toBe('lpdf.previewPdf');
  });

  it('wakes up on Markdown, as it does on XML', () => {
    const activation = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { activationEvents: string[] };
    expect(activation.activationEvents).toContain('onLanguage:markdown');
  });
});

describe('the encrypted export in the manifest', () => {
  it('has a command that the extension registers', () => {
    const command = manifest.contributes.commands.find(c => c.command === 'lpdf.exportEncryptedPdf');
    expect(command?.title).toBe('Lpdf: Export Encrypted PDF...');
    expect(extensionSource).toContain(`registerCommand('lpdf.exportEncryptedPdf'`);
  });

  it('is offered on an XML file in the Explorer, beside Export PDF', () => {
    const entries = manifest.contributes.menus['explorer/context'];
    const encrypted = entries.find(e => e.command === 'lpdf.exportEncryptedPdf');
    expect(encrypted?.when).toBe('resourceExtname == .xml');
    const groups = entries.filter(e => e.when === 'resourceExtname == .xml').map(e => e.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('has a user-level setting for the cipher, AES-256 by default', () => {
    const setting = manifest.contributes.configuration.properties[`lpdf.${ALGORITHM_SETTING}`];
    expect(setting.enum).toEqual(['aes-256', 'rc4-128']);
    expect(setting.default).toBe(DEFAULT_ALGORITHM);
    expect(setting.scope).toBe('application');
  });
});
