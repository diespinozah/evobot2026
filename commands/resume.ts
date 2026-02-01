import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export default {
  data: new SlashCommandBuilder().setName("resume").setDescription(i18n.__("resume.description")),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("resume.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return i18n.__("common.errorNotChannel");

    if (player.paused) {
      await player.resume();
      const content = i18n.__mf("resume.resultNotPlaying", { author: interaction.user.id });
      safeReply(interaction, content);
      return true;
    }

    const content = i18n.__("resume.errorPlaying");
    safeReply(interaction, content);
    return false;
  }
};
