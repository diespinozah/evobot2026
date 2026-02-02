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
import { lavalink } from "../index";
import { config } from "../utils/config";

const GENIUS_API_KEY = config.GENIUS_API_KEY || "";

interface GeniusHit {
  result: {
    id: number;
    title: string;
    artist_names: string;
    url: string;
    song_art_image_url: string;
    full_title: string;
  };
}

interface SearchResult {
  id: number;
  title: string;
  artist: string;
  url: string;
  thumbnail: string;
  fullTitle: string;
}

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
function sortResultsForAnime(results: SearchResult[], isAnime: boolean): SearchResult[] {
  if (!isAnime) return results;

  return [...results].sort((a, b) => {
    const aHasAsian = hasAsianCharacters(a.title);
    const bHasAsian = hasAsianCharacters(b.title);

    if (aHasAsian && !bHasAsian) return 1;
    if (!aHasAsian && bHasAsian) return -1;
    return 0;
  });
}

function cleanTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .split("|")[0]
    .replace(/\b(official|video|audio|lyrics|lyric|hd|hq|4k|8k|60fps|remaster(ed)?|version|extended|explicit|clean|visualizer|music|creditless|full|tv size|amv)\b/gi, "")
    .replace(/\b(ft\.?|feat\.?|featuring)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*$/g, "")
    .trim();
}

// Search using Genius API directly
async function searchGenius(query: string): Promise<SearchResult[]> {
  if (!GENIUS_API_KEY) {
    throw new Error("GENIUS_API_KEY not configured");
  }

  const response = await fetch(
    `https://api.genius.com/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${GENIUS_API_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Genius API error: ${response.status}`);
  }

  const data = await response.json();
  const hits: GeniusHit[] = data.response?.hits || [];

  return hits.map((hit) => ({
    id: hit.result.id,
    title: hit.result.title,
    artist: hit.result.artist_names,
    url: hit.result.url,
    thumbnail: hit.result.song_art_image_url,
    fullTitle: hit.result.full_title
  }));
}

// Cloudflare Worker URL for Genius proxy (bypasses Cloudflare blocking)
const GENIUS_WORKER_URL = "https://genlyrics.diehgo15.workers.dev";

// Fetch lyrics via Cloudflare Worker (no more blocking!)
async function fetchLyricsGenius(geniusUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8 second timeout

  try {
    const workerUrl = `${GENIUS_WORKER_URL}?url=${encodeURIComponent(geniusUrl)}`;

    const response = await fetch(workerUrl, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[Lyrics] Worker returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.success && data.lyrics) {
      console.log("[Lyrics] ✓ Worker obtuvo letras de Genius");
      return data.lyrics;
    }

    console.log("[Lyrics] Worker no encontró letras:", data.error || "empty");
    return null;
  } catch (error) {
    clearTimeout(timeout);
    console.log("[Lyrics] Worker error:", error);
    return null;
  }
}

// Fetch lyrics from lyrics.ovh (free API, no auth needed)
async function fetchLyricsOvh(artist: string, title: string): Promise<string | null> {
  try {
    const cleanArtist = artist.replace(/\s+/g, " ").trim();
    const cleanSongTitle = title.replace(/\s+/g, " ").trim();

    const response = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanSongTitle)}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.lyrics || null;
  } catch {
    return null;
  }
}

// Try LRCLIB exact match
async function fetchLyricsLrclibExact(artist: string, title: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.plainLyrics || data.syncedLyrics || null;
  } catch {
    return null;
  }
}

interface LrclibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  plainLyrics?: string;
  syncedLyrics?: string;
}

// Try LRCLIB search (better for anime/non-western music)
async function fetchLyricsLrclibSearch(query: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      // Return first result with lyrics
      for (const result of data) {
        if (result.plainLyrics || result.syncedLyrics) {
          return result.plainLyrics || result.syncedLyrics;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Search LRCLIB and return all results (for alternative menu)
async function searchLrclib(query: string): Promise<LrclibResult[]> {
  try {
    const response = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) return [];

    const data = await response.json();
    if (Array.isArray(data)) {
      return data.filter((r: LrclibResult) => r.plainLyrics || r.syncedLyrics);
    }
    return [];
  } catch {
    return [];
  }
}

// Try Netease/163 Music API (good for Asian music)
async function fetchLyricsNetease(query: string): Promise<string | null> {
  try {
    // Search for song
    const searchResponse = await fetch(
      `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&limit=1`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://music.163.com/"
        }
      }
    );

    if (!searchResponse.ok) return null;

    const searchData = await searchResponse.json();
    const songId = searchData.result?.songs?.[0]?.id;
    if (!songId) return null;

    // Get lyrics
    const lyricsResponse = await fetch(
      `https://music.163.com/api/song/lyric?id=${songId}&lv=1`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://music.163.com/"
        }
      }
    );

    if (!lyricsResponse.ok) return null;

    const lyricsData = await lyricsResponse.json();
    const rawLyrics = lyricsData.lrc?.lyric;
    if (!rawLyrics) return null;

    // Clean synced lyrics (remove timestamps)
    return rawLyrics
      .split("\n")
      .map((line: string) => line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim())
      .filter((line: string) => line.length > 0)
      .join("\n");
  } catch {
    return null;
  }
}

interface LyricsResult {
  lyrics: string;
  source: string;
  geniusFailed?: boolean;
  alternatives?: LrclibResult[];
}

// Check if the search is for a romanized version
function isRomanizedSearch(artist: string, title: string): boolean {
  const combined = `${artist} ${title}`.toLowerCase();
  return combined.includes("romaniz") || combined.includes("romaji") || combined.includes("羅馬");
}

// Clean title for alternative searches (remove "Romanized", etc.)
function getCleanSearchTerms(artist: string, title: string): { cleanArtist: string; cleanTitle: string } {
  // Remove "Genius Romanizations" from artist
  let cleanArtist = artist
    .replace(/genius\s*romanizations?\s*[-–—]?\s*/gi, "")
    .replace(/\s*[-–—]\s*$/g, "")
    .trim();

  // Remove "(Romanized)" from title
  let cleanTitle = title
    .replace(/\s*\(romanized\)\s*/gi, "")
    .replace(/\s*romanized\s*/gi, "")
    .replace(/\s*romaji\s*/gi, "")
    .trim();

  return { cleanArtist, cleanTitle };
}

async function getLyrics(artist: string, title: string, geniusUrl?: string): Promise<LyricsResult> {
  const isRomanized = isRomanizedSearch(artist, title);
  const { cleanArtist, cleanTitle } = getCleanSearchTerms(artist, title);
  const searchQuery = `${cleanArtist} ${cleanTitle}`;

  // Try Genius FIRST (via Worker - fast and reliable now)
  if (geniusUrl) {
    console.log("[Lyrics] Intentando con Genius (Worker)...");
    const genius = await fetchLyricsGenius(geniusUrl);
    if (genius) {
      console.log("[Lyrics] ✓ Cargado desde Genius");
      return { lyrics: genius, source: "Genius", geniusFailed: false };
    }
    console.log("[Lyrics] ✗ Genius falló, buscando alternativas...");
  }

  // Genius failed - search alternatives in parallel
  const romajiQuery = `${cleanArtist} ${cleanTitle} romaji`;

  const results = await Promise.all([
    fetchLyricsLrclibExact(cleanArtist, cleanTitle),
    fetchLyricsOvh(cleanArtist, cleanTitle),
    fetchLyricsLrclibSearch(searchQuery),
    isRomanized ? fetchLyricsLrclibSearch(romajiQuery) : Promise.resolve(null),
    fetchLyricsNetease(searchQuery),
    searchLrclib(searchQuery)
  ]);

  const [lrclibExact, lyricsOvh, lrclibSearch, lrclibRomaji, netease, lrclibAlternatives] = results;

  // If searching for romanized, prioritize romaji results
  if (isRomanized && lrclibRomaji) {
    console.log("[Lyrics] ✓ Cargado desde LRCLIB (romaji)");
    return { lyrics: lrclibRomaji, source: "LRCLIB (romaji)", geniusFailed: true, alternatives: lrclibAlternatives };
  }

  if (lrclibExact) {
    console.log("[Lyrics] ✓ Cargado desde LRCLIB");
    return { lyrics: lrclibExact, source: "LRCLIB", geniusFailed: true, alternatives: lrclibAlternatives };
  }
  if (lyricsOvh) {
    console.log("[Lyrics] ✓ Cargado desde lyrics.ovh");
    return { lyrics: lyricsOvh, source: "lyrics.ovh", geniusFailed: true, alternatives: lrclibAlternatives };
  }
  if (lrclibSearch) {
    console.log("[Lyrics] ✓ Cargado desde LRCLIB");
    return { lyrics: lrclibSearch, source: "LRCLIB", geniusFailed: true, alternatives: lrclibAlternatives };
  }
  if (netease) {
    console.log("[Lyrics] ✓ Cargado desde Netease");
    const sourceNote = isRomanized ? "Netease (versión original, no romanizada)" : "Netease";
    return { lyrics: netease, source: sourceNote, geniusFailed: true, alternatives: lrclibAlternatives };
  }

  console.log("[Lyrics] ✗ No se encontraron letras en ninguna fuente");
  return {
    lyrics: "No se encontraron las letras para esta canción.\n\n💡 Intenta con `/lyrics search:artista - canción`",
    source: "none",
    geniusFailed: true,
    alternatives: lrclibAlternatives
  };
}

interface DisplayLyricsResult {
  embed: EmbedBuilder;
  geniusFailed: boolean;
  alternatives: LrclibResult[];
}

async function displayLyrics(song: SearchResult): Promise<DisplayLyricsResult> {
  // Pass Genius URL to try fetching from there first
  const result = await getLyrics(song.artist, song.title, song.url);

  let description = result.lyrics;

  // If Genius failed and there are alternatives, show them in description
  if (result.geniusFailed && result.alternatives && result.alternatives.length > 1) {
    const altList = result.alternatives
      .slice(0, 5)
      .map((alt, i) => `${i + 1}. ${alt.artistName} - ${alt.trackName}`)
      .join("\n");

    description = result.lyrics + `\n\n───────────────────\n📋 **Otras versiones en LRCLIB:**\n${altList}\n\n_Usa \`/lyrics search:artista - canción\` para buscar otra versión_`;
  }

  // Truncate if too long
  if (description.length >= 4096) {
    description = description.substring(0, 4093) + "...";
  }

  const embed = new EmbedBuilder()
    .setTitle(`${song.artist} - ${song.title}`)
    .setURL(song.url)
    .setThumbnail(song.thumbnail)
    .setDescription(description)
    .setColor(result.source === "Genius" ? "#FFFF64" : "#F8AA2A")
    .setTimestamp();

  // Add footer showing source
  if (result.source !== "none") {
    const footerText = result.geniusFailed
      ? `⚠️ Genius bloqueado | Fuente: ${result.source}`
      : `Fuente: ${result.source}`;
    embed.setFooter({ text: footerText });
  }

  return {
    embed,
    geniusFailed: result.geniusFailed || false,
    alternatives: result.alternatives || []
  };
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
      const rawSearches = await searchGenius(searchQuery);

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
          .setDescription(`${song.artist}`.substring(0, 100))
          .setValue(index.toString())
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("lyrics_select")
        .setPlaceholder("Selecciona la canción correcta...")
        .addOptions(options);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const resultsList = searches
        .slice(0, 25)
        .map((song, i) => `**${i + 1}.** ${song.artist} - ${song.title}`)
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

        const { embed: lyricsEmbed, geniusFailed } = await displayLyrics(selectedSong);

        // Send lyrics as a PUBLIC message visible to everyone
        const warningNote = geniusFailed ? " ⚠️" : "";
        await interaction.followUp({
          content: `🎵 **${selectedSong.artist} - ${selectedSong.title}**${warningNote} (pedido por ${interaction.user})`,
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
