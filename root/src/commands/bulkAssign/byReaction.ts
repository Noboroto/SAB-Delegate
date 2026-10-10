import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
  MessageFlags,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";
import { replyInChunks } from "../_shared/chunkedReply";
import { fetchReactorIds } from "../_shared/fetchAllReactors";
import { applyRoleToMembers, describeFailures } from "../_shared/applyRole";

const commandName = "by-reaction";

export default {
  name: commandName,
  addCommand(builder: SlashCommandSubcommandBuilder) {
    return builder
      .setName(commandName)
      .setDescription(
        "Assign or remove a role for many members by a reaction on a message"
      )
      .addStringOption((Option) =>
        Option.setName("message-link")
          .setDescription("message link")
          .setRequired(true)
      )
      .addStringOption((Option) =>
        Option.setName("emoji").setDescription("emoji").setRequired(true)
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

    const reaction = interaction.options.getString("emoji")?.trim() ?? "";
    const messageFromID = await getMessageFromOption(
      interaction,
      "message-link"
    );

    if (!messageFromID) {
      await interaction.editReply({
        content: "Please provide a valid message link",
      });
      return;
    }

    const unique_ids = await fetchReactorIds(messageFromID, reaction);
    const { done, failures } = await applyRoleToMembers(
      interaction,
      unique_ids,
      role,
      isRemove
    );

    await replyInChunks(
      interaction,
      `Done ${done} member(s)!${describeFailures(failures)}`,
      { ephemeral: true }
    );
  },
};
