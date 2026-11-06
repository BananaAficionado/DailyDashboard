export type SpotifyControlMode = 'auto' | 'local' | 'api';
export type SpotifyAction = 'previous' | 'toggle' | 'next' | 'save' | 'seek' | 'volume' | 'shuffle' | 'repeat';
export type SpotifyControls = Record<SpotifyAction, boolean>;
export type LocalSpotifySnapshot = {
  available: boolean; provider: string; title: string; artist: string; album: string; uri: string; artworkUrl: string;
  durationMs: number; progressMs: number; isPlaying: boolean; volumePercent?: number; shuffle?: boolean; repeat?: number; liked?: boolean;
  controls: SpotifyControls; status: string;
};
export function normalizeSpotifyMode(mode: unknown): SpotifyControlMode { return mode === 'local' || mode === 'api' ? mode : 'auto'; }
export function localMediaItem(snapshot: LocalSpotifySnapshot) {
  if (!snapshot.title) return null;
  return { id: /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(snapshot.uri) ? snapshot.uri.split(':')[2] : '', uri: snapshot.uri || '',
    name: snapshot.title, type: snapshot.uri?.startsWith('spotify:episode:') ? 'episode' as const : 'track' as const,
    subtitle: snapshot.artist || '', caption: snapshot.album || '', duration_ms: Math.max(0, snapshot.durationMs),
    images: snapshot.artworkUrl ? [{ url: snapshot.artworkUrl, width: 300, height: 300 }] : [] };
}
export function localCommandValue(action: SpotifyAction, value: number | undefined, state: { is_playing: boolean; shuffle_state?: boolean; repeat_state?: number }, liked: boolean) {
  if (action === 'toggle') return state.is_playing ? 0 : 1;
  if (action === 'save') return liked ? 0 : 1;
  if (action === 'shuffle') return state.shuffle_state ? 0 : 1;
  if (action === 'repeat') return ((state.repeat_state || 0) + 1) % 3;
  return value;
}
