import * as React from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { Body, Button } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { space, useTheme } from "@/lib/theme";
import { entityPath, type EntityMeta } from "@suite/shared/meta";
import type { Record_ } from "@/lib/queries";
import { plural, t } from "@suite/shared/i18n";

/**
 * The verbs that turn one record into another: a lead into a customer, a quote
 * into an order, an order into an invoice.
 *
 * These are the chain the whole product is built around, and the phone could
 * read every document in it without being able to move one along. Each is a
 * single endpoint that copies line items across, preserves totals to the cent
 * and refuses to run twice — so this asks, and the server decides.
 *
 * Which action a record offers is a question about *that* entity, so unlike
 * everything else on this screen it is a short list of keys rather than
 * metadata. The registry does not describe conversions.
 */
export function RecordActions({
  meta,
  record,
  onDone,
}: {
  meta: EntityMeta;
  record: Record_;
  onDone: () => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (!meta.permissions.edit) return null;

  const run = async (
    path: string,
    body: Record<string, unknown>,
    after: (r: Record<string, string | number>) => { message: string; entity: string; id: string },
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<Record<string, string | number>>(path, body);
      const { message, entity, id } = after(res);
      // Everything this touched: the document written, the one it came from,
      // and any figure counting either.
      qc.clear();
      onDone();
      Alert.alert(message);
      router.replace(`${entityPath(entity)}/${id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("record.somethingWrong"));
      setBusy(false);
    }
  };

  const action = (() => {
    switch (meta.key) {
      // A lead is converted once; after that the account it became is the
      // record that matters.
      case "crm.leads":
        if (record.converted_at) return null;
        return {
          title: t("record.convertLead"),
          onPress: () =>
            run(`actions/crm.leads/${record.id}/convert`, { create_deal: true }, (r) => ({
              message: t("record.leadConverted"),
              entity: "crm.accounts",
              id: String(r.account_id),
            })),
        };

      case "sales.quotes":
        if (record.status === "accepted" || record.status === "declined") return null;
        return {
          title: t("record.acceptQuote"),
          onPress: () =>
            run(`actions/sales.quotes/${record.id}/convert`, {}, (r) => ({
              message: plural("record.orderCreatedLines", Number(r.lines ?? 0)),
              entity: "sales.orders",
              id: String(r.sales_order_id),
            })),
        };

      case "sales.orders":
        if (record.status === "invoiced" || record.status === "cancelled") return null;
        return {
          title: t("record.createInvoice"),
          onPress: () =>
            // Net 30 unless the business says otherwise, which is what the web
            // sends too.
            run(`actions/sales.orders/${record.id}/convert`, { payment_terms_days: 30 }, (r) => ({
              message: plural("record.invoiceCreatedLines", Number(r.lines ?? 0)),
              entity: "books.invoices",
              id: String(r.invoice_id),
            })),
        };

      case "books.recurring":
        if (record.status !== "active") return null;
        return {
          title: t("record.generateNow"),
          onPress: () =>
            run(`actions/books.recurring/${record.id}/generate`, {}, (r) => ({
              message: t("record.invoiceGeneratedFor", undefined, { date: String(r.billing_date) }),
              entity: "books.invoices",
              id: String(r.invoice_id),
            })),
        };

      // A draft invoice is not owed until it has been sent.
      case "books.invoices":
        if (record.status !== "draft") return null;
        return {
          title: t("record.issueInvoice"),
          onPress: () =>
            run(`actions/books.invoices/${record.id}/send`, {}, () => ({
              message: t("record.invoiceIssued"),
              entity: "books.invoices",
              id: record.id,
            })),
        };

      default:
        return null;
    }
  })();

  if (!action) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Button title={action.title} onPress={action.onPress} busy={busy} />
      {error ? <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{error}</Body> : null}
    </View>
  );
}
