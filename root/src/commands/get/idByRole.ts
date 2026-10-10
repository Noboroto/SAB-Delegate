import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { replyInChunks } from "../_shared/chunkedReply";

const commandName = "id-by-role";

/** Ids of everyone who can see `channel`; thread members are not cached, so they are fetched. */
const getChannelMemberIds = async (
  channel: ChatInputCommandInteraction["channel"]
): Promise<Set<string>> => {
  if (channel.isThread()) {
    return new Set((await channel.members.fetch()).keys());
  }
  if ("members" in channel) {
    return new Set(channel.members.keys());
  }
  return new Set();
};

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Get all members who have a specific role")
      .addRoleOption((Option) =>
        Option.setName("role")
          .setDescription("Role you want to get the list of members")
          .setRequired(true)
      )
      .addBooleanOption((Option) =>
        Option.setName("in-this-channel")
          .setDescription("default is false")
          .setRequired(false)
      );
  },

  async execute(interaction: ChatInputCommandInteraction) {
    // restrict to only users with the ManageRoles permission
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({
        content: "You don't have permission to use this command",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const role = interaction.options.getRole("role") as Role;
    const inThisChannel = interaction.options.getBoolean("in-this-channel");
    // role.members only reflects the cache; the full list needs a fetch.
    await interaction.guild.members.fetch();
    let members = role.members;
    if (inThisChannel) {
      const channelMemberIds = await getChannelMemberIds(interaction.channel);
      members = members.filter((member) => channelMemberIds.has(member.id));
    }

    const header = `There are ${members.size} user(s) in ${role.name}: \n`;
    const lines = members.map((member) => member.user.id + ",\n").join("");

    await replyInChunks(interaction, header + lines);
  },
};
