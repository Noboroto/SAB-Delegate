import {
	SlashCommandBuilder,
	PermissionFlagsBits,
	ChatInputCommandInteraction,
    ChannelType,
    PermissionsBitField
} from "discord.js";

const denyEveryone = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.Speak];

const voicePermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
    PermissionFlagsBits.Stream,
    PermissionFlagsBits.PrioritySpeaker,
]

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
]

const threadOnlyPermissions = new PermissionsBitField(textPermissions);
threadOnlyPermissions.remove(PermissionFlagsBits.SendMessages);

const muteTextPermissions = new PermissionsBitField(textPermissions);
muteTextPermissions.remove(PermissionFlagsBits.SendMessages);
muteTextPermissions.remove(PermissionFlagsBits.SendMessagesInThreads);

const muteVoicePermissions = new PermissionsBitField(voicePermissions);
muteVoicePermissions.remove(PermissionFlagsBits.Speak);

const willBeMutePermit = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendTTSMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.Speak
]

export default {
	data: new SlashCommandBuilder()
		.setName("create-activity")
		.setDescription("create activity neccessary")

		.addStringOption((Option) =>
			Option.setName("1-emoji").setDescription("emoji").setRequired(true)
		)

		.addStringOption((Option) =>
			Option.setName("2-name")
				.setDescription("Activity name")
				.setRequired(true)
		)

		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
		.setDMPermission(false),

	async execute(interaction: ChatInputCommandInteraction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		const emoji = interaction.options.getString("1-emoji")?.trim() ?? "";
		const name = interaction.options.getString("2-name")?.trim() ?? "";

        const createdRole = await interaction.guild?.roles.create({
            name: name,
        })

        const channelName = (emoji + "┃" + name).toLowerCase().replace(" ", "-")
        const createdGeneralChannel = await interaction.guild?.channels.create({
            name: channelName + "-general",
            parent: "1046973611199697022",
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: interaction.guild?.roles.everyone.id ?? "",
                    deny: denyEveryone,
                },
                {
                    id: createdRole?.id ?? "",
                    allow: textPermissions,
                },
                {
                    id: interaction.guild?.roles.cache.find(role => role.name === "Muted").id ?? "",
                    allow: muteTextPermissions,
                    deny: willBeMutePermit
                }
            ],
        })

        const createdThreadOnlyChannel = await interaction.guild?.channels.create({
            name: channelName + "-thread-only",
            parent: "1046973611199697022",
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: interaction.guild?.roles.everyone.id ?? "",
                    deny: denyEveryone,
                },
                {
                    id: createdRole?.id ?? "",
                    allow: threadOnlyPermissions,
                },
                {
                    id: interaction.guild?.roles.cache.find(role => role.name === "Muted").id ?? "",
                    allow: muteTextPermissions,
                    deny: willBeMutePermit
                }
            ],
        })

        const createdVoiceChannel = await interaction.guild?.channels.create({
            name: emoji + "┃" + name + " voice",
            parent: "1046973611199697022",
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                {
                    id: interaction.guild?.roles.everyone.id ?? "",
                    deny: denyEveryone,
                },
                {
                    id: createdRole?.id ?? "",
                    allow: voicePermissions,
                },
                {
                    id: interaction.guild?.roles.cache.find(role => role.name === "Muted").id ?? "",
                    allow: muteVoicePermissions,
                    deny: willBeMutePermit
                }
            ],
        })

        const replyMsg =  `Created activity name ${name}:\n- role ${createdRole} \n- ${createdGeneralChannel}\n- ${createdThreadOnlyChannel}\n- ${createdVoiceChannel}`;

        interaction.reply(replyMsg)
	},
};
