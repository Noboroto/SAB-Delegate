import { describe, expect, it } from 'vitest';
import type { EmailVerifyConfig } from '@sab/shared';
import { settingsFromConfig, settingsPatch } from './settings-patch';

const ROLE = '5'.repeat(18);
const OTHER = '6'.repeat(18);

const CONFIG: EmailVerifyConfig = {
  enabled: true,
  defaultRoleIds: [ROLE, OTHER],
  unverifiedRoleId: null,
  logChannelId: null,
  verifyMessage: 'Hello',
  autoVerifyOnJoin: false,
  autoUnverifiedOnJoin: false,
};

describe('settingsPatch', () => {
  it('is empty when nothing changed', () => {
    expect(settingsPatch(settingsFromConfig(CONFIG), CONFIG)).toEqual({});
  });

  it('ignores the order of the roles and spaces around the message', () => {
    const values = {
      ...settingsFromConfig(CONFIG),
      defaultRoleIds: [OTHER, ROLE],
      verifyMessage: '  Hello ',
    };
    expect(settingsPatch(values, CONFIG)).toEqual({});
  });

  it('holds only the changed fields, with cleared pickers as null', () => {
    const values = {
      ...settingsFromConfig({ ...CONFIG, unverifiedRoleId: ROLE }),
      unverifiedRoleId: undefined,
      verifyMessage: '',
      enabled: false,
    };
    expect(settingsPatch(values, { ...CONFIG, unverifiedRoleId: ROLE })).toEqual({
      enabled: false,
      unverifiedRoleId: null,
      verifyMessage: null,
    });
  });
});
