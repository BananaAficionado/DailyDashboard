export type TokenProvider = "google" | "microsoft" | "spotify";
export type StoredToken = { accessToken: string; refreshToken?: string; expiresAt: number; scope?: string };
export const tokenKeys: Record<TokenProvider, string> = {
  google: "daily-dashboard.google-token",
  microsoft: "daily-dashboard.microsoft-token",
  spotify: "daily-dashboard.spotify-token",
};
type Bridge = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

function validToken(value: unknown): value is StoredToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<StoredToken>;
  return typeof token.accessToken === "string" && typeof token.expiresAt === "number" && Number.isFinite(token.expiresAt);
}

export async function loadStoredTokens(bridge: Bridge, legacy: LegacyStorage): Promise<Record<TokenProvider, StoredToken | null>> {
  const saved = await bridge("load_saved_tokens") as Partial<Record<TokenProvider, unknown>> | null;
  const result: Record<TokenProvider, StoredToken | null> = { google: null, microsoft: null, spotify: null };
  for (const provider of Object.keys(tokenKeys) as TokenProvider[]) {
    const current = saved?.[provider];
    if (validToken(current)) {
      result[provider] = current;
      legacy.removeItem(tokenKeys[provider]);
      continue;
    }
    const raw = legacy.getItem(tokenKeys[provider]);
    if (!raw) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { legacy.removeItem(tokenKeys[provider]); continue; }
    if (!validToken(value)) { legacy.removeItem(tokenKeys[provider]); continue; }
    await bridge("save_saved_token", { provider, token: value });
    // Remove the legacy copy only after the durable encrypted write succeeds.
    result[provider] = value;
    legacy.removeItem(tokenKeys[provider]);
  }
  return result;
}
