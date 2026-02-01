import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { lavalink, bot } from "../index";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";

export default {
  data: new SlashCommandBuilder()
    .setName("skipto")
    .setDescription(i18n.__("skipto.description"))
    .addIntegerOption((option) =>
      option.setName("number").setDescription(i18n.__("skipto.args.number")).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const playlistSlotArg = interaction.options.getInteger("number");
    const guildMember = interaction.guild!.members.cache.get(interaction.user.id);

    if (!playlistSlotArg || isNaN(playlistSlotArg)) {
      return interaction
        .reply({
          content: i18n.__mf("skipto.usageReply", { prefix: bot.prefix, name: "skipto" }),
          ephemeral: true
        })
        .catch(console.error);
    }

    const player = lavalink.getPlayer(interaction.guildId!);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("skipto.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    if (!canModifyQueue(guildMember!)) return i18n.__("common.errorNotChannel");

    // Total queue length (current + queued tracks)
    const totalLength = 1 + player.queue.tracks.length;

    if (playlistSlotArg > totalLength || playlistSlotArg < 1) {
      return interaction
        .reply({ content: i18n.__mf("skipto.errorNotValid", { length: totalLength }), ephemeral: true })
        .catch(console.error);
    }

    // If skipto 1, do nothing (already playing)
    if (playlistSlotArg === 1) {
      return interaction
        .reply({ content: i18n.__mf("skipto.result", { author: interaction.user.id, arg: playlistSlotArg }) })
        .catch(console.error);
    }

    // Skip to specific position by removing tracks before it
    const skipCount = playlistSlotArg - 1;

    // Remove tracks before the target
    player.queue.tracks.splice(0, skipCount - 1);

    // Skip the current track to start the target track
    await player.skip();

    interaction
      .reply({ content: i18n.__mf("skipto.result", { author: interaction.user.id, arg: playlistSlotArg }) })
      .catch(console.error);
  }
};
