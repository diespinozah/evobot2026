import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionsBitField,
  SlashCommandBuilder
} from "discord.js";
import { lavalink, lavalinkHandler } from "../index";
import { i18n } from "../utils/i18n";

export default {
  data: new SlashCommandBuilder()
    .setName("playlist")
    .setDescription(i18n.__("playlist.description"))
    .addStringOption((option) => option.setName("playlist").setDescription("Playlist name or link").setRequired(true)),
  cooldown: 5,
  permissions: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak],
  async execute(interaction: ChatInputCommandInteraction, queryOptionName = "playlist") {
    let argPlaylist = interaction.options.getString(queryOptionName);

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    let player = lavalink.getPlayer(interaction.guildId!);

    if (!voiceChannel) {
      return interaction.reply({ content: i18n.__("playlist.errorNotChannel"), ephemeral: true }).catch(console.error);
    }

    if (player && voiceChannel.id !== player.voiceChannelId) {
      if (interaction.replied) {
        return interaction
          .editReply({ content: i18n.__mf("play.errorNotInSameChannel", { user: interaction.client.user!.username }) })
          .catch(console.error);
      } else {
        return interaction
          .reply({
            content: i18n.__mf("play.errorNotInSameChannel", { user: interaction.client.user!.username }),
            ephemeral: true
          })
          .catch(console.error);
      }
    }

    try {
      // Create player if it doesn't exist
      if (!player) {
        player = await lavalinkHandler.createPlayer({
          guildId: interaction.guildId!,
          voiceChannelId: voiceChannel.id,
          textChannelId: interaction.channelId
        });
      }

      // Connect if not connected
      if (!player.connected) {
        await player.connect();
      }

      // Search for playlist
      const result = await player.search(argPlaylist!, interaction.user);

      if (!result.tracks.length) {
        if (interaction.replied) {
          return interaction.editReply({ content: i18n.__("playlist.errorNotFoundPlaylist") }).catch(console.error);
        } else {
          return interaction
            .reply({ content: i18n.__("playlist.errorNotFoundPlaylist"), ephemeral: true })
            .catch(console.error);
        }
      }

      // Add all tracks to queue
      await player.queue.add(result.tracks);

      // Start playing if not already
      if (!player.playing && !player.paused) {
        await player.play();
      }

      const playlistName = result.playlist?.name || "Playlist";
      const message =
        i18n.__mf("playlist.startedPlaylist", { author: interaction.user.id }) +
        `\n**${playlistName}** - ${result.tracks.length} songs`;

      if (interaction.replied) {
        await interaction.editReply({ content: message }).catch(console.error);
      } else {
        await interaction.reply({ content: message }).catch(console.error);
      }
    } catch (error) {
      console.error(error);

      if (interaction.replied) {
        return interaction.editReply({ content: i18n.__("playlist.errorNotFoundPlaylist") }).catch(console.error);
      } else {
        return interaction
          .reply({ content: i18n.__("playlist.errorNotFoundPlaylist"), ephemeral: true })
          .catch(console.error);
      }
    }
  }
};
