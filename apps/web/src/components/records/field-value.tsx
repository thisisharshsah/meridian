"use client";

import Link from "next/link";
import { Check, X } from "lucide-react";

import { Badge, toneOf } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { entityPath, optionFor, type FieldDef } from "@/lib/meta";
import { formatDate, formatDateTime, formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Renders one field for display. Every list cell and detail row goes through
 * here, so a money column looks the same everywhere in the product.
 */
export function FieldValue({
  field,
  record,
  currency,
  compact,
}: {
  field: FieldDef;
  record: Record<string, unknown>;
  currency: string;
  compact?: boolean;
}) {
  const value = record[field.name];

  if (value === null || value === undefined || value === "") {
    return <span className="text-subtle-foreground">—</span>;
  }

  switch (field.kind.type) {
    case "money":
      return <span className="tnum">{formatMoney(value as number, currency, { compact })}</span>;

    case "percent":
      return <span className="tnum">{formatPercent(value as number)}</span>;

    case "quantity":
      return <span className="tnum">{formatQuantity(value as number)}</span>;

    case "int":
      return <span className="tnum">{new Intl.NumberFormat().format(value as number)}</span>;

    case "bool":
      // A tick on its own is a shape, not an answer: it has no text for a
      // screen reader and, on a column of them, no way to tell "no" from
      // "nobody filled this in" -- the empty case above renders a dash, and so
      // did false.
      return value ? (
        <span className="inline-flex items-center gap-1 text-success-strong">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-xs">{t("value.yes")}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <X className="size-4 shrink-0" aria-hidden="true" />
          <span className="text-xs">{t("value.no")}</span>
        </span>
      );

    case "date":
      return <span>{formatDate(value as string)}</span>;

    case "date_time":
      return <span>{formatDateTime(value as string)}</span>;

    case "select": {
      const opt = optionFor(field, value);
      return (
        <Badge tone={toneOf(opt?.tone)} dot>
          {opt?.label ?? String(value)}
        </Badge>
      );
    }

    case "ref": {
      const label = (record[`${field.name}__label`] as string) ?? "—";
      const href = `${entityPath(field.kind.entity)}/${value}`;
      // Members render as an avatar chip: an owner column reads faster as a
      // face than as a repeated full name.
      if (field.kind.entity === "core.users") {
        return (
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={label} size="xs" />
            <span className="truncate">{label}</span>
          </span>
        );
      }
      return (
        <Link
          href={href}
          className="truncate text-brand hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      );
    }

    case "email":
      return (
        <a
          href={`mailto:${value}`}
          className="truncate text-brand hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      );

    case "phone":
      return (
        <a href={`tel:${value}`} className="tnum hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );

    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate text-brand hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value).replace(/^https?:\/\//, "")}
        </a>
      );

    case "long_text":
      return (
        <span className={cn("whitespace-pre-wrap", compact && "line-clamp-2")}>{String(value)}</span>
      );

    default:
      return <span className="truncate">{String(value)}</span>;
  }
}
