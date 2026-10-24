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
