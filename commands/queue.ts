import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Interaction,
  SlashCommandBuilder
} from "discord.js";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";
import { Track, UnresolvedTrack } from "lavalink-client";

type AnyTrack = Track | UnresolvedTrack;

export default {
  data: new SlashCommandBuilder().setName("queue").setDescription(i18n.__("queue.description")),
  cooldown: 5,
  async execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("queue.errorNotQueue") });
    }

    // Get all tracks including current
    const tracks: AnyTrack[] = [player.queue.current, ...player.queue.tracks];

    let currentPage = 0;
    const embeds = generateQueueEmbed(interaction, tracks);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("previous").setLabel("⬅️").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("stop").setLabel("⏹").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("next").setLabel("➡️").setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply("⏳ Loading queue...");

    if (interaction.replied)
      await interaction.editReply({
        content: `**${i18n.__mf("queue.currentPage")} ${currentPage + 1}/${embeds.length}**`,
        embeds: [embeds[currentPage]],
        components: [row]
      });

    const queueEmbed = await interaction.fetchReply();

    const filter = (buttonInteraction: Interaction) =>
      buttonInteraction.isButton() && buttonInteraction.user.id === interaction.user.id;

    const collector = queueEmbed.createMessageComponentCollector({ filter, time: 60000 });

    const buttonHandlers = {
      next: async () => {
        if (currentPage >= embeds.length - 1) return;

        currentPage++;

        await interaction.editReply({
          content: `**${i18n.__mf("queue.currentPage", {
            page: currentPage + 1,
            length: embeds.length
          })}**`,
          embeds: [embeds[currentPage]],
          components: [row]
        });
      },
      previous: async () => {
        if (currentPage === 0) return;

        currentPage--;
        await interaction.editReply({
          content: `**${i18n.__mf("queue.currentPage", {
            page: currentPage + 1,
            length: embeds.length
          })}**`,
          embeds: [embeds[currentPage]],
          components: [row]
        });
      },
      stop: async () => {
        await interaction.editReply({
          components: []
        });

        collector.stop();
      }
    };

    collector.on("collect", async (buttonInteraction) => {
      buttonInteraction.deferUpdate();

      const handler = buttonHandlers[buttonInteraction.customId as keyof typeof buttonHandlers];

      if (handler) {
        await handler();
      }
    });

    collector.on("end", () => {
      queueEmbed
        .edit({
          components: []
        })
        .catch(console.error);
    });
  }
};

function generateQueueEmbed(interaction: ChatInputCommandInteraction, tracks: AnyTrack[]) {
  let embeds = [];
  let k = 10;

  for (let i = 0; i < tracks.length; i += 10) {
    const current = tracks.slice(i, k);
    let j = i;
    k += 10;

    const info = current.map((track) => `${++j} - [${track.info.title}](${track.info.uri})`).join("\n");

    const embed = new EmbedBuilder()
      .setTitle(i18n.__("queue.embedTitle"))
      .setThumbnail(interaction.guild?.iconURL()!)
      .setColor("#F8AA2A")
      .setDescription(
        i18n.__mf("queue.embedCurrentSong", {
          title: tracks[0].info.title,
          url: tracks[0].info.uri,
          info: info
        })
      )
      .setTimestamp();
    embeds.push(embed);
  }

  return embeds;
}
