// Export this file from Daily Dashboard → Settings → Music to pair it with your installation.
// Install with Spicetify. The original template contains no usable pairing credential.
(async function dailyDashboardBridge() {
  const token = "__DASHBOARD_PAIRING_TOKEN__";
  if (token.startsWith("__")) return;
  if (globalThis.__dailyDashboardBridge) return;
  globalThis.__dailyDashboardBridge = true;
  const endpoint = "http://127.0.0.1:47691/poll";
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  while (!globalThis.Spicetify?.Player?.data) await wait(1000);
  const player = Spicetify.Player;
  const processed = new Set();
  let acknowledgements = [];
  const supports = name => typeof player[name] === "function";
  const safe = (name, fallback) => { try { return supports(name) ? player[name]() : fallback; } catch { return fallback; } };
  const currentUri = () => player.data?.item?.uri || player.data?.track?.uri || "";
  function snapshot() {
    const item = player.data?.item || player.data?.track;
    const metadata = item?.metadata || {};
    const uri = currentUri();
    let artworkUrl = metadata.image_xlarge_url || metadata.image_large_url || metadata.image_url || "";
    if (artworkUrl.startsWith("spotify:image:")) artworkUrl = "https://i.scdn.co/image/" + artworkUrl.slice(14);
    const validTrack = /^spotify:(track|episode):[A-Za-z0-9]{22}$/.test(uri);
    const restrictions = player.data?.restrictions || {};
    const allowed = key => !restrictions[key]?.length;
    return {
      title: metadata.title || item?.name || "", artist: metadata.artist_name || "", album: metadata.album_title || "", uri, artworkUrl,
      durationMs: Math.max(0, Math.round(safe("getDuration", 0))), progressMs: Math.max(0, Math.round(safe("getProgress", 0))),
      isPlaying: Boolean(safe("isPlaying", false)), volumePercent: Math.round(safe("getVolume", 0) * 100),
      shuffle: safe("getShuffle", null), repeat: safe("getRepeat", null), liked: safe("getHeart", null),
      status: "Local Spotify · Connected",
      controls: {
        toggle: supports("play") && supports("pause"), previous: supports("back") && allowed("disallow_skipping_prev_reasons"), next: supports("next") && allowed("disallow_skipping_next_reasons"),
        seek: validTrack && supports("seek") && allowed("disallow_seeking_reasons"), volume: supports("setVolume"),
        shuffle: supports("setShuffle") && allowed("disallow_toggling_shuffle_reasons"), repeat: supports("setRepeat"), save: validTrack && supports("setHeart") && supports("getHeart"),
      },
    };
  }
  async function execute(command) {
    if (processed.has(command.id)) return {id: command.id, ok: false, error: "Duplicate command ignored"};
    processed.add(command.id); if (processed.size > 256) processed.delete(processed.values().next().value);
    try {
      if (Date.now() > command.expiresAt) throw Error("Command expired");
      const state = snapshot();
      if (!state.controls[command.action]) throw Error("Spotify does not support this action right now");
      if (["save", "seek"].includes(command.action) && command.expectedUri !== currentUri()) throw Error("Track changed; try again");
      const value = command.value;
      switch (command.action) {
        case "toggle": await (value === 1 ? player.play() : player.pause()); break;
        case "previous": await player.back(); break;
        case "next": await player.next(); break;
        case "seek": await player.seek(Math.min(state.durationMs, Math.max(0, value))); break;
        case "volume": await player.setVolume(Math.max(0, Math.min(1, value / 100))); break;
        case "shuffle": await player.setShuffle(value === 1); break;
        case "repeat": await player.setRepeat(value); break;
        case "save": await player.setHeart(value === 1); break;
        default: throw Error("Unknown command");
      }
      // Explicit setters are checked against client state; never retry a toggle.
      const confirmed = () => {
        if (["save", "seek"].includes(command.action) && command.expectedUri !== currentUri()) throw Error("Track changed before confirmation");
        switch (command.action) {
          case "toggle": return safe("isPlaying", null) === (value === 1);
          case "shuffle": return safe("getShuffle", null) === (value === 1);
          case "repeat": return safe("getRepeat", null) === value;
          case "save": return safe("getHeart", null) === (value === 1);
          case "volume": return Math.abs(safe("getVolume", -10) * 100 - value) < 2;
          case "seek": return Math.abs(safe("getProgress", -10000) - Math.min(state.durationMs, value)) < 2000;
          default: return true;
        }
      };
      const deadline = Math.min(command.expiresAt, Date.now() + 1800);
      while (!confirmed()) { if (Date.now() > deadline) throw Error("Spotify did not confirm the change"); await wait(100); }
      return {id: command.id, ok: true};
    } catch (error) { return {id: command.id, ok: false, error: String(error.message || error)}; }
  }
  for (;;) {
    try {
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({token, snapshot: snapshot(), acknowledgements}), signal: AbortSignal.timeout(2500)});
      if (!response.ok) throw Error("Bridge unavailable");
      acknowledgements = [];
      const payload = await response.json();
      for (const command of payload.commands || []) acknowledgements.push(await execute(command));
      await wait(500);
    } catch { await wait(2000); }
  }
})();
