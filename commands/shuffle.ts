import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export default {
  data: new SlashCommandBuilder().setName("shuffle").setDescription(i18n.__("shuffle.description")),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("shuffle.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!guildMember || !canModifyQueue(guildMember)) return i18n.__("common.errorNotChannel");

    await player.queue.shuffle();

    const content = i18n.__mf("shuffle.result", { author: interaction.user.id });

    safeReply(interaction, content);
  }
};
