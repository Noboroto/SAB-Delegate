import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
  MessageFlags,
} from "discord.js";
import { replyInChunks } from "../_shared/chunkedReply";
import { applyRoleToMembers, describeFailures } from "../_shared/applyRole";

const commandName = "list";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription("Assign or remove a role for many members by list of ID")
      .addStringOption((Option) =>
        Option.setName("ids")
          .setDescription("seperate by comma, can be present as mention")
          .setRequired(true)
      )
      .addRoleOption((Option) =>
        Option.setName("role")
          .setDescription("Role you want to assign")
          .setRequired(true)
      )

      .addBooleanOption((Option) =>
        Option.setName("is-remove")
          .setDescription("default is false")
          .setRequired(false)
      );
  },
  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    //const guild = interaction.client.guilds.cache.get('Guild ID');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const role = interaction.options.getRole("role") as Role;
    const isRemove = interaction.options.getBoolean("is-remove") ?? false;
    const ids = interaction.options
      .getString("ids")
      .replaceAll(">", "")
      .replaceAll("<", "")
      .replaceAll("@", "")
      .split(/[\s,]+/);
    const unique_ids = [...new Set(ids)];

    const { done, failures } = await applyRoleToMembers(
      interaction,
      unique_ids,
      role,
      isRemove
    );

    await replyInChunks(
      interaction,
      `Done modifying ${done} member(s)!${describeFailures(failures)}`,
      { ephemeral: true }
    );
  },
};
