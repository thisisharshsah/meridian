"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { useStats } from "@/lib/queries";

/**
 * A text field that offers what this workspace already uses, while still
 * accepting anything typed. Free text is how one category becomes "Hardware",
 * "hardware" and "HW" -- three buckets for one thing, and a report that
 * silently undercounts all three.
 *
 * The suggestions come from the stats endpoint's group_by, which already
 * returns distinct values for any field and is scoped to the tenant and gated
 * on view permission, so this needs no new endpoint and can never surface a
 * value the user is not allowed to see.
 *
 * A native <datalist> deliberately, rather than a custom popup: it types and
 * filters like the platform, it does not fight the mobile keyboard, and it
 * degrades to a plain text box if anything about it is unsupported.
 */
export function SuggestInput({
  id,
  entity,
  field,
  value,
  onChange,
  invalid,
  autoFocus,
  describedBy,
  placeholder,
}: {
  id: string;
  entity: string;
  field: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const { data } = useStats(entity, { group_by: field });

  const options = React.useMemo(() => {
    const seen = new Set<string>();
    for (const row of data?.data ?? []) {
      const v = row.bucket;
      if (typeof v === "string" && v.trim()) seen.add(v);
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).slice(0, 50);
  }, [data]);

  const listId = `${id}-suggestions`;

  return (
    <>
      <Input
        id={id}
        type="text"
        list={options.length ? listId : undefined}
        autoFocus={autoFocus}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {options.length > 0 && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
}
