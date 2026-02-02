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
- **Cloudflare Worker proxy** for VPS deployments (bypasses Cloudflare blocking)
- Fallback sources: LRCLIB, lyrics.ovh, Netease

### Get Genius API Key (Required for VPS)
1. Go to https://genius.com/api-clients
2. Create account and new API client
3. Copy "Client Access Token"
4. Add to `config.json` as `GENIUS_API_KEY`

### Cloudflare Worker Setup (Required for VPS)

Genius blocks scraping from datacenter IPs. A Cloudflare Worker acts as a proxy to fetch lyrics.

**Step 1: Create Cloudflare Account**
1. Go to https://dash.cloudflare.com/sign-up
2. Create free account
3. Navigate to **Workers & Pages**

**Step 2: Create Worker**
1. Click **Create Application** → **Create Worker**
2. Name it: `genius-proxy` (or any name)
3. Click **Deploy**
4. Click **Edit code**

**Step 3: Paste Worker Code**

```javascript
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const geniusUrl = url.searchParams.get('url');

      if (!geniusUrl || !geniusUrl.includes('genius.com')) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const response = await fetch(geniusUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Genius returned ${response.status}` }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const html = await response.text();
      const parts = [];
      const sections = html.split(/data-lyrics-container="true"/gi);

      for (let i = 1; i < sections.length; i++) {
        const section = sections[i];
        const startIdx = section.indexOf('>');
        if (startIdx === -1) continue;

        let content = section.substring(startIdx + 1);
        const endMarkers = ['data-lyrics-container', 'class="LyricsFooter', 'class="RightSidebar'];

        let endIdx = content.length;
        for (const marker of endMarkers) {
          const idx = content.indexOf(marker);
          if (idx !== -1 && idx < endIdx) endIdx = idx;
        }

        let depth = 1, actualEnd = 0;
        for (let j = 0; j < content.length && j < endIdx; j++) {
          if (content.substring(j, j + 4) === '<div') depth++;
          else if (content.substring(j, j + 6) === '</div>') {
            depth--;
            if (depth === 0) { actualEnd = j; break; }
          }
        }

        content = actualEnd > 0 ? content.substring(0, actualEnd) : content.substring(0, endIdx);
        if (content.trim()) parts.push(content);
      }

      let lyrics = parts.join('\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/<[a-z][a-z0-9]*\s*$/gim, '')
        .replace(/<\/[a-z][a-z0-9]*\s*$/gim, '')
        .replace(/<[a-z][a-z0-9]*(?:\s+[^>]*)?\s*\n/gim, '\n')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#\d+;/g, '')
        .replace(/^\d+\s*Contributors?.*$/gim, '')
        .replace(/^.*Lyrics$/gim, '')
        .replace(/^Translations?$/gim, '')
        .replace(/^You might also like$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return new Response(JSON.stringify({ success: true, lyrics: lyrics || null, url: geniusUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};
```

5. Click **Save and Deploy**

**Step 4: Update Bot Code**

In `commands/lyrics.ts`, update the Worker URL constant:

```typescript
const GENIUS_WORKER_URL = "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev";
```

**Step 5: Test**

```bash
curl "https://YOUR-WORKER.workers.dev?url=https://genius.com/Rick-astley-never-gonna-give-you-up-lyrics"
```

### Lyrics Flow

```
/lyrics → Genius API (search) → Selection Menu → Cloudflare Worker → Lyrics
                                                        ↓ (if fails)
                                               LRCLIB/lyrics.ovh/Netease
```

### Lyrics Sources Priority

| Source | Quality | Romanized Anime | Notes |
|--------|---------|-----------------|-------|
| Genius (Worker) | ⭐⭐⭐ | ✅ Yes | Best quality, all languages |
| LRCLIB | ⭐⭐ | ❌ No | Good for popular songs |
| lyrics.ovh | ⭐⭐ | ❌ No | Western music mostly |
| Netease | ⭐ | ❌ No | Asian music, original only |

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
    remoteCipher:
      url: "http://localhost:8001"
      password: "YOUR_CIPHER_TOKEN"
      userAgent: "evobot"

logging:
  level:
    root: INFO
    lavalink: INFO
```

> **Note**: The `remoteCipher` configuration requires running yt-cipher locally. See [YouTube Cipher Server Setup](#youtube-cipher-server-setup-yt-cipher) below.

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

## YouTube Cipher Server Setup (yt-cipher)

YouTube blocks datacenter IPs, causing 403 errors when using public cipher servers like `yt-cipher.onrender.com`. Running your own yt-cipher server locally solves this problem.

### Option 1: Local yt-cipher with Docker (Recommended)

**Step 1: Install Docker**

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
```

**Step 2: Create yt-cipher directory and config**

```bash
mkdir -p ~/yt-cipher && cd ~/yt-cipher

cat > docker-compose.yml << 'EOF'
services:
  yt-cipher:
    image: ghcr.io/kikkia/yt-cipher:master
    container_name: yt-cipher
    restart: unless-stopped
    environment:
      - API_TOKEN=YOUR_CIPHER_TOKEN
      - PORT=8001
      - HOST=0.0.0.0
    ports:
      - "127.0.0.1:8001:8001"
EOF
```

**Step 3: Start yt-cipher**

```bash
cd ~/yt-cipher
sudo docker compose up -d

# Verify it's running
sudo docker ps
sudo docker logs yt-cipher
```

**Step 4: Test yt-cipher**

```bash
curl -X POST http://localhost:8001/decrypt_signature \
  -H "Authorization: YOUR_CIPHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"signature": "test"}'
```

**Step 5: Update Lavalink application.yml**

```yaml
plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - MUSIC
      - WEB
    remoteCipher:
      url: "http://localhost:8001"
      password: "YOUR_CIPHER_TOKEN"
      userAgent: "evobot"
```

**Step 6: Restart Lavalink**

```bash
pm2 restart lavalink
pm2 logs lavalink --lines 30
```

### Option 2: Use Public Cipher Server (Quick Alternative)

If you don't want to run Docker, use Kikkia's public server:

```yaml
plugins:
  youtube:
    enabled: true
    allowSearch: true
    clients:
      - MUSIC
      - WEB
    remoteCipher:
      url: "https://cipher.kikkia.dev/"
      userAgent: "evobot"
```

> **Note**: Public servers may have rate limits or downtime. Local setup is more reliable for production.

### yt-cipher Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `API_TOKEN` | Authentication token | None |
| `PORT` | Server port | 8001 |
| `HOST` | Bind address | 0.0.0.0 |
| `MAX_THREADS` | Worker threads | CPU cores |
| `PREPROCESSED_CACHE_SIZE` | Script cache size | 150 |

### yt-cipher Troubleshooting

**yt-cipher not responding:**
```bash
sudo docker logs yt-cipher
sudo docker restart yt-cipher
```

**Lavalink can't connect to yt-cipher:**
- Verify port 8001 is accessible: `curl http://localhost:8001`
- Check token matches in both configs
- Ensure yt-cipher started before Lavalink

**Still getting 403 errors:**
- Check Lavalink logs: `pm2 logs lavalink`
- Verify `remoteCipher` (not `cipher.resolverUrl`) in application.yml
- Try different YouTube clients in config

---

## IPv6 Rotation with Tunnelbroker (YouTube IP Blocking Solution)

YouTube blocks datacenter IPs, causing "This video requires login" errors even with a working cipher server. IPv6 rotation solves this by obtaining a /48 block (281 trillion IPs) that YouTube cannot block entirely.

### Understanding the Problem

There are two separate issues with YouTube on VPS:
1. **Cipher decryption** - Solved with yt-cipher (see above)
2. **IP blocking** - YouTube rejects datacenter IPs → Solved with IPv6 rotation

### Prerequisites

- VPS with a **pingable public IPv4** address
- Ubuntu 20.04+ or Debian 11+
- Root access

### Step 1: Create Tunnelbroker Account

1. Go to https://tunnelbroker.net/ (Hurricane Electric, free service)
2. Create an account
3. Click "Create Regular Tunnel"
4. Enter your VPS public IPv4 address
5. Select the nearest server (lowest ping)

> **Important**: Your VPS IPv4 must respond to ping from the internet. Some providers block ICMP by default.

### Step 2: Request /48 Block

1. In your tunnel's configuration page, click "Assign /48"
2. Note down these values:
   - **Server IPv4 Address**: The HE server IP
   - **Client IPv4 Address**: Your VPS IP
   - **Routed /48**: Your IPv6 block (e.g., `2001:470:xxxx::/48`)

### Step 3: Configure the Tunnel on VPS

```bash
# Enable non-local IPv6 binding (required for rotation)
sudo sysctl -w net.ipv6.ip_nonlocal_bind=1
echo 'net.ipv6.ip_nonlocal_bind = 1' | sudo tee -a /etc/sysctl.conf

# Create tunnel interface (replace with your Tunnelbroker values)
sudo ip tunnel add he-ipv6 mode sit remote SERVER_IPV4 local CLIENT_IPV4 ttl 255
sudo ip link set he-ipv6 up
sudo ip addr add CLIENT_IPV6::2/64 dev he-ipv6
sudo ip route add ::/0 dev he-ipv6

# Enable the /48 block for local routing
sudo ip -6 route replace local YOUR_ROUTED_48::/48 dev lo
```

**Example with real values:**
```bash
# If Tunnelbroker gave you:
# Server IPv4: 216.66.80.30
# Client IPv4: 203.0.113.50
# Client IPv6: 2001:470:1f0e:abc::2/64
# Routed /48: 2001:470:abcd::/48

sudo ip tunnel add he-ipv6 mode sit remote 216.66.80.30 local 203.0.113.50 ttl 255
sudo ip link set he-ipv6 up
sudo ip addr add 2001:470:1f0e:abc::2/64 dev he-ipv6
sudo ip route add ::/0 dev he-ipv6
sudo ip -6 route replace local 2001:470:abcd::/48 dev lo
```

### Step 4: Verify IPv6 Connectivity

```bash
# Test IPv6 connectivity
ping6 -c 4 google.com

# Verify your IPv6 address
curl -6 https://ifconfig.co
```

Both commands should work and show a Tunnelbroker IPv6 address.

### Step 5: Update Lavalink Configuration

Edit `~/lavalink/application.yml` to add the `ratelimit` section:

```yaml
server:
  port: 2333
  address: 0.0.0.0

lavalink:
  plugins:
    - dependency: dev.lavalink.youtube:youtube-plugin:1.17.0
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
    ratelimit:
      ipBlocks: ["2001:470:abcd::/48"]  # Your /48 block
      excludedIps: []
      strategy: "RotatingNanoSwitch"
      searchTriggersFail: true
      retryLimit: -1

plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - MUSIC
      - WEB
    remoteCipher:
      url: "http://localhost:8001"
      password: "YOUR_CIPHER_TOKEN"
      userAgent: "evobot"

logging:
  level:
    root: INFO
    lavalink: INFO
```

### Step 6: Restart Services

```bash
pm2 restart lavalink
pm2 logs lavalink --lines 30

# Test with the bot
pm2 restart evobot
```

### Rotation Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `RotateOnBan` | Changes IP only when banned | Low traffic bots |
| `LoadBalance` | Distributes across all IPs | Multiple simultaneous streams |
| `NanoSwitch` | Changes IP every request | Maximum anonymity |
| `RotatingNanoSwitch` | Rotates sequentially | **Recommended** - best balance |

### Persist Tunnel on Reboot

Create a startup script:

```bash
cat > ~/lavalink/setup-tunnel.sh << 'EOF'
#!/bin/bash
# Replace these values with your Tunnelbroker configuration
SERVER_IPV4="216.66.80.30"
CLIENT_IPV4="203.0.113.50"
CLIENT_IPV6="2001:470:1f0e:abc::2/64"
ROUTED_48="2001:470:abcd::/48"

ip tunnel add he-ipv6 mode sit remote $SERVER_IPV4 local $CLIENT_IPV4 ttl 255
ip link set he-ipv6 up
ip addr add $CLIENT_IPV6 dev he-ipv6
ip route add ::/0 dev he-ipv6
ip -6 route replace local $ROUTED_48 dev lo
EOF

chmod +x ~/lavalink/setup-tunnel.sh
```

Add to system startup:

```bash
# Add to /etc/rc.local (before 'exit 0')
sudo nano /etc/rc.local
# Add line: /root/lavalink/setup-tunnel.sh

# Or create systemd service
sudo tee /etc/systemd/system/he-tunnel.service << 'EOF'
[Unit]
Description=Hurricane Electric IPv6 Tunnel
After=network.target

[Service]
Type=oneshot
ExecStart=/root/lavalink/setup-tunnel.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable he-tunnel
sudo systemctl start he-tunnel
```

### IPv6 Troubleshooting

**IPv6 not working / ping6 fails:**
- Verify VPS IPv4 is pingable from internet
- Check Tunnelbroker tunnel status page
- Review tunnel values match exactly
- Run `ip -6 route show` to check routes

**Lavalink not using IPv6:**
- If using Docker for Lavalink, add `network_mode: host`
- Verify `net.ipv6.ip_nonlocal_bind=1` is active: `sysctl net.ipv6.ip_nonlocal_bind`
- Check Lavalink logs for IPv6 errors: `pm2 logs lavalink`

**Still getting "login required" errors:**
- Use /48 block, not /64 (larger blocks are harder to ban)
- Try `RotatingNanoSwitch` strategy
- Verify `ratelimit` section is inside `lavalink.server`, not at root level
- Check cipher server is also working: `curl http://localhost:8001`

### Alternative Solutions

If Tunnelbroker doesn't work for your VPS:

| Solution | Description | Notes |
|----------|-------------|-------|
| HTTP Proxy | Configure `httpConfig` in Lavalink with residential proxy | Requires paid proxy service |
| LavaSrc | Use Spotify/Deezer instead of YouTube | Requires premium credentials |
| Different VPS | Use residential IP VPS provider | More expensive |

---

## Troubleshooting

### Bot doesn't connect to Lavalink
- Check Lavalink is running: `pm2 status`
- Check Lavalink logs: `pm2 logs lavalink`
- Verify password matches in both configs
- Wait 10-15 seconds after Lavalink starts

### YouTube not working
- Ensure youtube-plugin is configured in application.yml
- Check cipher server is reachable: `curl http://localhost:8001`
- View Lavalink logs for errors: `pm2 logs lavalink`
- If getting 403 errors, set up local yt-cipher (see [YouTube Cipher Server Setup](#youtube-cipher-server-setup-yt-cipher))
- Verify using `remoteCipher` config (not the old `cipher.resolverUrl` format)

### Lyrics not found
- Try manual search: `/lyrics search:song name`
- Add Genius API key for more results
- Some songs may not be on Genius

### Bot crashes on command
- Check logs: `pm2 logs evobot`
- Ensure all dependencies installed: `npm install`
- Rebuild: `npm run build`
