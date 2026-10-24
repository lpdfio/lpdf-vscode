/** The cipher an encrypted export uses. AES-256 is the default; PDF 2.0 deprecates RC4-128. */
export type EncryptionAlgorithm = 'aes-256' | 'rc4-128';

/** The name of the setting that picks the cipher (`lpdf.encryptionAlgorithm`). */
export const ALGORITHM_SETTING = 'encryptionAlgorithm';

export const DEFAULT_ALGORITHM: EncryptionAlgorithm = 'aes-256';

/** A permission flag, by the name the engine reads. */
export type PermissionKey =
  | 'print' | 'modify' | 'copy' | 'annotate'
  | 'fill_forms' | 'accessibility' | 'assemble' | 'print_hq';

/** What the user is asked to allow, in the order the pick list shows it. */
export const PERMISSIONS: readonly { key: PermissionKey; label: string; detail: string }[] = [
  { key: 'print',         label: 'Print',                           detail: 'Printing' },
  { key: 'print_hq',      label: 'Print at full quality',           detail: 'Without this, printing is limited to low resolution' },
  { key: 'copy',          label: 'Copy text and graphics',          detail: 'Copying and extracting content' },
  { key: 'modify',        label: 'Edit the content',                detail: 'Changing the document' },
  { key: 'annotate',      label: 'Add or change annotations',       detail: 'Comments and markup' },
  { key: 'fill_forms',    label: 'Fill in form fields',             detail: 'Filling in the document\'s fields' },
  { key: 'assemble',      label: 'Insert, delete and rotate pages', detail: 'Assembling the document' },
  { key: 'accessibility', label: 'Read aloud with a screen reader', detail: 'Extracting text for accessibility tools' },
];

/** What an encrypted export is asked to do. */
export interface EncryptionRequest {
  /** The password a reader asks for before showing the PDF. Empty: none, anyone can open it. */
  userPassword: string;
  /** The password that opens the PDF with every permission. Never empty. */
  ownerPassword: string;
  /** Every flag, true where the PDF allows it. */
  permissions: Record<PermissionKey, boolean>;
  algorithm: EncryptionAlgorithm;
}

/** A problem with what the user typed: an error stops them, a warning lets them go on. */
export interface InputProblem {
  message: string;
  severity: 'error' | 'warning';
}

/**
 * The cipher the setting names.
 * @param value The setting's value.
 * @returns `rc4-128` when the setting says so, AES-256 for anything else.
 */
export function algorithmFromSetting(value: unknown): EncryptionAlgorithm {
  return value === 'rc4-128' ? 'rc4-128' : DEFAULT_ALGORITHM;
}

/** The longest password, in UTF-8 bytes, the cipher reads: AES-256 reads 127, RC4-128 only 32. */
export function maxPasswordBytes(algorithm: EncryptionAlgorithm): number {
  return algorithm === 'rc4-128' ? 32 : 127;
}

/**
 * The flags for the permissions the user left ticked.
 * @param allowed The permissions to allow.
 * @returns All eight flags: true for those in `allowed`, false for the rest.
 */
export function permissionsFromAllowed(allowed: readonly PermissionKey[]): Record<PermissionKey, boolean> {
  const flags = {} as Record<PermissionKey, boolean>;
  for (const { key } of PERMISSIONS) { flags[key] = allowed.includes(key); }
  return flags;
}

/**
 * Checks a password as it is typed.
 * @param value What is in the box.
 * @param algorithm The cipher, which sets how long a password can be.
 * @param required True for the owner password, which cannot be empty.
 * @returns The problem with it, or undefined when it is fine. A password with characters outside ASCII
 *          is a warning: the standard asks readers to normalize one first and Lpdf does not, so it may
 *          not open in every reader.
 */
export function checkPassword(value: string, algorithm: EncryptionAlgorithm, required: boolean): InputProblem | undefined {
  if (required && value === '') {
    return { message: 'The owner password is required. It is the one that opens the PDF with every permission.', severity: 'error' };
  }
  const limit = maxPasswordBytes(algorithm);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > limit) {
    return { message: `At most ${limit} bytes (${bytes} typed): ${algorithm === 'rc4-128' ? 'RC4-128' : 'AES-256'} would ignore the rest.`, severity: 'error' };
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

/**
 * A line saying what an encrypted export got, for the message after it is saved.
 * @param request What the export was asked to do.
 * @returns For example `AES-256, open password required, 2 permissions off`.
 */
export function describeEncryption(request: EncryptionRequest): string {
  const cipher = request.algorithm === 'rc4-128' ? 'RC4-128' : 'AES-256';
  const open = request.userPassword === '' ? 'no open password' : 'open password required';
  const denied = PERMISSIONS.filter(p => !request.permissions[p.key]).map(p => p.label.toLowerCase());
  return `${cipher}, ${open}${denied.length > 0 ? `, ${denied.length} permission${denied.length === 1 ? '' : 's'} off` : ', every permission allowed'}`;
}

/**
 * Whether the request protects nothing: anyone can open the PDF and every permission is on.
 * @param request What the export was asked to do.
 */
export function protectsNothing(request: EncryptionRequest): boolean {
  return request.userPassword === '' && PERMISSIONS.every(p => request.permissions[p.key]);
}
