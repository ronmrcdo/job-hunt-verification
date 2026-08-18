// Per-browser owner key (spec §9.6 V0 stand-in for accounts). Each browser
// mints a random key on first use and reuses it from then on, so a given
// browser only ever owns (and can read back) the investigations it created
// itself — distinct from every other browser. Real accounts are V1.
const STORAGE_KEY = "jhv_owner_key";

export function getOwnerKey(): string {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const key = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, key);
  return key;
}
