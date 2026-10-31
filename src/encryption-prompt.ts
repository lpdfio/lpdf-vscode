import * as vscode from 'vscode';
import { checkConfirmation, checkPassword, cipherName, type InputProblem, type Passwords } from './encryption';

const TITLE = 'Lpdf: Export PDF';

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
async function askPasswordTwice(prompt: string, cipher: string, required: boolean): Promise<string | undefined> {
  const password = await askPassword(prompt, value => checkPassword(value, cipher, required));
  if (password === undefined) { return undefined; }
  if (password === '') { return ''; }
  const again = await askPassword('Type the password again to confirm it. Lpdf cannot recover a lost one.', value => checkConfirmation(value, password));
  return again === undefined ? undefined : password;
}

/**
 * Asks for the passwords of a document that asks for encryption in its `<output>`, in input boxes: the owner
 * password (required) and the open password (optional), each typed twice and checked against the cipher the
 * document names. The permissions are the document's. Passwords are asked for every time and are not kept, not in
 * settings, not in secret storage and not in the trace.
 * @param cipher The cipher of the document's `encrypt`.
 * @returns The passwords, or undefined when the user cancelled at any step.
 */
export async function askForPasswords(cipher: string): Promise<Passwords | undefined> {
  const ownerPassword = await askPasswordTwice(
    `The document asks for ${cipherName(cipher)} encryption in its <output>. Owner password (required): it opens the PDF with every permission.`,
    cipher,
    true,
  );
  if (ownerPassword === undefined) { return undefined; }

  const userPassword = await askPasswordTwice(
    'Open password. Readers ask for it before showing the PDF. Leave it empty so that anyone can open the PDF and only the permissions of the document\'s <output> apply.',
    cipher,
    false,
  );
  if (userPassword === undefined) { return undefined; }

  return { userPassword, ownerPassword };
}
