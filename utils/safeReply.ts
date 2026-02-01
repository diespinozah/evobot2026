import { ButtonInteraction, CommandInteraction, TextChannel } from "discord.js";

export async function safeReply(interaction: CommandInteraction | ButtonInteraction, content: string) {
  try {
    if (interaction.replied) {
      // Already replied, use followUp
      await interaction.followUp({ content, ephemeral: false }).catch(() => {});
    } else if (interaction.deferred) {
      // Deferred but not replied, use editReply
      await interaction.editReply({ content }).catch(() => {});
    } else {
      // Not deferred or replied, use reply
      await interaction.reply({ content }).catch(() => {});
    }
  } catch (error) {
    // If all else fails, try to send to channel
    try {
      const channel = interaction.channel as TextChannel;
      if (channel) {
        await channel.send(content).catch(() => {});
      }
    } catch {
      // Silently fail
    }
  }
}
