/**
 * The passwords of an encrypted export. They go to the worker in its message and nowhere else: not to settings,
 * secret storage or the trace.
 */
export interface Passwords {
  /** The password a reader asks for before showing the PDF. Empty: none, anyone can open it. */
  userPassword: string;
  /** The password that opens the PDF with every permission. Never empty. */
  ownerPassword: string;
}

/**
 * What a render says about the encryption a document asks for in its `<output>`: the passwords of an export, or
 * that a preview, which has none, skips it. The cipher and the permissions come from the document.
 */
export interface RenderEncryption {
  passwords?: Passwords;
  skipEncryption?: boolean;
}

/** A problem with what the user typed: an error stops them, a warning lets them go on. */
export interface InputProblem {
  message: string;
  severity: 'error' | 'warning';
}

/** What the preview says, once, about a document that asks for encryption. */
export const PREVIEW_NOT_ENCRYPTED =
  'The preview is not encrypted. The document asks for encryption in its <output>: Export PDF asks for the passwords.';

/**
 * The cipher a document asks for in the `encrypt` of its `<output>`, as written, or undefined when it asks for
 * none. Comments and CDATA, where an example of a document may sit, are not read.
 * @param xml The document the engine renders: the XML, or the template a `.md` file is wrapped in.
 */
export function requestedCipher(xml: string): string | undefined {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const output = /<output\b[^>]*>/.exec(text)?.[0];
  return output === undefined ? undefined : /\bencrypt\s*=\s*(["'])(.*?)\1/.exec(output)?.[2];
}

/** The name of a cipher as people read it: `RC4-128` for `rc4-128`, `AES-256` for the rest. */
export function cipherName(cipher: string): string {
  return cipher === 'rc4-128' ? 'RC4-128' : 'AES-256';
}

/** The longest password, in UTF-8 bytes, the cipher reads: AES-256 reads 127, RC4-128 only 32. */
export function maxPasswordBytes(cipher: string): number {
  return cipher === 'rc4-128' ? 32 : 127;
}

/**
 * Checks a password as it is typed.
 * @param value What is in the box.
 * @param cipher The cipher the document asks for, which sets how long a password can be.
 * @param required True for the owner password, which cannot be empty.
 * @returns The problem with it, or undefined when it is fine. A password with characters outside ASCII
 *          is a warning: the standard asks readers to normalize one first and Lpdf does not, so it may
 *          not open in every reader.
 */
export function checkPassword(value: string, cipher: string, required: boolean): InputProblem | undefined {
  if (required && value === '') {
    return { message: 'The owner password is required. It is the one that opens the PDF with every permission.', severity: 'error' };
  }
  const limit = maxPasswordBytes(cipher);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > limit) {
    return { message: `At most ${limit} bytes (${bytes} typed): ${cipherName(cipher)} would ignore the rest.`, severity: 'error' };
  }
  if (/[^\x00-\x7f]/.test(value)) {
    return { message: 'Characters outside ASCII may not open in every PDF reader.', severity: 'warning' };
  }
  return undefined;
}

/**
 * Checks the second typing of a password.
 * @param value What is in the box.
 * @param original The first typing.
 * @returns An error when they differ, undefined when they match.
 */
export function checkConfirmation(value: string, original: string): InputProblem | undefined {
  return value === original ? undefined : { message: 'The two passwords differ.', severity: 'error' };
}
