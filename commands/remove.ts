import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { lavalink, bot } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { Track, UnresolvedTrack } from "lavalink-client";

type AnyTrack = Track | UnresolvedTrack;

const pattern = /^[0-9]{1,2}(\s*,\s*[0-9]{1,2})*$/;

export default {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription(i18n.__("remove.description"))
    .addStringOption((option) =>
      option.setName("slot").setDescription(i18n.__("remove.description")).setRequired(true)
    ),
  execute(interaction: ChatInputCommandInteraction) {
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);
    const removeArgs = interaction.options.getString("slot");

    const player = lavalink.getPlayer(interaction.guildId!);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("remove.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return i18n.__("common.errorNotChannel");

    if (!removeArgs) {
      return interaction.reply({ content: i18n.__mf("remove.usageReply", { prefix: bot.prefix }), ephemeral: true });
    }

    // Build full track list (current + queue)
    const allTracks: AnyTrack[] = [player.queue.current, ...player.queue.tracks];
    const slots = removeArgs.split(",").map((arg) => parseInt(arg.trim()));

    let removed: AnyTrack[] = [];

    if (pattern.test(removeArgs)) {
      // Filter out tracks to remove (keeping current track at index 0)
      const indicesToRemove = new Set(slots.map((s) => s - 1)); // Convert to 0-indexed

      // We can only remove from queue, not the current playing track
      const newQueueTracks = player.queue.tracks.filter((_, index) => {
        const actualIndex = index + 1; // +1 because index 0 in queue is position 2 in list
        if (indicesToRemove.has(actualIndex)) {
          removed.push(player.queue.tracks[index]);
          return false;
        }
        return true;
      });

      // Replace queue tracks
      player.queue.tracks.splice(0, player.queue.tracks.length, ...newQueueTracks);

      if (removed.length > 0) {
        interaction.reply(
          i18n.__mf("remove.result", {
            title: removed.map((track) => track.info.title).join("\n"),
            author: interaction.user.id
          })
        );
      } else {
        interaction.reply({ content: i18n.__mf("remove.usageReply", { prefix: bot.prefix }), ephemeral: true });
      }
    } else if (!isNaN(+removeArgs) && +removeArgs >= 2 && +removeArgs <= allTracks.length) {
      // Single track removal (can't remove current track at position 1)
      const queueIndex = +removeArgs - 2; // Convert to queue index
      if (queueIndex >= 0 && queueIndex < player.queue.tracks.length) {
        const removedTrack = player.queue.tracks.splice(queueIndex, 1)[0];
        return interaction.reply(
          i18n.__mf("remove.result", {
            title: removedTrack.info.title,
            author: interaction.user.id
          })
        );
      }
      return interaction.reply({ content: i18n.__mf("remove.usageReply", { prefix: bot.prefix }) });
    } else {
      return interaction.reply({ content: i18n.__mf("remove.usageReply", { prefix: bot.prefix }) });
    }
  }
};
