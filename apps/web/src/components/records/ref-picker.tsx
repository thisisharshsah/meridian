"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { useLookup } from "@/lib/queries";
import { get } from "@/lib/api";
import { entityPath } from "@/lib/meta";
import { cn } from "@/lib/utils";

/**
 * Searchable picker for a reference field. It fetches `{id, label}` pairs from
 * the lookup endpoint rather than whole records, and resolves the current
 * value's label separately so an existing selection shows a name even when it
 * falls outside the first page of results.
 */
export function RefPicker({
  id,
  entity,
  value,
  onChange,
  invalid,
  label,
  describedBy,
}: {
  id?: string;
  entity: string;
  value: string | null;
  onChange: (v: string | null) => void;
  invalid?: boolean;
  describedBy?: string;
  /** The `<field>__label` the record already carries, when there is one. */
  label?: string | null;
}) {
  const lookupLabel = entity.split(".").pop()?.replace(/_/g, " ") ?? "records";
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);

  const { data, isFetching } = useLookup(open ? entity : undefined, term);

  React.useEffect(() => {
    let cancelled = false;
    if (!value) {
      setSelectedLabel(null);
      return;
    }
    // Prefer the label the caller already has. Re-deriving it with a GET on the
    // referenced entity is permission-checked against *that* entity, so an
    // owner field (which points at `core.users`, a read-only view most roles
    // cannot list) came back 403 and rendered as "Unknown".
    if (label) {
      setSelectedLabel(label);
      return;
    }
    get<Record<string, unknown>>(`e/${entity}/${value}`)
      .then((r) => {
        if (cancelled) return;
        // The lookup endpoint reports the title field, so mirror it here.
        const label = (r["name"] ?? r["full_name"] ?? r["subject"] ?? r["number"] ?? r["title"]) as string;
        setSelectedLabel(label ?? "Selected");
      })
      .catch(() => !cancelled && setSelectedLabel("Unknown"));
    return () => {
      cancelled = true;
    };
  }, [entity, value, label]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Clear sits beside the trigger, not inside it. A button nested in a
          button is invalid markup, and this one carried tabIndex={-1}, so the
          only way to unset a reference was with a mouse. */}
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className={cn(
              "flex h-8.5 w-full items-center justify-between gap-2 rounded-md border bg-surface py-1 pl-2.5 text-left text-sm shadow-xs transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand",
              value ? "pr-14" : "pr-8",
              invalid ? "border-danger" : "border-border",
            )}
          >
            <span className={cn("truncate", !value && "text-subtle-foreground")}>
              {value ? (selectedLabel ?? "…") : "Select…"}
            </span>
          </button>
        </PopoverTrigger>

        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 opacity-50"
          aria-hidden="true"
        />

        {value && (
          <button
            type="button"
            aria-label={`Clear ${selectedLabel ?? label ?? "selection"}`}
            onClick={() => onChange(null)}
            className="absolute right-7 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search…"
          className="h-9 w-full border-b border-border bg-transparent px-2.5 text-sm outline-none placeholder:text-subtle-foreground"
        />
        <div className="max-h-56 overflow-y-auto p-1 scrollbar-thin">
          {isFetching && !data && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Searching…</p>
          )}
          {data?.data.length === 0 && (
            // On a fresh workspace this list is empty for every required
            // reference, so "No matches." is a dead end: the field cannot be
            // filled and the form cannot be submitted. Say where the missing
            // thing is created rather than only reporting its absence.
            <div className="px-2 py-3 text-center">
              <p className="text-xs text-muted-foreground">
                {term ? `Nothing matches “${term}”.` : `You have no ${lookupLabel} yet.`}
              </p>
              <Link
                href={entityPath(entity)}
                className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
              >
                Add {term ? "one" : `your first ${lookupLabel}`} first →
              </Link>
            </div>
          )}
          {data?.data.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setSelectedLabel(o.label);
                setOpen(false);
                setTerm("");
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
            >
              <span className="flex-1 truncate">{o.label || "Untitled"}</span>
              {o.id === value && <Check className="size-3.5 text-brand" />}
            </button>
          ))}
          {data && data.total > data.data.length && (
            <p className="px-2 py-1.5 text-center text-[11px] text-subtle-foreground">
              Showing {data.data.length} of {data.total}. Keep typing to narrow.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
