import { beforeEach, describe, expect, it, vi } from 'vitest';

type InputOptions = { title: string; prompt: string; password: boolean; ignoreFocusOut: boolean; validateInput: (value: string) => { message: string; severity: number } | undefined };
type PickItem = { label: string; key: string; picked: boolean };

const state = {
  /** What the user types into each box in turn; undefined cancels the box. */
  inputs: [] as (string | undefined)[],
  /** The boxes as they were shown. */
  boxes: [] as InputOptions[],
  /** The keys left ticked in the pick list, or undefined to cancel it. */
  ticked: undefined as undefined | string[],
  pickList: undefined as undefined | { items: PickItem[]; options: Record<string, unknown> },
  warning: vi.fn(),
};

vi.mock('vscode', () => ({
  InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
  window: {
    showInputBox: async (options: InputOptions) => {
      state.boxes.push(options);
      return state.inputs.shift();
    },
    showQuickPick: async (items: PickItem[], options: Record<string, unknown>) => {
      state.pickList = { items, options };
      return state.ticked === undefined ? undefined : items.filter(item => state.ticked!.includes(item.key));
    },
    showWarningMessage: (...args: unknown[]) => state.warning(...args),
  },
}));

import { askForEncryption } from './encryption-prompt';
import { PERMISSIONS } from './encryption';

const ALL = PERMISSIONS.map(p => p.key as string);

beforeEach(() => {
  state.inputs = [];
  state.boxes = [];
  state.ticked = ALL;
  state.pickList = undefined;
  state.warning.mockReset();
});

describe('askForEncryption', () => {
  it('asks for each password twice, then the permissions, and returns what was chosen', async () => {
    state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
    state.ticked = ALL.filter(key => key !== 'copy');

    const request = await askForEncryption('aes-256');

    expect(request).toMatchObject({ ownerPassword: 'owner-pw', userPassword: 'open-pw', algorithm: 'aes-256' });
    expect(request?.permissions.copy).toBe(false);
    expect(request?.permissions.print).toBe(true);
    expect(state.boxes).toHaveLength(4);
    expect(state.warning).not.toHaveBeenCalled();
  });

  it('hides every password and keeps the boxes up when focus moves away', async () => {
    state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
    await askForEncryption('aes-256');
    expect(state.boxes.every(box => box.password && box.ignoreFocusOut)).toBe(true);
  });

  it('skips the confirmation of an empty open password and makes it no open password', async () => {
    state.inputs = ['owner-pw', 'owner-pw', ''];
    state.ticked = ALL.filter(key => key !== 'print');

    const request = await askForEncryption('aes-256');

    expect(request?.userPassword).toBe('');
    expect(state.boxes).toHaveLength(3);
  });

  it('shows all permissions ticked at first', async () => {
    state.inputs = ['owner-pw', 'owner-pw', ''];
    state.ticked = ALL.filter(key => key !== 'print');
    await askForEncryption('aes-256');

    expect(state.pickList?.items.map(item => item.key)).toEqual(ALL);
    expect(state.pickList?.items.every(item => item.picked)).toBe(true);
    expect(state.pickList?.options.canPickMany).toBe(true);
  });

  describe('cancelling', () => {
    it('at the owner password returns nothing and asks no more', async () => {
      state.inputs = [undefined];
      expect(await askForEncryption('aes-256')).toBeUndefined();
      expect(state.boxes).toHaveLength(1);
      expect(state.pickList).toBeUndefined();
    });

    it('at its confirmation returns nothing', async () => {
      state.inputs = ['owner-pw', undefined];
      expect(await askForEncryption('aes-256')).toBeUndefined();
      expect(state.pickList).toBeUndefined();
    });

    it('at the open password returns nothing', async () => {
      state.inputs = ['owner-pw', 'owner-pw', undefined];
      expect(await askForEncryption('aes-256')).toBeUndefined();
      expect(state.pickList).toBeUndefined();
    });

    it('at the open password\'s confirmation returns nothing', async () => {
      state.inputs = ['owner-pw', 'owner-pw', 'open-pw', undefined];
      expect(await askForEncryption('aes-256')).toBeUndefined();
      expect(state.pickList).toBeUndefined();
    });

    it('at the permissions returns nothing', async () => {
      state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
      state.ticked = undefined;
      expect(await askForEncryption('aes-256')).toBeUndefined();
    });
  });

  describe('validation in the boxes', () => {
    it('refuses an empty owner password and accepts a typed one', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForEncryption('aes-256');
      const ownerBox = state.boxes[0];
      expect(ownerBox.validateInput('')).toMatchObject({ severity: 3 });
      expect(ownerBox.validateInput('x')).toBeUndefined();
    });

    it('refuses a confirmation that differs from the password typed first', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForEncryption('aes-256');
      const confirmBox = state.boxes[1];
      expect(confirmBox.validateInput('owner-px')).toMatchObject({ severity: 3 });
      expect(confirmBox.validateInput('owner-pw')).toBeUndefined();
    });

    it('allows an empty open password but not a long one', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForEncryption('rc4-128');
      const openBox = state.boxes[2];
      expect(openBox.validateInput('')).toBeUndefined();
      expect(openBox.validateInput('a'.repeat(33))).toMatchObject({ severity: 3 });
    });

    it('warns, without refusing, about a password outside ASCII', async () => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      await askForEncryption('aes-256');
      expect(state.boxes[0].validateInput('pässword')).toMatchObject({ severity: 2 });
    });
  });

  describe('an export that protects nothing', () => {
    beforeEach(() => {
      state.inputs = ['owner-pw', 'owner-pw', ''];
      state.ticked = ALL;
    });

    it('asks before it goes on, and goes on when the user continues', async () => {
      state.warning.mockResolvedValue('Continue');
      const request = await askForEncryption('aes-256');
      expect(state.warning).toHaveBeenCalledOnce();
      expect(request?.ownerPassword).toBe('owner-pw');
    });

    it('returns nothing when the user does not continue', async () => {
      state.warning.mockResolvedValue(undefined);
      expect(await askForEncryption('aes-256')).toBeUndefined();
    });

    it('does not ask when an open password is set', async () => {
      state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
      await askForEncryption('aes-256');
      expect(state.warning).not.toHaveBeenCalled();
    });
  });

  it('passes the algorithm on to the request', async () => {
    state.inputs = ['owner-pw', 'owner-pw', 'open-pw', 'open-pw'];
    expect((await askForEncryption('rc4-128'))?.algorithm).toBe('rc4-128');
  });
});
