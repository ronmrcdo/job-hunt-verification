// Output safety (spec §9.5): a suspicious URL is shown as inert text, never
// as a live hyperlink. This neutralizes the scheme and dots so the string
// can't be pasted/clicked into a live link by accident.
export function defang(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replaceAll(".", "[.]");
    return url
      .replace(u.protocol, u.protocol === "https:" ? "hxxps:" : "hxxp:")
      .replace(u.hostname, host);
  } catch {
    return url;
  }
}
