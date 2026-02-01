import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";
import { lavalink, lavalinkHandler } from "../index";
import { i18n } from "../utils/i18n";

export default {
  data: new SlashCommandBuilder()
    .setName("search")
    .setDescription(i18n.__("search.description"))
    .addStringOption((option) =>
      option.setName("query").setDescription(i18n.__("search.optionQuery")).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const query = interaction.options.getString("query", true);
    const member = interaction.member as GuildMember;

    if (!member?.voice.channel) {
      return interaction.reply({ content: i18n.__("search.errorNotChannel"), ephemeral: true }).catch(console.error);
    }

    await interaction.reply("⏳ Searching and playing...").catch(console.error);

    try {
      let player = lavalink.getPlayer(interaction.guildId!);

      // Create player if it doesn't exist
      if (!player) {
        player = await lavalinkHandler.createPlayer({
          guildId: interaction.guildId!,
          voiceChannelId: member.voice.channel.id,
          textChannelId: interaction.channelId
        });
      }

      // Connect if not connected
      if (!player.connected) {
        await player.connect();
      }

      // Search with YouTube
      const result = await player.search(query, interaction.user);

      if (!result.tracks.length) {
        return interaction.editReply({ content: i18n.__("search.noResults") }).catch(console.error);
      }

      // Add first result to queue
      const track = result.tracks[0];
      await player.queue.add(track);

      // Start playing if not already
      if (!player.playing && !player.paused) {
        await player.play();
      }

      await interaction.deleteReply().catch(() => {});
    } catch (error) {
      console.error("Search error:", error);
      interaction.editReply({ content: i18n.__("search.noResults") }).catch(console.error);
    }
  }
};
