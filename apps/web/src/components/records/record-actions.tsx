"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Play, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldRow, FormError } from "@/components/form/field";
import { Checkbox } from "@/components/ui/misc";
import { ApiError, post } from "@/lib/api";
import type { EntityMeta } from "@/lib/meta";
import type { Record_ } from "@/lib/queries";
import { t } from "@/lib/i18n";

/**
 * The verbs that move a record to the next stage of the business, as opposed
 * to editing its fields. Which ones appear depends on the entity and on the
 * record's own state, so a converted lead does not offer to convert again.
 */
export function RecordActions({
  meta,
  record,
  currency,
}: {
  meta: EntityMeta;
  record: Record_;
  currency: string;
}) {
  const [convertLead, setConvertLead] = React.useState(false);
  const run = useAction();

  if (!meta.permissions.edit) return null;

  switch (meta.key) {
    case "crm.leads": {
      if (record.converted_at) return null;
      return (
        <>
          <Button variant="primary" onClick={() => setConvertLead(true)}>
            <Sparkles />
            {t("record.convert")}
          </Button>
          <ConvertLeadDialog
            open={convertLead}
            onOpenChange={setConvertLead}
            record={record}
            currency={currency}
          />
        </>
      );
    }

    case "sales.quotes": {
      if (record.status === "accepted" || record.status === "declined") return null;
      return (
        <Button
          variant="primary"
          loading={run.pending === "quote"}
          onClick={() =>
            run.go("quote", `actions/sales.quotes/${record.id}/convert`, {}, (r) => ({
              message: `Sales order created with ${r.lines} lines`,
              href: `/sales/orders/${r.sales_order_id}`,
            }))
          }
        >
          <ArrowRightLeft />
          Accept &amp; create order
        </Button>
      );
    }

    case "sales.orders": {
      if (record.status === "invoiced" || record.status === "cancelled") return null;
      return (
        <Button
          variant="primary"
          loading={run.pending === "order"}
          onClick={() =>
            run.go("order", `actions/sales.orders/${record.id}/convert`, { payment_terms_days: 30 }, (r) => ({
              message: `Invoice created with ${r.lines} lines`,
              href: `/books/invoices/${r.invoice_id}`,
            }))
          }
        >
          <ArrowRightLeft />
          {t("record.createInvoice")}
        </Button>
      );
    }

    case "books.recurring": {
      if (record.status !== "active") return null;
      return (
        <Button
          variant="secondary"
          loading={run.pending === "recurring"}
          onClick={() =>
            run.go("recurring", `actions/books.recurring/${record.id}/generate`, {}, (r) => ({
              message: `Invoice generated for ${r.billing_date}`,
              href: `/books/invoices/${r.invoice_id}`,
            }))
          }
        >
          <Play />
          {t("record.generateNow")}
        </Button>
      );
    }

    case "books.invoices": {
      if (record.status !== "draft") return null;
      return (
        <Button
          variant="primary"
          loading={run.pending === "send"}
          onClick={() =>
            run.go("send", `actions/books.invoices/${record.id}/send`, {}, () => ({
              message: t("record.invoiceIssued"),
            }))
          }
        >
          <Send />
          {t("record.issueInvoice")}
        </Button>
      );
    }

    default:
      return null;
  }
}

/** Shared POST-an-action plumbing: spinner, cache refresh, toast, navigation. */
function useAction() {
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, setPending] = React.useState<string | null>(null);

  const go = async (
    key: string,
    path: string,
    body: unknown,
    describe: (result: Record<string, never> & Record<string, unknown>) => { message: string; href?: string },
  ) => {
    setPending(key);
    try {
      const result = await post<Record<string, never> & Record<string, unknown>>(path, body);
      await qc.invalidateQueries();
      const { message, href } = describe(result);
      toast.success(message);
      if (href) router.push(href);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("record.actionFailed"));
    } finally {
      setPending(null);
    }
  };

  return { pending, go };
}

function ConvertLeadDialog({
  open, onOpenChange, record, currency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: Record_;
  currency: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();

  const [createDeal, setCreateDeal] = React.useState(true);
  const [dealName, setDealName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [closing, setClosing] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCreateDeal(true);
    setDealName(`${record.company ?? record.full_name ?? t("value.new")} opportunity`);
    setAmount("");
    setClosing("");
    setError(null);
  }, [open, record]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await post<{ account_id: string; contact_id: string; deal_id: string | null }>(
        `actions/crm.leads/${record.id}/convert`,
        {
          create_deal: createDeal,
          deal_name: dealName || undefined,
          deal_amount: amount || undefined,
          deal_closing_date: closing || undefined,
        },
      );
      await qc.invalidateQueries();
      toast.success(t("record.leadConverted"));
      onOpenChange(false);
      router.push(r.deal_id ? `/crm/deals/${r.deal_id}` : `/crm/accounts/${r.account_id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("record.convertFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("record.convertLead")}</DialogTitle>
            <DialogDescription>
              Creates an account for {String(record.company ?? t("value.thisCompany"))} and a contact for{" "}
              {String(record.full_name ?? t("value.thisPerson"))}. The lead stays on record, marked
              converted.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={createDeal}
                onCheckedChange={(c) => setCreateDeal(c === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                {t("record.alsoOpenDeal")}
                <span className="block text-xs text-muted-foreground">
                  {t("record.alsoOpenDealWhy")}
                </span>
              </span>
            </label>

            {createDeal && (
              <div className="space-y-3 border-l-2 border-border pl-3">
                <FieldRow label={t("record.dealName")} htmlFor="deal-name">
                  <Input id="deal-name" value={dealName} onChange={(e) => setDealName(e.target.value)} />
                </FieldRow>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label={`Amount (${currency})`} htmlFor="deal-amount">
                    <Input
                      id="deal-amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </FieldRow>
                  <FieldRow label={t("record.expectedClose")} htmlFor="deal-close">
                    <Input
                      id="deal-close"
                      type="date"
                      value={closing}
                      onChange={(e) => setClosing(e.target.value)}
                    />
                  </FieldRow>
                </div>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {t("record.convertLead")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
