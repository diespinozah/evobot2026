import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export default {
  data: new SlashCommandBuilder().setName("stop").setDescription(i18n.__("stop.description")),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!player) return interaction.reply(i18n.__("stop.errorNotQueue")).catch(console.error);
    if (!guildMember || !canModifyQueue(guildMember)) return i18n.__("common.errorNotChannel");

    await player.destroy();

    safeReply(interaction, i18n.__mf("stop.result", { author: interaction.user.id }));
  }
};
