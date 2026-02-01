import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export default {
  data: new SlashCommandBuilder().setName("skip").setDescription(i18n.__("skip.description")),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!player || !player.queue.current) {
      return interaction.reply(i18n.__("skip.errorNotQueue")).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return i18n.__("common.errorNotChannel");

    if (player.queue.tracks.length > 0) {
      await player.skip();
    } else {
      await player.stopPlaying(true, false);
    }

    safeReply(interaction, i18n.__mf("skip.result", { author: interaction.user.id }));
  }
};
