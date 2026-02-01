import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { splitBar } from "string-progressbar";
import { lavalink } from "../index";
import { i18n } from "../utils/i18n";

export default {
  data: new SlashCommandBuilder().setName("nowplaying").setDescription(i18n.__("nowplaying.description")),
  cooldown: 10,
  execute(interaction: ChatInputCommandInteraction) {
    const player = lavalink.getPlayer(interaction.guildId!);

    if (!player || !player.queue.current) {
      return interaction.reply({ content: i18n.__("nowplaying.errorNotQueue"), ephemeral: true }).catch(console.error);
    }

    const track = player.queue.current;
    const seek = Math.floor(player.position / 1000); // Convert ms to seconds
    const duration = Math.floor(track.info.duration / 1000); // Convert ms to seconds
    const left = duration - seek;

    let nowPlaying = new EmbedBuilder()
      .setTitle(i18n.__("nowplaying.embedTitle"))
      .setDescription(`${track.info.title}\n${track.info.uri}`)
      .setColor("#F8AA2A");

    if (duration > 0) {
      nowPlaying.addFields({
        name: "\u200b",
        value:
          new Date(seek * 1000).toISOString().substr(11, 8) +
          "[" +
          splitBar(duration == 0 ? seek : duration, seek, 20)[0] +
          "]" +
          (duration == 0 ? " ◉ LIVE" : new Date(duration * 1000).toISOString().substr(11, 8)),
        inline: false
      });

      nowPlaying.setFooter({
        text: i18n.__mf("nowplaying.timeRemaining", {
          time: new Date(left * 1000).toISOString().substr(11, 8)
        })
      });
    }

    return interaction.reply({ embeds: [nowPlaying] });
  }
};
