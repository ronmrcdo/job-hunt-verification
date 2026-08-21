// Presentational strip on the `/verify` home: the signed-in user's most
// recent checks, newest first (as `recentInvestigations` already orders
// them), each linking straight into its investigation view.
import Link from "next/link";
import type { Investigation } from "../../lib/investigations";

const STATUS_LABEL: Record<string, string> = {
  queued: "QUEUED",
  running: "RUNNING",
  done: "DONE",
  failed: "FAILED",
  deadline_exceeded: "TIMED OUT",
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.toUpperCase();
}

export function RecentChecks({ items }: { items: Investigation[] }) {
  if (items.length === 0) {
    return <p className="text-[13px] text-muted">No checks yet — run your first one above.</p>;
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="border-b border-rule first:border-t">
          <Link
            href={`/investigations/${item.id}`}
            className="flex items-center justify-between gap-4 py-3"
          >
            <span className="truncate text-[14px]">
              {item.title ?? "Untitled posting"}
            </span>
            <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              {statusLabel(item.status)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
