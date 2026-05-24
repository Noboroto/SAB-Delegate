import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
  TextChannel,
  PermissionsBitField,
  MessageFlags,
} from "discord.js";

const commandName = "id-by-role";

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
    if (
      !(interaction.member.permissions as PermissionsBitField).has(
        PermissionsBitField.Flags.ManageRoles
      )
    ) {
      interaction.reply({
        content: "You don't have permission to use this command",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = interaction.options.getRole("role") as Role;
    const inThisChannel = interaction.options.getBoolean("in-this-channel");
    let members = role.members;
    if (inThisChannel) {
      const channel = interaction.channel as TextChannel;
      const channelMembers = channel.members.map((member) => member.id);
      members = members.filter((member) => {
        return channelMembers.find((id) => id == member.id) !== undefined;
      });
    }

    const memberLines = members.map((member) => member.user.id);
    const header = `There are ${members.size} user(s) in ${role.name}: \n`;

    const chunks: string[] = [];
    let current = header;
    for (let i = 0; i < memberLines.length; i++) {
      const line = memberLines[i] + ",\n";
      if ((current + line).length > 2000) {
        chunks.push(current);
        current = line;
      } else {
        current += line;
      }
    }
    chunks.push(current);

    await interaction.reply(chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  },
};
