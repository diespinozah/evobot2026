import move from "array-move";
import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink, bot } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";

export default {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription(i18n.__("move.description"))
    .addIntegerOption((option) =>
      option.setName("movefrom").setDescription(i18n.__("move.args.movefrom")).setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("moveto").setDescription(i18n.__("move.args.moveto")).setRequired(true)
    ),
  execute(interaction: ChatInputCommandInteraction) {
    const movefromArg = interaction.options.getInteger("movefrom");
    const movetoArg = interaction.options.getInteger("moveto");

    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);
    const player = lavalink.getPlayer(interaction.guildId!);

    if (!player || !player.queue.current) {
      return interaction.reply(i18n.__("move.errorNotQueue")).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return;

    if (!movefromArg || !movetoArg) {
      return interaction.reply({ content: i18n.__mf("move.usagesReply", { prefix: bot.prefix }), ephemeral: true });
    }

    if (isNaN(movefromArg) || movefromArg <= 1) {
      return interaction.reply({ content: i18n.__mf("move.usagesReply", { prefix: bot.prefix }), ephemeral: true });
    }

    // Get all tracks (queue.tracks doesn't include current)
    const tracks = [...player.queue.tracks];

    // Adjust indices (movefrom/moveto are 1-indexed, and index 1 is current song)
    const fromIndex = movefromArg - 2; // -2 because 1 is current, 2 is first in queue
    const toIndex = movetoArg <= 1 ? 0 : movetoArg - 2;

    if (fromIndex < 0 || fromIndex >= tracks.length) {
      return interaction.reply({ content: i18n.__mf("move.usagesReply", { prefix: bot.prefix }), ephemeral: true });
    }

    const track = tracks[fromIndex];
    const movedTracks = move(tracks, fromIndex, toIndex);

    // Clear queue and re-add
    player.queue.tracks.splice(0, player.queue.tracks.length, ...movedTracks);

    interaction.reply({
      content: i18n.__mf("move.result", {
        author: interaction.user.id,
        title: track.info.title,
        index: movetoArg == 1 ? 1 : movetoArg
      })
    });
  }
};
