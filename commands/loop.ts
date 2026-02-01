import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export default {
  data: new SlashCommandBuilder().setName("loop").setDescription(i18n.__("loop.description")),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);

    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("loop.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!guildMember || !canModifyQueue(guildMember)) return i18n.__("common.errorNotChannel");

    // Toggle between no repeat (off) and repeat song (track)
    const newRepeatMode = player.repeatMode === "off" ? "track" : "off";
    await player.setRepeatMode(newRepeatMode);

    const content = i18n.__mf("loop.result", {
      loop: newRepeatMode === "track" ? i18n.__("common.on") : i18n.__("common.off")
    });

    safeReply(interaction, content);
  }
};
