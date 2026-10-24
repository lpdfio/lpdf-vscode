import * as vscode from 'vscode';
import {
  PERMISSIONS, checkConfirmation, checkPassword, permissionsFromAllowed, protectsNothing,
  type EncryptionAlgorithm, type EncryptionRequest, type InputProblem, type PermissionKey,
} from './encryption';

const TITLE = 'Lpdf: Export Encrypted PDF';
const CONTINUE = 'Continue';

/** What an input box shows for a problem with the text in it. */
function toMessage(problem: InputProblem | undefined): vscode.InputBoxValidationMessage | undefined {
  if (!problem) { return undefined; }
  const severity = problem.severity === 'error' ? vscode.InputBoxValidationSeverity.Error : vscode.InputBoxValidationSeverity.Warning;
  return { message: problem.message, severity };
}

/** A password box that stays up when VS Code loses focus, so the user can look the password up. */
function askPassword(prompt: string, validateInput: (value: string) => InputProblem | undefined): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: TITLE,
    prompt,
    password: true,
    ignoreFocusOut: true,
    validateInput: value => toMessage(validateInput(value)),
  });
}

/**
 * Asks for a password and then for the same one again. Neither is stored anywhere.
 * @returns The password (empty when `required` is false and the user left it empty), or undefined
 *          when the user cancelled either box.
 */
async function askPasswordTwice(
  prompt: string,
  algorithm: EncryptionAlgorithm,
  required: boolean,
): Promise<string | undefined> {
  const password = await askPassword(prompt, value => checkPassword(value, algorithm, required));
  if (password === undefined) { return undefined; }
  if (password === '') { return ''; }
  const again = await askPassword('Type the password again to confirm it. Lpdf cannot recover a lost one.', value => checkConfirmation(value, password));
  return again === undefined ? undefined : password;
}

/**
 * Asks what to protect, in input boxes and a pick list: the owner password (required), the open
 * password (optional), and which permissions to allow (all ticked at first). Passwords are asked
 * for every time and are not kept, not in settings, not in secret storage and not in the trace.
 * @param algorithm The cipher, which sets how long a password can be.
 * @returns What the export should do, or undefined when the user cancelled at any step or chose not
 *          to continue with an export that protects nothing.
 */
export async function askForEncryption(algorithm: EncryptionAlgorithm): Promise<EncryptionRequest | undefined> {
  const ownerPassword = await askPasswordTwice(
    'Owner password (required). It opens the PDF with every permission and lifts the restrictions you set next.',
    algorithm,
    true,
  );
  if (ownerPassword === undefined) { return undefined; }

  const userPassword = await askPasswordTwice(
    'Open password. Readers ask for it before showing the PDF. Leave it empty so that anyone can open the PDF and only the permissions apply.',
    algorithm,
    false,
  );
  if (userPassword === undefined) { return undefined; }

  const picked = await vscode.window.showQuickPick(
    PERMISSIONS.map(p => ({ label: p.label, detail: p.detail, key: p.key, picked: true })),
    {
      title: TITLE,
      placeHolder: 'Untick what readers may not do',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  if (picked === undefined) { return undefined; }

  const request: EncryptionRequest = {
    userPassword,
    ownerPassword,
    permissions: permissionsFromAllowed(picked.map(item => item.key as PermissionKey)),
    algorithm,
  };

  if (protectsNothing(request)) {
    const choice = await vscode.window.showWarningMessage(
      'Lpdf: There is no open password and every permission is allowed, so anyone can open and use this PDF. Export it encrypted anyway?',
      { modal: true },
      CONTINUE,
    );
    if (choice !== CONTINUE) { return undefined; }
  }
  return request;
}
