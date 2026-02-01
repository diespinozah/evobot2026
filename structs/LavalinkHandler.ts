import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GuildMember,
  Interaction,
  Message,
  TextChannel
} from "discord.js";
import { LavalinkManager, Player, Track, LavalinkNode } from "lavalink-client";
import { config } from "../utils/config";
import { i18n } from "../utils/i18n";
import { canModifyQueue } from "../utils/queue";
import { safeReply } from "../utils/safeReply";

export class LavalinkHandler {
  public readonly lavalink: LavalinkManager;
  private client: Client;

  public constructor(client: Client) {
    this.client = client;

    // Read Lavalink config from config.json or environment variables
    const lavalinkHost = (config as any).LAVALINK_HOST || process.env.LAVALINK_HOST || "localhost";
    const lavalinkPort = (config as any).LAVALINK_PORT || parseInt(process.env.LAVALINK_PORT || "2333");
    const lavalinkPassword = (config as any).LAVALINK_PASSWORD || process.env.LAVALINK_PASSWORD || "youshallnotpass";
    const lavalinkSecure = (config as any).LAVALINK_SECURE || process.env.LAVALINK_SECURE === "true";

    console.log(`[Lavalink] Connecting to ${lavalinkHost}:${lavalinkPort}`);

    this.lavalink = new LavalinkManager({
      nodes: [
        {
          id: "main",
          host: lavalinkHost,
          port: lavalinkPort,
          authorization: lavalinkPassword,
          secure: lavalinkSecure
        }
      ],
      sendToShard: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      },
      autoSkip: true,
      client: {
        id: process.env.CLIENT_ID || "",
        username: "EvoBot"
      },
      playerOptions: {
        defaultSearchPlatform: "ytsearch",
        onDisconnect: {
          autoReconnect: true,
          destroyPlayer: false
        },
        onEmptyQueue: {
          destroyAfterMs: (config.STAY_TIME || 30) * 1000
        }
      }
    });

    this.setupEvents();
  }

  private setupEvents() {
    // Forward raw events from Discord to Lavalink
    this.client.on("raw", (data) => {
      this.lavalink.sendRawData(data);
    });

    // Node events - using correct event names
    this.lavalink.nodeManager.on("connect", (node: LavalinkNode) => {
      console.log(`[Lavalink] Node "${node.id}" connected`);
    });

    this.lavalink.nodeManager.on("disconnect", (node: LavalinkNode, reason: { code?: number; reason?: string }) => {
      console.log(`[Lavalink] Node "${node.id}" disconnected: ${reason?.reason || reason?.code || "unknown"}`);
    });

    this.lavalink.nodeManager.on("error", (node: LavalinkNode, error: Error) => {
      console.error(`[Lavalink] Node "${node.id}" error:`, error);
    });

    // Track events
    this.lavalink.on("trackStart", (player, track) => {
      console.log(`[Lavalink] Track started: ${track?.info.title}`);
      if (track) {
        this.sendPlayingMessage(player, track);
      }
    });

    this.lavalink.on("trackEnd", (player, track, payload) => {
      if (payload.reason === "replaced") return; // Track was replaced by another
      console.log(`[Lavalink] Track ended: ${track?.info.title} (${payload.reason})`);
    });

    this.lavalink.on("trackError", (player, track, payload) => {
      console.error(`[Lavalink] Track error for ${track?.info.title}:`, payload);
      const textChannel = this.client.channels.cache.get(player.textChannelId!) as TextChannel;
      if (textChannel) {
        textChannel.send(i18n.__("common.errorCommand")).catch(console.error);
      }
    });

    this.lavalink.on("trackStuck", (player, track) => {
      console.warn(`[Lavalink] Track stuck: ${track?.info.title}`);
      player.skip().catch(console.error);
    });

    // Queue events
    this.lavalink.on("queueEnd", (player) => {
      const textChannel = this.client.channels.cache.get(player.textChannelId!) as TextChannel;
      if (textChannel && !config.PRUNING) {
        textChannel.send(i18n.__("play.queueEnded")).catch(console.error);
      }
    });

    this.lavalink.on("playerDestroy", (player) => {
      console.log(`[Lavalink] Player destroyed for guild ${player.guildId}`);
    });
  }

  private createButtonRow() {
    const firstRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("skip").setLabel("⏭").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("play_pause").setLabel("⏯").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("mute").setLabel("🔇").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("decrease_volume").setLabel("🔉").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("increase_volume").setLabel("🔊").setStyle(ButtonStyle.Secondary)
    );
    const secondRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("loop").setLabel("🔁").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("shuffle").setLabel("🔀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("stop").setLabel("⏹").setStyle(ButtonStyle.Secondary)
    );

    return [firstRow, secondRow];
  }

  private async sendPlayingMessage(player: Player, track: Track) {
    const textChannel = this.client.channels.cache.get(player.textChannelId!) as TextChannel;

    if (!textChannel) return;

    const content = i18n.__mf("play.startedPlaying", {
      title: track.info.title,
      url: track.info.uri || ""
    });

    let playingMessage: Message;

    try {
      playingMessage = await textChannel.send({
        content,
        components: this.createButtonRow()
      });
    } catch (error: unknown) {
      console.error(error);
      return;
    }

    const filter = (i: Interaction) => i.isButton() && i.message.id === playingMessage.id;

    const collector = playingMessage.createMessageComponentCollector({
      filter,
      time: track.info.duration > 0 ? track.info.duration : 60000
    });

    collector.on("collect", async (interaction) => {
      if (!interaction.isButton()) return;

      const member = interaction.member as GuildMember;
      const currentPlayer = this.lavalink.getPlayer(interaction.guildId!);

      if (!currentPlayer) {
        collector.stop();
        return;
      }

      switch (interaction.customId) {
        case "skip":
          if (!canModifyQueue(member)) return;
          if (currentPlayer.queue.tracks.length > 0) {
            await currentPlayer.skip();
          } else {
            await currentPlayer.stopPlaying(true, false);
          }
          safeReply(interaction, i18n.__mf("skip.result", { author: interaction.user.id }));
          collector.stop();
          break;

        case "play_pause":
          if (!canModifyQueue(member)) return;
          if (currentPlayer.paused) {
            await currentPlayer.resume();
            safeReply(interaction, i18n.__mf("resume.resultNotPlaying", { author: interaction.user.id }));
          } else {
            await currentPlayer.pause();
            safeReply(interaction, i18n.__mf("pause.result", { author: interaction.user.id }));
          }
          break;

        case "mute":
          if (!canModifyQueue(member)) return;
          if (currentPlayer.volume === 0) {
            await currentPlayer.setVolume(config.DEFAULT_VOLUME || 100);
            safeReply(interaction, i18n.__mf("play.unmutedSong", { author: interaction.user }));
          } else {
            await currentPlayer.setVolume(0);
            safeReply(interaction, i18n.__mf("play.mutedSong", { author: interaction.user }));
          }
          break;

        case "decrease_volume":
          if (!canModifyQueue(member)) return;
          const newVolDown = Math.max(currentPlayer.volume - 10, 0);
          await currentPlayer.setVolume(newVolDown);
          safeReply(interaction, i18n.__mf("play.decreasedVolume", { author: interaction.user, volume: newVolDown }));
          break;

        case "increase_volume":
          if (!canModifyQueue(member)) return;
          const newVolUp = Math.min(currentPlayer.volume + 10, 100);
          await currentPlayer.setVolume(newVolUp);
          safeReply(interaction, i18n.__mf("play.increasedVolume", { author: interaction.user, volume: newVolUp }));
          break;

        case "loop":
          if (!canModifyQueue(member)) return;
          const newRepeatMode = currentPlayer.repeatMode === "off" ? "track" : "off";
          await currentPlayer.setRepeatMode(newRepeatMode);
          safeReply(
            interaction,
            i18n.__mf("loop.result", { loop: newRepeatMode === "track" ? i18n.__("common.on") : i18n.__("common.off") })
          );
          break;

        case "shuffle":
          if (!canModifyQueue(member)) return;
          await currentPlayer.queue.shuffle();
          safeReply(interaction, i18n.__mf("shuffle.result", { author: interaction.user.id }));
          break;

        case "stop":
          if (!canModifyQueue(member)) return;
          await currentPlayer.destroy();
          safeReply(interaction, i18n.__mf("stop.result", { author: interaction.user.id }));
          collector.stop();
          break;
      }
    });

    collector.on("end", () => {
      playingMessage.edit({ components: [] }).catch(console.error);

      if (config.PRUNING) {
        setTimeout(() => {
          playingMessage.delete().catch(() => {});
        }, 3000);
      }
    });
  }

  public getPlayer(guildId: string): Player | undefined {
    return this.lavalink.getPlayer(guildId);
  }

  public async createPlayer(options: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
  }): Promise<Player> {
    return this.lavalink.createPlayer({
      guildId: options.guildId,
      voiceChannelId: options.voiceChannelId,
      textChannelId: options.textChannelId,
      selfDeaf: true,
      volume: config.DEFAULT_VOLUME || 100
    });
  }
}
