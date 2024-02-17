import {
  SlashCommandSubcommandBuilder,
  ChatInputCommandInteraction,
  Role,
} from "discord.js";

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

    await interaction.deferReply({ ephemeral: true });
    const role = interaction.options.getRole("role") as Role;
    const isRemove = interaction.options.getBoolean("is-remove");
    const ids = interaction.options
      .getString("ids")
      .replaceAll(">", "")
      .replaceAll("<", "")
      .replaceAll("@", "")
      .split(/[\s,]+/);
    const unique_ids = [...new Set(ids)];

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
