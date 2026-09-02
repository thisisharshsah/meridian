"use client";

import { FilePlus2, PencilLine, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { relativeTime } from "@/lib/format";
import { useAuditTrail, type AuditEvent } from "@/lib/queries";
import type { EntityMeta } from "@/lib/meta";

const ICONS: Record<string, typeof PencilLine> = {
  create: FilePlus2,
  update: PencilLine,
  delete: Trash2,
};

/** Record history, read straight from the append-only audit log. */
export function Timeline({ meta, id }: { meta: EntityMeta; id: string }) {
  const { data, isLoading } = useAuditTrail(meta.key, id);

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const events = data?.data ?? [];
  if (!events.length) {
    return <EmptyState icon={PencilLine} title="Nothing yet" description="Changes to this record will appear here." />;
  }

  return (
    <ol className="relative space-y-4 p-4 pl-5">
      <span className="absolute bottom-4 left-[1.6rem] top-6 w-px bg-border" aria-hidden />
      {events.map((e) => (
        <TimelineRow key={e.id} event={e} meta={meta} />
      ))}
    </ol>
  );
}

function TimelineRow({ event, meta }: { event: AuditEvent; meta: EntityMeta }) {
  const Icon = ICONS[event.action] ?? PencilLine;
  const changes = Object.entries(event.changes ?? {});

  return (
    <li className="relative flex gap-3">
      <span className="z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
        <Icon className="size-3 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {event.summary ?? event.action}
          <span className="ml-1.5 text-xs text-subtle-foreground">{relativeTime(event.created_at)}</span>
        </p>

        {changes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            {changes.slice(0, 6).map(([field, change]) => (
              <li key={field} className="flex flex-wrap items-baseline gap-1">
                <span className="font-medium text-foreground">
                  {meta.fields.find((f) => f.name === field)?.label ?? field}
                </span>
                <span className="line-through opacity-60">{display(change.from)}</span>
                <span>→</span>
                <span className="text-foreground">{display(change.to)}</span>
              </li>
            ))}
            {changes.length > 6 && <li>and {changes.length - 6} more…</li>}
          </ul>
        )}

        {event.user_name && (
          <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-subtle-foreground">
            <Avatar name={event.user_name} size="xs" />
            {event.user_name}
          </span>
        )}
      </div>
    </li>
  );
}

function display(v: unknown) {
  if (v === null || v === undefined || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
