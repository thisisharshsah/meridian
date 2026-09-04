"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, MoreHorizontal, Plus, Rows3, Search,
  Trash2, X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, iconFor } from "@/components/icon";
import { BoardView, boardFieldFor } from "@/components/records/board-view";
import { FieldValue } from "@/components/records/field-value";
import { RecordForm } from "@/components/records/record-form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiError } from "@/lib/api";
import { entityPath, optionsOf, type EntityMeta, type FieldDef } from "@/lib/meta";
import { useDelete, useList, useSession, type ListParams, type Record_ } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PER_PAGE = 25;

/**
 * The list screen every entity gets: search, per-field filters, sorting,
 * pagination, inline create and row actions — all generated from metadata.
 */
export function ListView({ meta, fixedFilters, embedded }: {
  meta: EntityMeta;
  fixedFilters?: ListParams;
  embedded?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const currency = session?.organization.currency ?? "USD";

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [sort, setSort] = React.useState<string>(
    `${meta.default_sort.dir === "desc" ? "-" : ""}${meta.default_sort.field}`,
  );
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Record_ | null>(null);

  // Entities with a small stage/status field also get a board. The preference
  // is per entity, so a pipeline stays a board while invoices stay a table.
  const boardField = React.useMemo(() => (embedded ? null : boardFieldFor(meta)), [meta, embedded]);
  const [view, setView] = React.useState<"table" | "board">("table");

  React.useEffect(() => {
    if (!boardField) return;
    try {
      const saved = localStorage.getItem(`suite-view-${meta.key}`);
      if (saved === "board" || saved === "table") setView(saved);
    } catch {
      /* default view is fine */
    }
  }, [boardField, meta.key]);

  const changeView = (v: "table" | "board") => {
    setView(v);
    try {
      localStorage.setItem(`suite-view-${meta.key}`, v);
    } catch {
      /* preference just will not persist */
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const columns = React.useMemo(() => meta.fields.filter((f) => f.in_list).slice(0, 8), [meta.fields]);

  // Defined once and used by both the desktop table and the phone card list, so
  // the two views can never drift on what a row is allowed to do.
  const RowActions = ({ r }: { r: Record_ }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for this ${meta.label.toLowerCase()}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(`${entityPath(meta.key)}/${r.id}`)}>
          Open
        </DropdownMenuItem>
        {meta.permissions.edit && (
          <DropdownMenuItem onSelect={() => setEditing(r)}>Edit</DropdownMenuItem>
        )}
        {meta.permissions.delete && (
          <DropdownMenuItem destructive onSelect={() => onDelete(r)}>
            <Trash2 />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const filterable = React.useMemo(
    () => meta.fields.filter((f) => f.kind.type === "select").slice(0, 3),
    [meta.fields],
  );

  const [confirming, setConfirming] = React.useState<Record_ | null>(null);

  const params: ListParams = {
    page,
    per_page: PER_PAGE,
    sort,
    q: debounced || undefined,
    ...filters,
    ...fixedFilters,
  };

  const { data, isLoading, isError, error } = useList(meta.key, params);
  const remove = useDelete(meta.key);

  const toggleSort = (f: FieldDef) => {
    if (!f.sortable) return;
    setSort((s) => (s === f.name ? `-${f.name}` : f.name));
  };

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  // The menu item now only asks; the deletion itself waits for confirmLabel.
  const onDelete = (r: Record_) => setConfirming(r);

  const confirmDelete = async () => {
    const r = confirming;
    if (!r) return;
    try {
      await remove.mutateAsync(r.id);
      setConfirming(null);
      toast.success(`${meta.label} deleted`);
    } catch {
      setConfirming(null);
      toast.error(`Could not delete this ${meta.label.toLowerCase()}`);
    }
  };

  return (
    <div className={cn(embedded ? "" : "p-5")}>
      {!embedded && (
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md bg-brand-subtle p-1.5 text-brand-subtle-foreground">
              <Icon name={meta.icon} className="size-4" />
            </span>
            <div>
              <h1 className="text-base font-semibold tracking-tight">{meta.label_plural}</h1>
              <p className="text-xs text-muted-foreground">
                {data ? `${data.total.toLocaleString()} record${data.total === 1 ? "" : "s"}` : "…"}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {boardField && (
              <div className="flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => changeView("table")}
                  aria-pressed={view === "table"}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                    view === "table" ? "bg-surface-hover font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Rows3 className="size-3.5" />
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => changeView("board")}
                  aria-pressed={view === "board"}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                    view === "board" ? "bg-surface-hover font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Columns3 className="size-3.5" />
                  Board
                </button>
              </div>
            )}

            {meta.permissions.create && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                New {meta.label.toLowerCase()}
              </Button>
            )}
          </div>
        </header>
      )}

      {boardField && view === "board" ? (
        <BoardView meta={meta} groupField={boardField} />
      ) : (
      <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${meta.label_plural.toLowerCase()}…`}
            className="pl-8"
          />
        </div>

        {filterable.map((f) => (
          <Select
            key={f.name}
            value={filters[f.name] ?? "__all"}
            onValueChange={(v) => {
              setFilters((s) => ({ ...s, [f.name]: v === "__all" ? "" : v }));
              setPage(1);
            }}
          >
            <SelectTrigger className="w-auto min-w-[9rem]">
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All {f.label.toLowerCase()}</SelectItem>
              {optionsOf(f).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {(activeFilters.length > 0 || debounced) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters({});
              setSearch("");
            }}
          >
            <X />
            Clear
          </Button>
        )}

        {embedded && meta.permissions.create && (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <Plus />
            Add
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {isError ? (
          <EmptyState
            icon={iconFor(meta.icon)}
            title={`We couldn't load your ${meta.label_plural.toLowerCase()}`}
            description={
              error instanceof ApiError && error.status === 401
                ? "Your session timed out. Sign in again and you'll come straight back here."
                : "Nothing has been lost. Check your connection and try again in a moment."
            }
          />
        ) : isLoading && !data ? (
          <div className="space-y-px p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={iconFor(meta.icon)}
            title={debounced || activeFilters.length ? "No matches" : `No ${meta.label_plural.toLowerCase()} yet`}
            description={
              debounced || activeFilters.length
                ? "Try a different search or clear the filters."
                : `Create your first ${meta.label.toLowerCase()} to get started.`
            }
            action={
              meta.permissions.create && !debounced && !activeFilters.length ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus />
                  New {meta.label.toLowerCase()}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
          {/* A six-to-eight column table cannot be read on a 390px screen, so
              below md the same rows render as cards led by the record title. */}
          <div className="hidden md:block">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {columns.map((f) => {
                  const isSorted = sort === f.name || sort === `-${f.name}`;
                  return (
                    <TH key={f.name}>
                      <button
                        type="button"
                        onClick={() => toggleSort(f)}
                        disabled={!f.sortable}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors",
                          f.sortable && "hover:text-foreground",
                          isSorted && "text-foreground",
                        )}
                      >
                        {f.label}
                        {isSorted &&
                          (sort.startsWith("-") ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUp className="size-3" />
                          ))}
                      </button>
                    </TH>
                  );
                })}
                <TH className="w-10" />
              </TR>
            </THead>
            <TBody>
              {data?.data.map((r) => (
                <TR
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`${entityPath(meta.key)}/${r.id}`)}
                >
                  {columns.map((f, i) => (
                    <TD key={f.name} className={cn("max-w-[22rem]", i === 0 && "font-medium")}>
                      {i === 0 ? (
                        <Link
                          href={`${entityPath(meta.key)}/${r.id}`}
                          className="block truncate hover:text-brand"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FieldValue field={f} record={r} currency={currency} compact />
                        </Link>
                      ) : (
                        <div className="truncate">
                          <FieldValue field={f} record={r} currency={currency} compact />
                        </div>
                      )}
                    </TD>
                  ))}
                  <TD onClick={(e) => e.stopPropagation()}>
                    <RowActions r={r} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {data?.data.map((r) => (
              <li key={r.id} className="flex items-start gap-2 p-3">
                <Link href={`${entityPath(meta.key)}/${r.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <FieldValue field={columns[0]} record={r} currency={currency} compact />
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {columns.slice(1, 4).map((f) => (
                      <span key={f.name} className="text-xs text-muted-foreground">
                        <span className="text-subtle-foreground">{f.label}: </span>
                        <FieldValue field={f} record={r} currency={currency} compact />
                      </span>
                    ))}
                  </span>
                </Link>
                <RowActions r={r} />
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {data && data.total_pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {data.page} of {data.total_pages} · {data.total.toLocaleString()} records
          </span>
          <div className="flex gap-1">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft />
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      </>
      )}

      <RecordForm
        meta={meta}
        open={creating}
        onOpenChange={setCreating}
        defaults={fixedFilters as Record<string, unknown>}
      />
      <RecordForm
        meta={meta}
        record={editing}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(v) => !v && setConfirming(null)}
        title={`Delete this ${meta.label.toLowerCase()}?`}
        description={
          <>
            <span className="font-medium text-foreground">
              {String(confirming?.[meta.title_field] ?? "Untitled")}
            </span>{" "}
            will be removed from {meta.label_plural.toLowerCase()}.
          </>
        }
        confirmLabel={`Delete ${meta.label.toLowerCase()}`}
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
