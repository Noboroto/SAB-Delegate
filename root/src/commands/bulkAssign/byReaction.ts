import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
} from "discord.js";
import { getMessageFromOption } from "../../ultils";

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

    await interaction.deferReply({ ephemeral: true });
    const role = interaction.options.getRole("role") as Role;
    const isRemove = interaction.options.getBoolean("is-remove");

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

    const unique_ids: string[] = [];
    const reactionList = await messageFromID.reactions.cache;

    for (const reactionFromMessage of reactionList.values()) {
      if (reactionFromMessage.emoji.toString() !== reaction) continue;
      await reactionFromMessage.users.fetch().then((users) => {
        users.forEach((user) => {
          if (user.bot) return;
          unique_ids.push(user.id);
        });
      });
    }

    const guild = await interaction.guild.fetch();
    const members = await guild.members.cache;

    let counter = 0;

    await unique_ids.forEach(async (id) => {
      const member = await members.get(id);
      if (!member) return;
      counter++;
      if (!isRemove) await member.roles.add(role);
      else await member.roles.remove(role);
    });

    const message = {
      content: `Done ${counter} member(s)!`,
    };

    await interaction.editReply(message);
  },
};
