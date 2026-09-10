"use client";

import * as React from "react";

import { Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefPicker } from "@/components/records/ref-picker";
import { ChipSelect } from "@/components/records/chip-select";
import { SuggestInput } from "@/components/records/suggest-input";
import { optionsOf, type FieldDef } from "@/lib/meta";
import { moneyToInput, percentToInput, qtyToInput } from "@/lib/format";
import { t } from "@/lib/i18n";

export type FieldValueInput = string | number | boolean | null;

/**
 * Above this many options a chip row wraps far enough to lose its advantage.
 * Seven covers 43 of the 44 select fields in the schema, including the pickers
 * that matter most -- deal stage, candidate stage, invoice status, lead source.
 * Only the nine-option currency list, whose labels are long, keeps a dropdown.
 */
const CHIP_LIMIT = 7;

/**
 * One input per field kind. Scaled numbers (money, percent, quantity) are
 * edited as plain decimal strings and sent as strings, so the server does the
 * scaling and no float ever touches a monetary value.
 */
export function FieldInput({
  field,
  value,
  onChange,
  invalid,
  autoFocus,
  label,
  describedBy,
  entity,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: FieldValueInput) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Id of the hint or error that FieldRow rendered for this field. */
  describedBy?: string;
  /** Entity key, needed to look up what values this workspace already uses. */
  entity?: string;
  /** `<field>__label` from the record, so a ref need not re-fetch its title. */
  label?: string | null;
}) {
  const id = `field-${field.name}`;

  switch (field.kind.type) {
    case "long_text":
      return (
        <Textarea
          id={id}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          rows={4}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "bool":
      return (
        <div className="flex h-8.5 items-center">
          <Checkbox
            id={id}
            checked={!!value}
            onCheckedChange={(c) => onChange(c === true)}
            aria-invalid={invalid}
          aria-describedby={describedBy}
          />
        </div>
      );

    case "select": {
      const options = optionsOf(field);

      // Short lists become chips: every choice visible, one tap to pick, and no
      // picker sheet covering the form on a phone. 33 of the 35 select fields
      // in the schema have five options or fewer. Past that chips wrap into an
      // unreadable block and a dropdown is the better control.
      if (options.length <= CHIP_LIMIT) {
        return (
          <ChipSelect
            id={id}
            options={options}
            value={(value as string) ?? null}
            onChange={onChange}
            invalid={invalid}
            required={field.required}
            describedBy={describedBy}
          />
        );
      }

      return (
        <Select value={(value as string) ?? ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={id} aria-invalid={invalid}
          aria-describedby={describedBy}>
            <SelectValue placeholder={t("record.select")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case "ref":
      return (
        <RefPicker
          id={id}
          entity={field.kind.entity}
          value={(value as string) ?? null}
          onChange={onChange}
          invalid={invalid}
          describedBy={describedBy}
          label={label}
        />
      );

    case "money":
      return (
        <NumericInput
          id={id}
          autoFocus={autoFocus}
          invalid={invalid}
          initial={typeof value === "string" ? value : moneyToInput(value as number)}
          onChange={onChange}
          describedBy={describedBy}
          placeholder="0.00"
        />
      );

    case "percent":
      return (
        <NumericInput
          id={id}
          autoFocus={autoFocus}
          invalid={invalid}
          initial={typeof value === "string" ? value : percentToInput(value as number)}
          onChange={onChange}
          describedBy={describedBy}
          placeholder="0"
          suffix="%"
        />
      );

    case "quantity":
      return (
        <NumericInput
          id={id}
          autoFocus={autoFocus}
          invalid={invalid}
          initial={typeof value === "string" ? value : qtyToInput(value as number)}
          onChange={onChange}
          describedBy={describedBy}
          placeholder="1"
        />
      );

    case "int":
      return (
        <Input
          id={id}
          type="number"
          step="1"
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={((value as string) ?? "").slice(0, 10)}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case "date_time":
      return (
        <Input
          id={id}
          type="datetime-local"
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={toLocalInput(value as string | null)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );

    default:
      // A field the schema marks as a small reusable vocabulary offers what is
      // already in use, so the same thing is not filed three different ways.
      if (field.suggest && entity) {
        return (
          <SuggestInput
            id={id}
            entity={entity}
            field={field.name}
            value={(value as string) ?? ""}
            onChange={onChange}
            invalid={invalid}
            autoFocus={autoFocus}
            describedBy={describedBy}
          />
        );
      }

      return (
        <Input
          id={id}
          type={field.kind.type === "email" ? "email" : field.kind.type === "url" ? "url" : "text"}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.kind.type === "url" ? "https://" : undefined}
        />
      );
  }
}

/**
 * Decimal entry that keeps exactly what was typed while the field has focus.
 * Reformatting mid-keystroke is what makes "1.0" impossible to type.
 */
function NumericInput({
  id,
  initial,
  onChange,
  invalid,
  autoFocus,
  placeholder,
  suffix,
  describedBy,
}: {
  id: string;
  initial: string;
  onChange: (v: string | null) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
  placeholder?: string;
  suffix?: string;
}) {
  const [text, setText] = React.useState(initial);
  const [focused, setFocused] = React.useState(false);

  React.useEffect(() => {
    if (!focused) setText(initial);
  }, [initial, focused]);

  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        value={text}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value;
          // Only ever accept something that could become a decimal.
          if (v !== "" && !/^-?\d*\.?\d*$/.test(v)) return;
          setText(v);
          onChange(v === "" || v === "-" ? null : v);
        }}
        className={cnInput(invalid, !!suffix)}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function cnInput(invalid?: boolean, hasSuffix?: boolean) {
  return [
    "flex h-8.5 w-full rounded-md border bg-surface px-2.5 py-1 text-sm tnum shadow-xs transition-colors",
    "placeholder:text-subtle-foreground",
    "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand focus-visible:border-brand",
    invalid ? "border-danger" : "border-border",
    hasSuffix ? "pr-7" : "",
  ].join(" ");
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
