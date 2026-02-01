import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionsBitField,
  SlashCommandBuilder,
  TextChannel
} from "discord.js";
import { lavalink, lavalinkHandler } from "../index";
import { i18n } from "../utils/i18n";
import { playlistPattern } from "../utils/patterns";
import { bot } from "../index";

// Helper function to safely reply to interaction
async function safeEditReply(interaction: ChatInputCommandInteraction, content: string) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content });
    }
  } catch (error) {
    // If all else fails, try followUp or send to channel
    try {
      await interaction.followUp({ content, ephemeral: true });
    } catch {
      (interaction.channel as TextChannel)?.send(content).catch(() => {});
    }
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription(i18n.__("play.description"))
    .addStringOption((option) => option.setName("song").setDescription("The song you want to play").setRequired(true)),
  cooldown: 3,
  permissions: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak],
  async execute(interaction: ChatInputCommandInteraction, input?: string) {
    let argSongName = interaction.options.getString("song");
    if (!argSongName) argSongName = input || "";

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return safeEditReply(interaction, i18n.__("play.errorNotChannel"));
    }

    let player = lavalink.getPlayer(interaction.guildId!);

    if (player && voiceChannel.id !== player.voiceChannelId) {
      return safeEditReply(
        interaction,
        i18n.__mf("play.errorNotInSameChannel", { user: interaction.client.user!.username })
      );
    }

    if (!argSongName) {
      return safeEditReply(interaction, i18n.__mf("play.usageReply", { prefix: bot.prefix }));
    }

    let query = argSongName;

    // Handle playlist URLs - show loading message
    if (playlistPattern.test(query)) {
      await safeEditReply(interaction, "🔗 Loading playlist...");
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

      // Connect to voice channel if not connected
      if (!player.connected) {
        await player.connect();
      }

      // Search for the track
      console.log(`[Play] Searching for: ${query}`);
      const result = await player.search(query, interaction.user);
      console.log(`[Play] Search result:`, {
        loadType: result.loadType,
        tracksCount: result.tracks?.length || 0,
        error: result.exception?.message || null
      });

      if (!result.tracks.length) {
        console.log(`[Play] No tracks found for: ${query}`);
        return safeEditReply(interaction, i18n.__mf("play.errorNoResults", { url: `<${argSongName}>` }));
      }

      if (result.loadType === "playlist" && result.playlist) {
        // Add all tracks from playlist
        await player.queue.add(result.tracks);
        console.log(`[Play] Added ${result.tracks.length} tracks from playlist`);
        await safeEditReply(
          interaction,
          i18n.__mf("playlist.startedPlaylist", { author: interaction.user.id }) +
            `\n**${result.playlist.name}** - ${result.tracks.length} songs`
        );
      } else {
        // Add single track
        const track = result.tracks[0];
        console.log(`[Play] Adding track: ${track.info.title}`);
        await player.queue.add(track);
        console.log(`[Play] Track added. Queue size: ${player.queue.tracks.length}, Playing: ${player.playing}`);

        // If already playing, show "added to queue" message
        if (player.playing) {
          await safeEditReply(
            interaction,
            i18n.__mf("play.queueAdded", { title: track.info.title, author: interaction.user.id })
          );
        } else {
          // Show a brief loading message that will be followed by the "now playing" message
          await safeEditReply(interaction, "🎵 Loading...");
        }
      }

      // Start playing if not already
      if (!player.playing && !player.paused) {
        console.log(`[Play] Starting playback...`);
        await player.play();
        console.log(`[Play] Playback started. Playing: ${player.playing}`);
      } else {
        console.log(`[Play] Already playing or paused, not starting new playback`);
      }
    } catch (error: any) {
      console.error("Play command error:", error.message || error);
      console.error("Full error:", JSON.stringify(error, null, 2));

      const errorMessage = error.message?.includes("No result") || error.message?.includes("No matches")
        ? i18n.__mf("play.errorNoResults", { url: `<${argSongName}>` })
        : error.message?.includes("not a valid")
          ? i18n.__mf("play.errorInvalidURL", { url: `<${argSongName}>` })
          : i18n.__("common.errorCommand");

      await safeEditReply(interaction, errorMessage);
    }
  }
};
