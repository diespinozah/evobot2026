import { Client, GatewayIntentBits } from "discord.js";
import { Bot } from "./structs/Bot";
import { LavalinkHandler } from "./structs/LavalinkHandler";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// Initialize Lavalink handler
export const lavalinkHandler = new LavalinkHandler(client);
export const lavalink = lavalinkHandler.lavalink;

// Initialize Lavalink connection when client is ready
client.once("ready", async () => {
  // Update client info in Lavalink manager
  if (lavalink.options.client) {
    lavalink.options.client.id = client.user!.id;
    lavalink.options.client.username = client.user!.username;
  }

  // Initialize Lavalink nodes
  await lavalink.init({ id: client.user!.id, username: client.user!.username });
  console.log("[Lavalink] Manager initialized");
});

// Bot handles login internally
export const bot = new Bot(client);
