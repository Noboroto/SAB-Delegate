import { OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { buildActivityOverwrites } from './activity.overwrites.js';

const EVERYONE = '100000000000000001';
const TECHNICIAN = '100000000000000002';
const MUTED = '100000000000000003';
const ROLES = ['200000000000000001', '200000000000000002', '200000000000000003'];

type Overwrite = {
  id: string;
  type: OverwriteType;
  allow?: PermissionsBitField | bigint[];
  deny?: bigint[];
};

const asList = (overwrites: unknown): Overwrite[] => overwrites as Overwrite[];
const idsOf = (overwrites: unknown): string[] => asList(overwrites).map((entry) => entry.id);

describe('buildActivityOverwrites', () => {
  it('hides every channel from everyone and opens it to the three activity roles', () => {
    const { text } = buildActivityOverwrites({ everyoneId: EVERYONE, activityRoleIds: ROLES });
    expect(idsOf(text)).toEqual([EVERYONE, ...ROLES]);
    const everyone = asList(text)[0];
    expect(everyone?.deny).toContain(PermissionFlagsBits.ViewChannel);
    expect(asList(text).every((entry) => entry.type === OverwriteType.Role)).toBe(true);
  });

  it('gives the technician role everything, ahead of the others', () => {
    const { voice } = buildActivityOverwrites({
      everyoneId: EVERYONE,
      technicianId: TECHNICIAN,
      activityRoleIds: ROLES,
    });
    expect(idsOf(voice)[0]).toBe(TECHNICIAN);
    expect(asList(voice)[0]?.allow).toBe(PermissionsBitField.All);
  });

  it('keeps the muted role from writing or speaking whatever other roles allow', () => {
    const { text, voice } = buildActivityOverwrites({
      everyoneId: EVERYONE,
      mutedId: MUTED,
      activityRoleIds: ROLES,
    });
    for (const overwrites of [text, voice]) {
      const muted = asList(overwrites).find((entry) => entry.id === MUTED);
      expect(muted?.deny).toEqual(
        expect.arrayContaining([PermissionFlagsBits.SendMessages, PermissionFlagsBits.Speak]),
      );
    }
    const mutedVoice = asList(voice).find((entry) => entry.id === MUTED);
    expect((mutedVoice?.allow as PermissionsBitField).has(PermissionFlagsBits.Speak)).toBe(false);
  });

  it('leaves out the roles the server does not have', () => {
    const { text } = buildActivityOverwrites({ everyoneId: EVERYONE, activityRoleIds: ROLES });
    expect(idsOf(text)).not.toContain(TECHNICIAN);
    expect(idsOf(text)).not.toContain(MUTED);
  });

  it('lets the thread-only channel hold threads but not messages', () => {
    const { threadOnly, text } = buildActivityOverwrites({
      everyoneId: EVERYONE,
      activityRoleIds: ROLES,
    });
    const member = (overwrites: unknown) => new PermissionsBitField(asList(overwrites)[1]?.allow);
    expect(member(text).has(PermissionFlagsBits.SendMessages)).toBe(true);
    expect(member(threadOnly).has(PermissionFlagsBits.SendMessages)).toBe(false);
    expect(member(threadOnly).has(PermissionFlagsBits.CreatePublicThreads)).toBe(true);
  });
});
