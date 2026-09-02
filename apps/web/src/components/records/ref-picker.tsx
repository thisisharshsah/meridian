"use client";

import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { useLookup } from "@/lib/queries";
import { get } from "@/lib/api";
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
}: {
  id?: string;
  entity: string;
  value: string | null;
  onChange: (v: string | null) => void;
  invalid?: boolean;
}) {
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
  }, [entity, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid}
          className={cn(
            "flex h-8.5 w-full items-center justify-between gap-2 rounded-md border bg-surface px-2.5 text-left text-sm shadow-xs transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand",
            invalid ? "border-danger" : "border-border",
          )}
        >
          <span className={cn("truncate", !value && "text-subtle-foreground")}>
            {value ? (selectedLabel ?? "…") : "Select…"}
          </span>
          <span className="flex items-center gap-1">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear"
                className="rounded p-0.5 text-subtle-foreground hover:bg-surface-hover hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                <X className="size-3" />
              </span>
            )}
            <ChevronDown className="size-3.5 shrink-0 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>

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
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</p>
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
