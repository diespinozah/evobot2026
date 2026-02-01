import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} from "discord.js";
import { i18n } from "../utils/i18n";
import { Client as GeniusClient, Song } from "genius-lyrics";
import { lavalink } from "../index";
import { config } from "../utils/config";

// Use API key if available, otherwise scrape (limited to 5 results)
const genius = new GeniusClient(config.GENIUS_API_KEY || undefined);

// Detect if title is likely anime-related
function isAnimeRelated(title: string): boolean {
  const animeKeywords = /\b(anime|opening|ending|op|ed|ost|jojo|naruto|attack on titan|demon slayer|one piece|dragon ball|bleach|death note|fullmetal|my hero|boku no hero|sword art|tokyo ghoul|hunter x hunter|one punch|mob psycho|evangelion|cowboy bebop|steins|fate|re:zero|konosuba|shield hero|overlord|slime|chainsaw man|spy ?x ?family|jujutsu|kaisen|kimetsu|shingeki)\b/i;
  return animeKeywords.test(title);
}

// Check if text contains non-latin characters (Japanese, Korean, Chinese)
function hasAsianCharacters(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(text);
}

// Sort results to prioritize romanized versions for anime
function sortResultsForAnime(results: Song[], isAnime: boolean): Song[] {
  if (!isAnime) return results;

  return [...results].sort((a, b) => {
    const aHasAsian = hasAsianCharacters(a.title);
    const bHasAsian = hasAsianCharacters(b.title);

    // Prioritize romanized (no Asian characters) first
    if (aHasAsian && !bHasAsian) return 1;
    if (!aHasAsian && bHasAsian) return -1;
    return 0;
  });
}

function cleanTitle(title: string): string {
  return title
    // Remove content in parentheses and brackets
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    // Remove everything after |
    .split("|")[0]
    // Remove common YouTube keywords
    .replace(/\b(official|video|audio|lyrics|lyric|hd|hq|4k|8k|60fps|remaster(ed)?|version|extended|explicit|clean|visualizer|music|creditless|full|tv size|amv)\b/gi, "")
    // Remove "ft.", "feat.", "featuring"
    .replace(/\b(ft\.?|feat\.?|featuring)\b/gi, "")
    // Remove extra whitespace and dashes at the end
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*$/g, "")
    .trim();
}

async function displayLyrics(song: Song): Promise<EmbedBuilder> {
  const lyrics = await song.lyrics();

  return new EmbedBuilder()
    .setTitle(`${song.artist.name} - ${song.title}`)
    .setURL(song.url)
    .setThumbnail(song.thumbnail)
    .setDescription(lyrics.length >= 4096 ? `${lyrics.substring(0, 4093)}...` : lyrics)
    .setColor("#F8AA2A")
    .setTimestamp();
}

export default {
  data: new SlashCommandBuilder()
    .setName("lyrics")
    .setDescription(i18n.__("lyrics.description"))
    .addStringOption((option) =>
      option
        .setName("search")
        .setDescription("Búsqueda manual (ej: 'Stand Proud' para anime openings)")
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const manualSearch = interaction.options.getString("search");

    // Allow manual search even without playing music
    if (!manualSearch && (!player || !player.queue.current)) {
      return interaction.reply({ content: i18n.__("lyrics.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    await interaction.reply({ content: "⏳ Buscando letra...", ephemeral: true }).catch(console.error);

    const originalTitle = player?.queue.current?.info.title || manualSearch || "";
    const searchQuery = manualSearch || cleanTitle(originalTitle);

    try {
      const rawSearches = await genius.songs.search(searchQuery);

      // Sort results for anime (romanized first)
      const isAnime = isAnimeRelated(originalTitle) || isAnimeRelated(searchQuery);
      const searches = sortResultsForAnime(rawSearches, isAnime);

      if (!searches || searches.length === 0) {
        const lyricsEmbed = new EmbedBuilder()
          .setTitle(i18n.__mf("lyrics.embedTitle", { title: originalTitle }))
          .setDescription(i18n.__mf("lyrics.lyricsNotFound", { title: originalTitle }) +
            "\n\n💡 **Tip:** Usa `/lyrics search:nombre de la canción` para buscar manualmente.")
          .setColor("#F8AA2A")
          .setTimestamp();

        return interaction.editReply({
          content: `🔍 Búsqueda: \`${searchQuery}\``,
          embeds: [lyricsEmbed]
        }).catch(console.error);
      }

      // Always show selection menu (even with 1 result, it might be wrong)
      const options = searches.slice(0, 25).map((song, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${song.title}`.substring(0, 100))
          .setDescription(`${song.artist.name}`.substring(0, 100))
          .setValue(index.toString())
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("lyrics_select")
        .setPlaceholder("Selecciona la canción correcta...")
        .addOptions(options);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const resultsList = searches
        .slice(0, 25)
        .map((song, i) => `**${i + 1}.** ${song.artist.name} - ${song.title}`)
        .join("\n");

      const animeNote = isAnime ? " (ordenado: romanizado primero)" : "";
      await interaction.editReply({
        content: `🔍 Búsqueda: \`${searchQuery}\`${animeNote}\n\n**Resultados encontrados (${searches.length}):**\n${resultsList}\n\n⬇️ **Selecciona la canción:**\n💡 *Tip: Usa \`/lyrics search:nombre\` para buscar manualmente*`,
        components: [row]
      });

      const message = await interaction.fetchReply();

      try {
        const selection = await message.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: (i) => i.user.id === interaction.user.id,
          time: 60000
        });

        await selection.deferUpdate();

        // Remove the ephemeral menu
        await interaction.editReply({
          content: `✅ Seleccionado: **${searches[parseInt(selection.values[0])].title}**\n⏳ Cargando letra...`,
          components: []
        });

        const selectedIndex = parseInt(selection.values[0]);
        const selectedSong = searches[selectedIndex];

        const lyricsEmbed = await displayLyrics(selectedSong);

        // Send lyrics as a PUBLIC message visible to everyone
        await interaction.followUp({
          content: `🎵 **${selectedSong.artist.name} - ${selectedSong.title}** (pedido por ${interaction.user})`,
          embeds: [lyricsEmbed],
          ephemeral: false
        });
      } catch (err) {
        // Timeout - remove the menu
        await interaction.editReply({
          content: `🔍 Búsqueda: \`${searchQuery}\`\n\n⏱️ Tiempo agotado. Usa \`/lyrics\` de nuevo.`,
          components: []
        }).catch(console.error);
      }

    } catch (error) {
      console.error("Lyrics error:", error);
      const lyricsEmbed = new EmbedBuilder()
        .setTitle(i18n.__mf("lyrics.embedTitle", { title: originalTitle }))
        .setDescription(i18n.__mf("lyrics.lyricsNotFound", { title: originalTitle }))
        .setColor("#F8AA2A")
        .setTimestamp();

      return interaction.editReply({
        content: `🔍 Búsqueda: \`${searchQuery}\``,
        embeds: [lyricsEmbed]
      }).catch(console.error);
    }
  }
};
