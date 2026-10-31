import { describe, expect, it } from 'vitest';
import { checkConfirmation, checkPassword, cipherName, maxPasswordBytes, requestedCipher } from './encryption';

describe('requestedCipher', () => {
  it('reads the encrypt of the document\'s <output>', () => {
    expect(requestedCipher('<lpdf version="1"><document><output encrypt="aes-256" allow="print"/><section/></document></lpdf>'))
      .toBe('aes-256');
    expect(requestedCipher('<document><output allow="" encrypt=\'rc4-128\' ></output></document>')).toBe('rc4-128');
  });

  it('is undefined for a document with no <output>, or one that does not encrypt', () => {
    expect(requestedCipher('<lpdf version="1"><document><section/></document></lpdf>')).toBeUndefined();
    expect(requestedCipher('<lpdf version="1"><document><output/><section/></document></lpdf>')).toBeUndefined();
  });

  it('does not read a comment or a CDATA, where an example of a document can sit', () => {
    expect(requestedCipher('<document><!-- <output encrypt="aes-256"/> --><section/></document>')).toBeUndefined();
    expect(requestedCipher('<document><section><code><![CDATA[<output encrypt="aes-256"/>]]></code></section></document>')).toBeUndefined();
  });

  it('does not take another element whose name starts with output', () => {
    expect(requestedCipher('<document><outputs encrypt="aes-256"/></document>')).toBeUndefined();
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
    expect(checkPassword('a'.repeat(33), 'rc4-128', true)).toMatchObject({ severity: 'error', message: expect.stringContaining('RC4-128') });
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

describe('cipherName', () => {
  it('names the two ciphers as people read them', () => {
    expect(cipherName('aes-256')).toBe('AES-256');
    expect(cipherName('rc4-128')).toBe('RC4-128');
  });
});
