import { defang } from "../../lib/defang";

export interface DefangedTextProps {
  value: string;
}

/**
 * Renders a URL as inert, defanged text. Never renders a link — a
 * suspicious URL must not become a clickable `<a href>` anywhere in the
 * UI (product rule #4 / spec §9.5).
 */
export function DefangedText({ value }: DefangedTextProps) {
  return <span>{defang(value)}</span>;
}
