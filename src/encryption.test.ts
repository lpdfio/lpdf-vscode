import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS, algorithmFromSetting, checkConfirmation, checkPassword, describeEncryption,
  maxPasswordBytes, permissionsFromAllowed, protectsNothing, type EncryptionRequest, type PermissionKey,
} from './encryption';

const ALL = PERMISSIONS.map(p => p.key);

function request(overrides: Partial<EncryptionRequest> = {}): EncryptionRequest {
  return { userPassword: 'open', ownerPassword: 'owner', permissions: permissionsFromAllowed(ALL), algorithm: 'aes-256', ...overrides };
}

describe('the permissions', () => {
  it('lists the eight flags the engine reads, each once', () => {
    expect([...ALL].sort()).toEqual(
      ['accessibility', 'annotate', 'assemble', 'copy', 'fill_forms', 'modify', 'print', 'print_hq'],
    );
  });

  it('turns the ticked ones into true and the rest into false', () => {
    const flags = permissionsFromAllowed(['print', 'fill_forms']);
    expect(flags).toEqual({
      print: true, fill_forms: true,
      modify: false, copy: false, annotate: false, accessibility: false, assemble: false, print_hq: false,
    });
  });

  it('turns an empty selection into all false', () => {
    expect(Object.values(permissionsFromAllowed([])).every(flag => flag === false)).toBe(true);
  });
});

describe('algorithmFromSetting', () => {
  it('is AES-256 unless the setting says rc4-128', () => {
    expect(algorithmFromSetting('rc4-128')).toBe('rc4-128');
    expect(algorithmFromSetting('aes-256')).toBe('aes-256');
    expect(algorithmFromSetting(undefined)).toBe('aes-256');
    expect(algorithmFromSetting('aes-128')).toBe('aes-256');
  });
});

describe('checkPassword', () => {
  it('requires the owner password', () => {
    expect(checkPassword('', 'aes-256', true)).toMatchObject({ severity: 'error' });
    expect(checkPassword('x', 'aes-256', true)).toBeUndefined();
  });

  it('lets the open password be empty', () => {
    expect(checkPassword('', 'aes-256', false)).toBeUndefined();
  });

  it('reads 127 bytes for AES-256 and 32 for RC4-128', () => {
    expect(maxPasswordBytes('aes-256')).toBe(127);
    expect(maxPasswordBytes('rc4-128')).toBe(32);
    expect(checkPassword('a'.repeat(127), 'aes-256', true)).toBeUndefined();
    expect(checkPassword('a'.repeat(128), 'aes-256', true)).toMatchObject({ severity: 'error' });
    expect(checkPassword('a'.repeat(32), 'rc4-128', true)).toBeUndefined();
    expect(checkPassword('a'.repeat(33), 'rc4-128', true)).toMatchObject({ severity: 'error' });
  });

  it('counts bytes, not characters', () => {
    // 'é' is two bytes in UTF-8: 64 of them are 128 bytes.
    expect(checkPassword('é'.repeat(64), 'aes-256', true)).toMatchObject({ severity: 'error' });
  });

  it('warns about characters outside ASCII without stopping the user', () => {
    expect(checkPassword('pässword', 'aes-256', true)).toMatchObject({ severity: 'warning' });
  });
});

describe('checkConfirmation', () => {
  it('accepts the same password and refuses another', () => {
    expect(checkConfirmation('secret', 'secret')).toBeUndefined();
    expect(checkConfirmation('secrett', 'secret')).toMatchObject({ severity: 'error' });
    expect(checkConfirmation('', 'secret')).toMatchObject({ severity: 'error' });
  });
});

describe('describeEncryption', () => {
  it('names the cipher, the open password and what is off', () => {
    const flags = permissionsFromAllowed(ALL.filter(key => key !== 'copy' && key !== 'modify'));
    expect(describeEncryption(request({ permissions: flags }))).toBe('AES-256, open password required, 2 permissions off');
  });

  it('says so when nothing is restricted and there is no open password', () => {
    expect(describeEncryption(request({ userPassword: '', algorithm: 'rc4-128' })))
      .toBe('RC4-128, no open password, every permission allowed');
  });

  it('uses the singular for one permission', () => {
    const flags = permissionsFromAllowed(ALL.filter(key => key !== 'print' as PermissionKey));
    expect(describeEncryption(request({ permissions: flags }))).toContain('1 permission off');
  });

  it('never contains a password', () => {
    const text = describeEncryption(request({ userPassword: 'hunter2-open', ownerPassword: 'hunter2-owner' }));
    expect(text).not.toContain('hunter2');
  });
});

describe('protectsNothing', () => {
  it('is true only with no open password and every permission allowed', () => {
    expect(protectsNothing(request({ userPassword: '' }))).toBe(true);
    expect(protectsNothing(request({ userPassword: 'open' }))).toBe(false);
    expect(protectsNothing(request({ userPassword: '', permissions: permissionsFromAllowed(['print']) }))).toBe(false);
  });
});
