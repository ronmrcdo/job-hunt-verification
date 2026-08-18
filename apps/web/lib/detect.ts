// Classifies the landing-page scan field's input: an explicit URL, a bare
// "host.tld/path" link (no scheme), or free-text posting content.
const SCHEME_URL = /^https?:\/\//i;
const BARE_HOST_PATH = /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i;

export type DetectionState = "empty" | "link" | "text";

export function detectInput(value: string): DetectionState {
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  if (SCHEME_URL.test(trimmed) || BARE_HOST_PATH.test(trimmed)) return "link";
  return "text";
}
