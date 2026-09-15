import * as React from "react";
import { Linking, Text } from "react-native";

import { Badge, Body } from "@/components/ui";
import { toneColors, useTheme } from "@/lib/theme";
import { optionFor, type FieldDef } from "@suite/shared/meta";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
} from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

/**
 * One field, displayed. The list rows and the record screen both come through
 * here, so money looks like money everywhere — and looks the way it does on
 * the web, since the formatting is the web's own code.
 */
export function FieldValue({
  field,
  record,
  currency,
  strong,
}: {
  field: FieldDef;
  record: Record<string, unknown>;
  currency: string;
  strong?: boolean;
}) {
  const c = useTheme();
  const value = record[field.name];
  const weight = strong ? ("600" as const) : ("400" as const);

  if (value === null || value === undefined || value === "") {
    return <Body subtle>—</Body>;
  }

  switch (field.kind.type) {
    case "money":
      return <Body style={{ fontVariant: ["tabular-nums"], fontWeight: weight }}>{formatMoney(value as number, currency)}</Body>;
    case "percent":
      return <Body style={{ fontVariant: ["tabular-nums"], fontWeight: weight }}>{formatPercent(value as number)}</Body>;
    case "quantity":
      return <Body style={{ fontVariant: ["tabular-nums"], fontWeight: weight }}>{formatQuantity(value as number)}</Body>;
    case "int":
      return <Body style={{ fontVariant: ["tabular-nums"], fontWeight: weight }}>{new Intl.NumberFormat().format(value as number)}</Body>;

    // A tick alone says nothing to a screen reader and cannot be told from an
    // empty cell, so both answers are words — the web decided this too.
    case "bool":
      return <Body style={{ fontWeight: weight }}>{value ? t("value.yes") : t("value.no")}</Body>;

    case "date":
      return <Body style={{ fontWeight: weight }}>{formatDate(value as string)}</Body>;
    case "date_time":
      return <Body style={{ fontWeight: weight }}>{formatDateTime(value as string)}</Body>;

    case "select": {
      const opt = optionFor(field, value);
      const { bg, fg } = toneColors(opt?.tone, c);
      return <Badge label={opt?.label ?? String(value)} bg={bg} fg={fg} />;
    }

    // The label the API sends alongside the id. Tapping through to the related
    // record is a later step; showing the id would be worse than showing text.
    case "ref":
      return <Body style={{ fontWeight: weight }}>{(record[`${field.name}__label`] as string) ?? "—"}</Body>;

    case "email":
      return <Linked text={String(value)} url={`mailto:${value}`} />;
    case "phone":
      return <Linked text={String(value)} url={`tel:${value}`} />;
    case "url":
      return <Linked text={String(value).replace(/^https?:\/\//, "")} url={String(value)} />;

    default:
      return <Body style={{ fontWeight: weight }}>{String(value)}</Body>;
  }
}

/** An address the phone can act on: mail, dial, or open. */
function Linked({ text, url }: { text: string; url: string }) {
  const c = useTheme();
  return (
    <Text
      accessibilityRole="link"
      onPress={() => {
        Linking.openURL(url).catch(() => undefined);
      }}
      style={{ color: c.brand, fontSize: 15 }}
    >
      {text}
    </Text>
  );
}
