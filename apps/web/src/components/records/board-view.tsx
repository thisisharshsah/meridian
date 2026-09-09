"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Plus } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge, toneOf } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { RecordForm } from "@/components/records/record-form";
import { ApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { entityPath, optionsOf, type EntityMeta, type FieldDef } from "@/lib/meta";
import { useList, useSession, useUpdate, type Record_ } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { LoadError } from "@/components/records/load-error";

/**
 * Board view for any entity with a select field to group by — deals by stage,
 * tickets by status, candidates by hiring stage. Dragging a card PATCHes that
 * one field, so the server's rules (and its audit log) apply exactly as they
 * would from the form.
 */
export function BoardView({ meta, groupField }: { meta: EntityMeta; groupField: FieldDef }) {
  const { data: session } = useSession();
  const currency = session?.organization?.currency ?? "USD";

  // A board is only readable at a size a person can scan; beyond that the
  // table view is the honest tool, so say so rather than truncating silently.
  const { data, isLoading, isError, error, refetch } = useList(meta.key, {
    per_page: 200,
    sort: `-${amountField(meta) ?? "created_at"}`,
  });
  const update = useUpdate(meta.key);

  const [dragging, setDragging] = React.useState<Record_ | null>(null);
  const [creatingIn, setCreatingIn] = React.useState<string | null>(null);
  const [optimistic, setOptimistic] = React.useState<Record<string, string>>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const columns = optionsOf(groupField);
  const records = data?.data ?? [];
  const valueOf = (r: Record_) => optimistic[r.id] ?? (r[groupField.name] as string);

  const onDragStart = (e: DragStartEvent) => {
    setDragging(records.find((r) => r.id === e.active.id) ?? null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const id = String(e.active.id);
    const target = e.over?.id ? String(e.over.id) : null;
    const record = records.find((r) => r.id === id);
    if (!record || !target || valueOf(record) === target) return;

    // Move the card immediately, then let the server have the last word.
    setOptimistic((s) => ({ ...s, [id]: target }));
    const clear = () =>
      setOptimistic((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });

    try {
      await update.mutateAsync({ id, body: { [groupField.name]: target } });
      // Clear on success too. Keeping the override forever means a rule that
      // moved the record somewhere else — or another person's edit — is
      // invisible here, and the card sits in a column it is not in.
      clear();
    } catch (err) {
      clear();
      toast.error(err instanceof ApiError ? err.message : "Could not move that card");
    }
  };

  // Before the empty state, not after it: a board that failed to load must not
  // tell someone with a full pipeline that they have no deals.
  if (isError) {
    return <LoadError what={meta.label_plural.toLowerCase()} error={error} onRetry={() => refetch()} />;
  }

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-96 w-64 shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <>
      {data && data.total > records.length && (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing the {records.length} most recent of {data.total.toLocaleString()}. Switch to the
          table for the full set.
        </p>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin">
          {columns.map((col) => {
            const cards = records.filter((r) => valueOf(r) === col.value);
            const sum = cards.reduce((s, r) => s + ((r[amountField(meta) ?? ""] as number) ?? 0), 0);
            return (
              <Column
                key={col.value}
                id={col.value}
                label={col.label}
                tone={col.tone}
                count={cards.length}
                sum={amountField(meta) ? formatMoney(sum, currency, { compact: true }) : null}
                onAdd={meta.permissions.create ? () => setCreatingIn(col.value) : undefined}
              >
                {cards.map((r) => (
                  <Card key={r.id} record={r} meta={meta} currency={currency} />
                ))}
              </Column>
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging && (
            <div className="w-64 rotate-2 opacity-90">
              <CardBody record={dragging} meta={meta} currency={currency} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <RecordForm
        meta={meta}
        open={!!creatingIn}
        onOpenChange={(v) => !v && setCreatingIn(null)}
        defaults={creatingIn ? { [groupField.name]: creatingIn } : undefined}
      />
    </>
  );
}

function Column({
  id, label, tone, count, sum, onAdd, children,
}: {
  id: string;
  label: string;
  tone: string;
  count: number;
  sum: string | null;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Badge tone={toneOf(tone)} dot>
          {label}
        </Badge>
        <span className="text-xs text-subtle-foreground">{count}</span>
        {sum && <span className="ml-auto text-xs font-medium tnum">{sum}</span>}
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[24rem] flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors",
          isOver ? "border-brand bg-brand-subtle/40" : "border-border bg-surface-muted/50",
        )}
      >
        {children}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-subtle-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <Plus className="size-3" />
            Add
          </button>
        )}
      </div>
    </div>
  );
}

function Card({ record, meta, currency }: { record: Record_; meta: EntityMeta; currency: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: record.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody record={record} meta={meta} currency={currency} handle={{ ...attributes, ...listeners }} />
    </div>
  );
}

function CardBody({
  record, meta, currency, handle,
}: {
  record: Record_;
  meta: EntityMeta;
  currency: string;
  handle?: Record<string, unknown>;
}) {
  const amount = amountField(meta);
  const dateField = ["closing_date", "due_date", "due_at", "target_date"].find((f) =>
    meta.fields.some((x) => x.name === f),
  );
  const ownerField = ["owner_id", "assignee_id"].find((f) => meta.fields.some((x) => x.name === f));
  const parentField = ["account_id", "job_opening_id", "project_id"].find((f) =>
    meta.fields.some((x) => x.name === f),
  );

  return (
    <article className="rounded-md border border-border bg-surface p-2.5 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-1.5">
        <span
          {...(handle ?? {})}
          className="mt-0.5 cursor-grab touch-none text-subtle-foreground active:cursor-grabbing"
          aria-label="Drag"
        >
          <GripVertical className="size-3.5" />
        </span>
        <Link
          href={`${entityPath(meta.key)}/${record.id}`}
          className="min-w-0 flex-1 text-sm font-medium leading-snug hover:text-brand"
        >
          {String(record[meta.title_field] ?? "Untitled")}
        </Link>
      </div>

      {parentField && record[`${parentField}__label`] ? (
        <p className="mt-1 truncate pl-5 text-xs text-muted-foreground">
          {String(record[`${parentField}__label`])}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2 pl-5">
        {amount && (
          <span className="text-sm font-semibold tnum">
            {formatMoney(record[amount] as number, currency, { compact: true })}
          </span>
        )}
        {dateField && record[dateField] ? (
          <span className="text-xs text-subtle-foreground">
            {formatDate(String(record[dateField]))}
          </span>
        ) : null}
        {ownerField && record[`${ownerField}__label`] ? (
          <Avatar name={String(record[`${ownerField}__label`])} size="xs" className="ml-auto" />
        ) : null}
      </div>
    </article>
  );
}

/** The money column worth showing on a card, if the entity has one. */
function amountField(meta: EntityMeta): string | null {
  return ["amount", "total", "expected_salary", "budget"].find((n) =>
    meta.fields.some((f) => f.name === n && f.kind.type === "money"),
  ) ?? null;
}

/** The select field a board should group by, if any. */
export function boardFieldFor(meta: EntityMeta): FieldDef | null {
  const preferred = ["stage", "status"];
  for (const name of preferred) {
    const f = meta.fields.find((x) => x.name === name && x.kind.type === "select");
    if (f && optionsOf(f).length >= 2 && optionsOf(f).length <= 8) return f;
  }
  return null;
}
