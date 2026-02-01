# EvoBot Development Guide

## Development Commands

- `npm run dev` - Development mode with auto-reload (nodemon + ts-node)
- `npm start` - Run bot with ts-node
- `npm run build` - Compile TypeScript to `dist/`
- `npm run prod` - Build and run compiled JS
- `npm run format` - Format code with Prettier
- `npm run commit` - Interactive commit with Commitizen (required for contributions)

## Architecture Overview

EvoBot uses **Lavalink** for audio playback, which provides stable voice connections by handling audio separately from Node.js.

```
Discord <--UDP--> Lavalink Server (Java) <--WebSocket--> Bot (Node.js)
```

### Main Files

- **Entry point**: `index.ts` - Creates Discord client, initializes Lavalink
- **structs/Bot.ts** - Command registration, interaction handling, cooldowns
- **structs/LavalinkHandler.ts** - Lavalink manager, events, playback controls
- **commands/** - Slash commands (play, queue, skip, lyrics, etc.)
- **locales/** - Language JSON files for i18n
- **utils/** - Config loading, permissions, URL patterns, i18n setup

## Configuration

### Bot Configuration

1. Copy `config.json.example` to `config.json`
2. Required fields:
   - `TOKEN` - Discord bot token

3. Optional settings:
   | Key | Default | Description |
   |-----|---------|-------------|
   | `MAX_PLAYLIST_SIZE` | 10 | Max tracks per playlist |
   | `PRUNING` | false | Auto-delete bot messages |
   | `LOCALE` | "en" | Language code (es, en, etc.) |
   | `DEFAULT_VOLUME` | 100 | Initial volume (0-100) |
   | `STAY_TIME` | 30 | Seconds before leaving empty channel |
   | `GENIUS_API_KEY` | "" | Genius API key for lyrics (optional, improves results) |

### Lavalink Configuration

| Config Key | Default | Description |
|------------|---------|-------------|
| `LAVALINK_HOST` | localhost | Lavalink server host |
| `LAVALINK_PORT` | 2333 | Lavalink server port |
| `LAVALINK_PASSWORD` | youshallnotpass | Lavalink authorization |
| `LAVALINK_SECURE` | false | Use SSL/TLS |

## Supported Sources

| Source | Status | Notes |
|--------|--------|-------|
| YouTube | ✅ | Via youtube-plugin + cipher server |
| SoundCloud | ✅ | Native support |
| Bandcamp | ✅ | Native support |
| Twitch | ✅ | Live streams |
| Vimeo | ✅ | Native support |
| HTTP | ✅ | Direct audio URLs |
| Spotify | ❌ | Requires LavaSrc plugin + credentials |

## Lyrics Command

The `/lyrics` command uses **Genius** to fetch song lyrics.

### Features
- Auto-detects song from current playback
- Manual search: `/lyrics search:song name`
- Selection menu when multiple results found
- Anime detection: prioritizes romanized titles
- Supports Genius API key for more results (5 without, 20+ with key)

### Get Genius API Key (Optional)
1. Go to https://genius.com/api-clients
2. Create account and new API client
3. Copy "Client Access Token"
4. Add to `config.json` as `GENIUS_API_KEY`

---

## VPS Deployment Guide (Ubuntu 20.04+)

### Requirements
- Ubuntu 20.04+ or Debian 11+
- 1GB+ RAM (512MB Lavalink + 512MB Bot)
- 1 CPU core minimum

### Step 1: System Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install basic tools
sudo apt install -y curl wget git unzip
```

### Step 2: Install Java 17+ (for Lavalink)

```bash
sudo apt install -y openjdk-17-jre-headless

# Verify
java -version
```

### Step 3: Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node -v
npm -v
```

### Step 4: Install PM2

```bash
sudo npm install -g pm2
```

### Step 5: Setup Lavalink

```bash
# Create directory
mkdir -p ~/lavalink && cd ~/lavalink

# Download Lavalink
wget https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar

# Create application.yml
nano application.yml
```

**application.yml content:**

```yaml
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  plugins:
    - dependency: "dev.lavalink.youtube:youtube-plugin:1.17.0"
      snapshot: false
  server:
    password: "YOUR_SECURE_PASSWORD"
    sources:
      youtube: false
      soundcloud: true
      bandcamp: true
      twitch: true
      vimeo: true
      http: true

plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - MUSIC
      - WEB
      - ANDROID_VR
    cipher:
      resolverUrl: "https://yt-cipher.onrender.com"

logging:
  level:
    root: INFO
    lavalink: INFO
```

**Create Lavalink PM2 config:**

```bash
nano ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: "lavalink",
    script: "java",
    args: "-Xmx512M -jar Lavalink.jar",
    cwd: "/root/lavalink",
    interpreter: "none",
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000
  }]
};
```

### Step 6: Setup EvoBot

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/evobot.git
cd evobot

# Install dependencies
npm install

# Build
npm run build

# Create config
cp config.json.example config.json
nano config.json
```

**config.json content:**

```json
{
  "TOKEN": "YOUR_DISCORD_TOKEN",
  "GENIUS_API_KEY": "YOUR_GENIUS_API_KEY",
  "MAX_PLAYLIST_SIZE": 10,
  "PRUNING": false,
  "LOCALE": "es",
  "STAY_TIME": 15,
  "DEFAULT_VOLUME": 100,
  "LAVALINK_HOST": "localhost",
  "LAVALINK_PORT": 2333,
  "LAVALINK_PASSWORD": "YOUR_SECURE_PASSWORD",
  "LAVALINK_SECURE": false
}
```

### Step 7: Start Services

```bash
# Start Lavalink first
cd ~/lavalink
pm2 start ecosystem.config.js

# Wait for Lavalink to initialize (10-15 seconds)
pm2 logs lavalink --lines 20

# Start bot
cd ~/evobot
pm2 start ecosystem.config.js

# Save for auto-restart on reboot
pm2 save
pm2 startup
```

### Step 8: Useful PM2 Commands

```bash
# View all processes
pm2 status

# View logs
pm2 logs              # All logs
pm2 logs evobot       # Bot logs only
pm2 logs lavalink     # Lavalink logs only

# Restart services
pm2 restart all
pm2 restart evobot
pm2 restart lavalink

# Monitor resources
pm2 monit

# Stop services
pm2 stop all
```

### Step 9: Update Bot (after code changes)

```bash
cd ~/evobot
git pull
npm install
npm run build
pm2 restart evobot
```

---

## Troubleshooting

### Bot doesn't connect to Lavalink
- Check Lavalink is running: `pm2 status`
- Check Lavalink logs: `pm2 logs lavalink`
- Verify password matches in both configs
- Wait 10-15 seconds after Lavalink starts

### YouTube not working
- Ensure youtube-plugin is configured
- Check cipher server is reachable
- View Lavalink logs for errors

### Lyrics not found
- Try manual search: `/lyrics search:song name`
- Add Genius API key for more results
- Some songs may not be on Genius

### Bot crashes on command
- Check logs: `pm2 logs evobot`
- Ensure all dependencies installed: `npm install`
- Rebuild: `npm run build`
