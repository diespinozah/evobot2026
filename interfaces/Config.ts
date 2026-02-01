export interface Config {
  TOKEN: string;
  MAX_PLAYLIST_SIZE: number;
  PRUNING: boolean;
  STAY_TIME: number;
  DEFAULT_VOLUME: number;
  LOCALE: string;
  LAVALINK_HOST?: string;
  LAVALINK_PORT?: number;
  LAVALINK_PASSWORD?: string;
  LAVALINK_SECURE?: boolean;
  GENIUS_API_KEY?: string;
}
