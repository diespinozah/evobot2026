import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";

export default {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription(i18n.__("volume.description"))
    .addIntegerOption((option) => option.setName("volume").setDescription(i18n.__("volume.description"))),
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);
    const volumeArg = interaction.options.getInteger("volume");

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("volume.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) {
      return interaction.reply({ content: i18n.__("volume.errorNotChannel"), ephemeral: true }).catch(console.error);
    }

    if (!volumeArg || volumeArg === player.volume) {
      return interaction
        .reply({ content: i18n.__mf("volume.currentVolume", { volume: player.volume }) })
        .catch(console.error);
    }

    if (isNaN(volumeArg)) {
      return interaction.reply({ content: i18n.__("volume.errorNotNumber"), ephemeral: true }).catch(console.error);
    }

    if (Number(volumeArg) > 100 || Number(volumeArg) < 0) {
      return interaction.reply({ content: i18n.__("volume.errorNotValid"), ephemeral: true }).catch(console.error);
    }

    await player.setVolume(volumeArg);

    return interaction.reply({ content: i18n.__mf("volume.result", { arg: volumeArg }) }).catch(console.error);
  }
};
