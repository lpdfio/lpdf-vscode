import { beforeEach, describe, expect, it, vi } from 'vitest';

type InputOptions = { title: string; prompt: string; password: boolean; ignoreFocusOut: boolean; validateInput: (value: string) => { message: string; severity: number } | undefined };

const state = {
  /** What the user types into each box in turn; undefined cancels the box. */
  inputs: [] as (string | undefined)[],
  /** The boxes as they were shown. */
  boxes: [] as InputOptions[],
  pick: vi.fn(),
};

vi.mock('vscode', () => ({
  InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
  window: {
    showInputBox: async (options: InputOptions) => {
      state.boxes.push(options);
      return state.inputs.shift();
    },
    showQuickPick: (...args: unknown[]) => state.pick(...args),
  },
}));

import { askForPasswords } from './encryption-prompt';

beforeEach(() => {
  state.inputs = [];
  state.boxes = [];
  state.pick.mockReset();
});

describe('askForPasswords', () => {
  it('asks for each password twice and returns them', async () => {
    state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];

    expect(await askForPasswords('aes-256')).toEqual({ ownerPassword: 'owner-pw', userPassword: 'open-pw' });
    expect(state.boxes).toHaveLength(4);
  });

  it('asks for no permissions: they are the document\'s', async () => {
    state.inputs = ['owner-pw', 'owner-pw', ''];
    await askForPasswords('aes-256');
    expect(state.pick).not.toHaveBeenCalled();
  });

  it('names the cipher the document asks for', async () => {
    state.inputs = ['owner-pw', 'owner-pw', ''];
    await askForPasswords('rc4-128');
    expect(state.boxes[0].prompt).toContain('RC4-128');
  });

  it('hides every password and keeps the boxes up when focus moves away', async () => {
    state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
    await askForPasswords('aes-256');
    expect(state.boxes.every(box => box.password && box.ignoreFocusOut)).toBe(true);
  });

  it('skips the confirmation of an empty open password and makes it no open password', async () => {
    state.inputs = ['owner-pw', 'owner-pw', ''];

    expect((await askForPasswords('aes-256'))?.userPassword).toBe('');
    expect(state.boxes).toHaveLength(3);
  });

  describe('cancelling', () => {
    it.each([
      ['the owner password', [undefined]],
      ['its confirmation', ['owner-pw', undefined]],
      ['the open password', ['owner-pw', 'owner-pw', undefined]],
      ['the open password\'s confirmation', ['owner-pw', 'owner-pw', 'open-pw', undefined]],
    ])('at %s returns nothing and asks no more', async (_at, inputs) => {
      state.inputs = [...inputs];
      expect(await askForPasswords('aes-256')).toBeUndefined();
      expect(state.boxes).toHaveLength(inputs.length);
    });
  });

  describe('validation in the boxes', () => {
    it('refuses an empty owner password and accepts a typed one', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForPasswords('aes-256');
      const ownerBox = state.boxes[0];
      expect(ownerBox.validateInput('')).toMatchObject({ severity: 3 });
      expect(ownerBox.validateInput('x')).toBeUndefined();
    });

    it('refuses a confirmation that differs from the password typed first', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForPasswords('aes-256');
      const confirmBox = state.boxes[1];
      expect(confirmBox.validateInput('owner-px')).toMatchObject({ severity: 3 });
      expect(confirmBox.validateInput('owner-pw')).toBeUndefined();
    });

    it('checks the length against the document\'s cipher: an open password may be empty, not long', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForPasswords('rc4-128');
      const openBox = state.boxes[2];
      expect(openBox.validateInput('')).toBeUndefined();
      expect(openBox.validateInput('a'.repeat(33))).toMatchObject({ severity: 3 });
    });

    it('warns, without refusing, about a password outside ASCII', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForPasswords('aes-256');
      expect(state.boxes[0].validateInput('pässword')).toMatchObject({ severity: 2 });
    });
  });
});
