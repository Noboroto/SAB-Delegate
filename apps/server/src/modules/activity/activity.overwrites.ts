import {
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type OverwriteResolvable,
} from 'discord.js';

const REJECT_EVERYONE = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.Speak,
];

const VOICE = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.PrioritySpeaker,
];

const TEXT = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendTTSMessages,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseApplicationCommands,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.SendMessagesInThreads,
];

/** Members of the activity may open threads but not write in the channel itself. */
const THREAD_ONLY = new PermissionsBitField(TEXT).remove(PermissionFlagsBits.SendMessages);

/** What a muted member keeps in a text channel: reading and reacting, no writing. */
const MUTED_TEXT = new PermissionsBitField(TEXT).remove(
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
);

const MUTED_VOICE = new PermissionsBitField(VOICE).remove(PermissionFlagsBits.Speak);

/** The permissions a muted member is denied again, whatever other roles allow. */
const MUTED_DENY = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendTTSMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.Speak,
];

type Roles = {
  everyoneId: string;
  /** Absent when the server has no role whose name starts with "technician". */
  technicianId?: string | undefined;
  /** Absent when the server has no role named "Muted". */
  mutedId?: string | undefined;
  /** The activity's own roles: event, multi and MC. */
  activityRoleIds: readonly string[];
};

type ActivityOverwrites = {
  text: OverwriteResolvable[];
  threadOnly: OverwriteResolvable[];
  voice: OverwriteResolvable[];
};

/**
 * Permission overwrites of the three channels. Roles the server does not have
 * (technician, Muted) are left out rather than failing the whole command.
 */
export function buildActivityOverwrites(roles: Roles): ActivityOverwrites {
  const build = (
    allow: PermissionsBitField | bigint[],
    mutedAllow: PermissionsBitField,
  ): OverwriteResolvable[] => {
    const overwrites: OverwriteResolvable[] = [];
    if (roles.technicianId !== undefined) {
      overwrites.push({
        id: roles.technicianId,
        type: OverwriteType.Role,
        allow: PermissionsBitField.All,
      });
    }
    overwrites.push({ id: roles.everyoneId, type: OverwriteType.Role, deny: REJECT_EVERYONE });
    for (const id of roles.activityRoleIds) {
      overwrites.push({ id, type: OverwriteType.Role, allow });
    }
    if (roles.mutedId !== undefined) {
      overwrites.push({
        id: roles.mutedId,
        type: OverwriteType.Role,
        allow: mutedAllow,
        deny: MUTED_DENY,
      });
    }
    return overwrites;
  };

  return {
    text: build(TEXT, MUTED_TEXT),
    threadOnly: build(THREAD_ONLY, MUTED_TEXT),
    voice: build(VOICE, MUTED_VOICE),
  };
}
