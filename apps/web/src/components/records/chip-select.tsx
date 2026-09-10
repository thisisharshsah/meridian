"use client";

import * as React from "react";
import { Check, X } from "lucide-react";

import { badgeVariants, toneOf } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SelectOption } from "@/lib/meta";
import { t } from "@/lib/i18n";

/**
 * A short option list laid out as chips rather than hidden behind a dropdown.
 * Picking a stage or a status is one tap instead of open-scroll-tap-close, and
 * on a phone it replaces a native picker sheet that covers the whole form. It
 * also shows every choice at once, which matters when the reader does not yet
 * know what the choices are.
 *
 * Built on real radio inputs: keyboard support, arrow-key movement within the
 * group and screen-reader semantics all come from the platform rather than
 * being re-implemented with click handlers and aria attributes.
 *
 * The selected chip uses the same tone the value is given everywhere else, so
 * a deal that shows a green "Won" badge in the list shows a green "Won" chip
 * in the form.
 */
export function ChipSelect({
  id,
  options,
  value,
  onChange,
  invalid,
  required,
  describedBy,
}: {
  id: string;
  options: SelectOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  invalid?: boolean;
  required?: boolean;
  describedBy?: string;
}) {
  const base =
    "inline-flex min-h-8 max-md:min-h-10 cursor-pointer select-none items-center rounded-full border px-2.5 text-xs font-medium transition-colors " +
    "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-brand";

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", invalid && "rounded-md outline-1 outline-danger")}
      aria-describedby={describedBy}
    >
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <label key={o.value} className="contents">
            <input
              type="radio"
              // The first radio carries the field id so FieldRow's <label> has
              // something real to focus when it is clicked.
              id={i === 0 ? id : undefined}
              name={id}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              aria-invalid={invalid}
              className="peer sr-only"
            />
            <span
              className={cn(
                base,
                on
                  ? cn(
                      badgeVariants({ tone: toneOf(o.tone) }),
                      // A tick, not just colour. Roughly a third of the option
                      // tones in the schema are "neutral", and a neutral chip
                      // tinted against an untinted one is nearly the same chip:
                      // on a real screen you cannot tell which is chosen.
                      "gap-1 px-2.5 font-semibold ring-1 ring-inset ring-current/30",
                    )
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {on && <Check className="size-3 shrink-0" aria-hidden="true" />}
              {o.label}
            </span>
          </label>
        );
      })}

      {/* Without this an optional field can be set but never unset: a radio
          group has no way back to "none" once one has been chosen. */}
      {!required && value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex min-h-8 max-md:min-h-10 items-center gap-1 rounded-full px-2 text-xs text-subtle-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3" aria-hidden="true" />
          {t("action.clear")}
        </button>
      )}
    </div>
  );
}
