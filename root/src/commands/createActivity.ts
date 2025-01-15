import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionsBitField,
} from "discord.js";

const rejectEveryone = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.Speak,
];

const voicePermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.PrioritySpeaker,
];

const textPermissions = [
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

const threadOnlyPermissions = new PermissionsBitField(textPermissions);
threadOnlyPermissions.remove(PermissionFlagsBits.SendMessages);

const muteTextPermissions = new PermissionsBitField(textPermissions);
//muteTextPermissions.remove(PermissionFlagsBits.ViewChannel);
muteTextPermissions.remove(PermissionFlagsBits.SendMessages);
muteTextPermissions.remove(PermissionFlagsBits.SendMessagesInThreads);

const muteVoicePermissions = new PermissionsBitField(voicePermissions);
//muteVoicePermissions.remove(PermissionFlagsBits.ViewChannel);
muteVoicePermissions.remove(PermissionFlagsBits.Speak);

const willBeMutePermit = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendTTSMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.Speak,
];

export default {
  data: new SlashCommandBuilder()
    .setName("create-activity")
    .setDescription("create activity neccessary")

    .addStringOption((Option) =>
      Option.setName("1-emoji").setDescription("emoji").setRequired(true)
    )

    .addStringOption((Option) =>
      Option.setName("2-name").setDescription("Activity name").setRequired(true)
    )
    .addStringOption((Option) =>
      Option.setName("3-short-name")
        .setDescription("Activity short name with 3 characters")
        .setRequired(true)
        .setMaxLength(3)
        .setMinLength(3)
    )

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction) {
    // interaction.user is the object representing the User who ran the command
    // interaction.member is the GuildMember object, which represents the user in the specific guild
    const emoji = interaction.options.getString("1-emoji")?.trim() ?? "";
    const name = interaction.options.getString("2-name")?.trim() ?? "";
    const shortName =
      interaction.options.getString("3-short-name")?.trim() ?? "";

    await interaction.deferReply();

    const technicianRole =
      interaction.guild?.roles.cache.find((role) =>
        role.name.toLocaleLowerCase().startsWith("technician")
      ) ??
      (await interaction.guild.roles
        .fetch()
        .then((roles) =>
          roles.find((role) =>
            role.name.toLocaleLowerCase().startsWith("technician")
          )
        )) ??
      undefined;

    const mutedRole =
      interaction.guild?.roles.cache.find((role) => role.name === "Muted") ??
      (await interaction.guild.roles
        .fetch()
        .then((roles) => roles.find((role) => role.name === "Muted"))) ??
      undefined;

    const createdRole = await interaction.guild?.roles.create({
      name: name + "-Event",
    });

    const createMultiRole = await interaction.guild?.roles.create({
      name: name + "-Multi",
    });

    const createMCRole = await interaction.guild?.roles.create({
      name: name + "-MC",
    });

    const channelName = (emoji + "┃" + name).toLowerCase().replace(" ", "-");

    let perrmissionArr: {
      id: string;
      allow?: PermissionsBitField | bigint | bigint[] | undefined;
      deny?: PermissionsBitField | bigint | bigint[] | undefined;
    }[] = [
      {
        id: technicianRole?.id ?? "",
        allow: PermissionsBitField.All,
      },
      {
        id: interaction.guild?.roles.everyone?.id ?? "",
        deny: rejectEveryone,
      },
      {
        id: createdRole?.id ?? "",
        allow: textPermissions,
      },
      {
        id: createMultiRole?.id ?? "",
        allow: textPermissions,
      },
      {
        id: createMCRole?.id ?? "",
        allow: textPermissions,
      },
      {
        id: mutedRole?.id ?? "",
        allow: muteTextPermissions,
        deny: willBeMutePermit,
      },
    ];

    let validPermission = perrmissionArr.filter(
      (permission) => permission.id !== ""
    );

    const createdGeneralChannel = await interaction.guild?.channels.create({
      name: channelName + "-general",
      parent: "1046973611199697022",
      topic:
        "General channel for " +
        `"${name}"` +
        " with short name " +
        `"${shortName}"`,
      type: ChannelType.GuildText,
      permissionOverwrites: validPermission,
    });

    perrmissionArr = [
      {
        id: technicianRole?.id ?? "",
        allow: PermissionsBitField.All,
      },
      {
        id: interaction.guild?.roles.everyone.id ?? "",
        deny: rejectEveryone,
      },
      {
        id: createdRole?.id ?? "",
        allow: threadOnlyPermissions,
      },
      {
        id: createMultiRole?.id ?? "",
        allow: threadOnlyPermissions,
      },
      {
        id: createMCRole?.id ?? "",
        allow: threadOnlyPermissions,
      },
      {
        id: mutedRole?.id ?? "",
        allow: muteTextPermissions,
        deny: willBeMutePermit,
      },
    ];

    validPermission = perrmissionArr.filter(
      (permission) => permission.id !== ""
    );

    const createdThreadOnlyChannel = await interaction.guild?.channels.create({
      name: channelName + "-thread-only",
      topic:
        "Thread only channel for " +
        `"${name}"` +
        " with short name " +
        `"${shortName}"`,
      parent: "1046973611199697022",
      type: ChannelType.GuildText,
      permissionOverwrites: validPermission,
    });

    perrmissionArr = [
      {
        id: technicianRole?.id ?? "",
        allow: PermissionsBitField.All,
      },
      {
        id: interaction.guild?.roles.everyone.id ?? "",
        deny: rejectEveryone,
      },
      {
        id: createdRole?.id ?? "",
        allow: voicePermissions,
      },
      {
        id: createMultiRole?.id ?? "",
        allow: voicePermissions,
      },
      {
        id: createMCRole?.id ?? "",
        allow: voicePermissions,
      },
      {
        id: mutedRole?.id ?? "",
        allow: muteVoicePermissions,
        deny: willBeMutePermit,
      },
    ];

    validPermission = perrmissionArr.filter(
      (permission) => permission.id !== ""
    );

    const createdVoiceChannel = await interaction.guild?.channels.create({
      name: emoji + "┃" + name + " voice",
      parent: "1046973611199697022",
      type: ChannelType.GuildVoice,
      userLimit: 99,
      permissionOverwrites: validPermission,
    });

    await interaction.editReply(
      `Created activity name "${name}":\n- role ${createdRole}, ${createMultiRole} and ${createMCRole}\n- ${createdGeneralChannel}\n- ${createdThreadOnlyChannel}\n- ${createdVoiceChannel}`
    );
  },
};
