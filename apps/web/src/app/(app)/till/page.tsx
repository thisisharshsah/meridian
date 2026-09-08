"use client";

import * as React from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { post, patch } from "@/lib/api";
import { formatMoney, moneyToInput, MONEY_SCALE } from "@/lib/format";
import { useList, useSession, useStats, type Record_ } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type Line = { itemId: string; name: string; unitMinor: number; qty: number };

const METHODS = [
  { value: "cash", labelKey: "till.method.cash" },
  { value: "card", labelKey: "till.method.card" },
  { value: "transfer", labelKey: "till.method.transfer" },
] as const;

/**
 * The till. A shop at rush hour cannot open a dialog, fill fourteen fields and
 * pick a customer for every packet of biscuits.
 *
 * The basket is held here and written once, at payment: tapping a product must
 * cost nothing, and a queue is the wrong place to discover the network is slow.
 * Until payment nothing exists server-side, so an abandoned basket leaves no
 * half-finished sale behind for someone to reconcile later.
 */
export default function TillPage() {
  const { data: session } = useSession();
  const currency = session?.organization.currency ?? "USD";

  const [term, setTerm] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(t);
  }, [term]);

  const items = useList("inventory.items", { per_page: 60, ...(debounced ? { q: debounced } : {}) });

  // What the drawer should hold. A shop counts up at close, and the figures
  // are already here -- there is no reason to make anyone add up receipts.
  const startOfToday = React.useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const takings = useStats("sales.counter_sales", {
    group_by: "payment_method",
    measure: "total",
    agg: "sum",
    filters: { status: "completed", sold_at__gte: startOfToday },
  });
  const takenToday = (takings.data?.data ?? []).reduce((s, r) => s + r.value, 0);
  const salesToday = (takings.data?.data ?? []).reduce((s, r) => s + r.count, 0);

  const [lines, setLines] = React.useState<Line[]>([]);
  const [method, setMethod] = React.useState<string>("cash");
  const [tendered, setTendered] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const totalMinor = lines.reduce((s, l) => s + l.unitMinor * l.qty, 0);
  const tenderedMinor = Math.round((parseFloat(tendered) || 0) * MONEY_SCALE);
  const changeMinor = tenderedMinor > totalMinor ? tenderedMinor - totalMinor : 0;
  const short = method === "cash" && tendered !== "" && tenderedMinor < totalMinor;

  const add = (r: Record_) => {
    const id = r.id as string;
    setLines((cur) => {
      const at = cur.findIndex((l) => l.itemId === id);
      if (at >= 0) {
        const next = [...cur];
        next[at] = { ...next[at], qty: next[at].qty + 1 };
        return next;
      }
      return [
        ...cur,
        {
          itemId: id,
          name: (r.name as string) || "Item",
          unitMinor: (r.sell_price as number) ?? 0,
          qty: 1,
        },
      ];
    });
  };

  // A scanner is a keyboard that types fast and presses Enter. One match means
  // the right thing is unambiguous, so ring it up and clear for the next item;
  // anything else leaves the results on screen to be chosen by hand.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const hits = items.data?.data ?? [];
    if (hits.length === 1) {
      add(hits[0]);
      setTerm("");
    } else if (hits.length === 0 && debounced) {
      toast.error(`Nothing found for “${debounced}”`);
    }
  };

  const bump = (itemId: string, by: number) =>
    setLines((cur) =>
      cur
        .map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + by } : l))
        .filter((l) => l.qty > 0),
    );

  const clear = () => {
    setLines([]);
    setTendered("");
  };

  const takePayment = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      const sale = await post<Record_>("e/sales.counter_sales", {
        sold_at: new Date().toISOString(),
        payment_method: method,
        ...(tendered ? { amount_tendered: tendered } : {}),
      });
      const saleId = sale.id as string;

      // Sequential rather than parallel: each line retotals the sale, and
      // firing them at once makes the running total a race.
      for (const [i, l] of lines.entries()) {
        await post("e/sales.counter_sale_items", {
          counter_sale_id: saleId,
          item_id: l.itemId,
          description: l.name,
          quantity: String(l.qty),
          unit_price: moneyToInput(l.unitMinor),
          sort_order: i,
        });
      }

      const done = await patch<Record_>(`e/sales.counter_sales/${saleId}`, { status: "completed" });
      toast.success(
        `${done.number ?? "Sale"} · ${formatMoney(done.total as number, currency)}` +
          (changeMinor ? ` · change ${formatMoney(changeMinor, currency)}` : ""),
      );
      clear();
    } catch {
      toast.error("The sale did not go through. Nothing was charged — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* products */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
        <div className="relative shrink-0 p-3">
          <Search className="pointer-events-none absolute left-5.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t("till.searchPlaceholder")}
            aria-label="Scan a barcode or search products"
            className="h-11 pl-9 text-base"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-0 scrollbar-thin">
          {items.isLoading && !items.data ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (items.data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={Search}
              title={debounced ? "Nothing matches that" : t("till.noProducts")}
              description={
                debounced
                  ? "Try a shorter word, or part of the code."
                  : t("till.noProductsWhy")
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.data?.data.map((r) => (
                <li key={r.id as string}>
                  <button
                    type="button"
                    onClick={() => add(r)}
                    className="flex h-full min-h-20 w-full flex-col justify-between rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-muted"
                  >
                    <span className="line-clamp-2 text-sm font-medium">{(r.name as string) || "Item"}</span>
                    <span className="mt-1 text-sm tabular-nums text-muted-foreground">
                      {formatMoney((r.sell_price as number) ?? 0, currency)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* basket */}
      <div className="flex min-h-0 w-full flex-col lg:w-96">
        <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border bg-surface-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {t("till.takenToday")}{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatMoney(takenToday, currency, { showZero: true })}
            </span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {salesToday} {salesToday === 1 ? "sale" : "sales"}
          </span>
        </div>

        <div className="flex shrink-0 items-center justify-between px-3 py-2.5">
          <h1 className="text-sm font-semibold">{t("till.thisSale")}</h1>
          {lines.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear}>
              <Trash2 />
              {t("action.clear")}
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 scrollbar-thin">
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("till.tapToStart")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {lines.map((l) => (
                <li key={l.itemId} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatMoney(l.unitMinor, currency)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="icon-sm" onClick={() => bump(l.itemId, -1)} aria-label={`One less ${l.name}`}>
                      <Minus />
                    </Button>
                    <span className="w-7 text-center text-sm font-medium tabular-nums">{l.qty}</span>
                    <Button variant="secondary" size="icon-sm" onClick={() => bump(l.itemId, 1)} aria-label={`One more ${l.name}`}>
                      <Plus />
                    </Button>
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                    {formatMoney(l.unitMinor * l.qty, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{t("till.total")}</span>
            <span className="text-2xl font-semibold tabular-nums">{formatMoney(totalMinor, currency)}</span>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                aria-pressed={method === m.value}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                  method === m.value
                    ? "border-brand bg-brand text-white"
                    : "border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>

          {method === "cash" && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={tendered}
                onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder={t("till.cashGiven")}
                aria-label={t("till.cashGiven")}
                aria-invalid={short}
                className="h-10 flex-1 text-base"
              />
              <span className="w-28 text-right text-sm tabular-nums">
                {short ? (
                  <span className="text-danger">{t("till.notEnough")}</span>
                ) : changeMinor > 0 ? (
                  <>
                    <span className="text-muted-foreground">{t("till.change")} </span>
                    <span className="font-semibold">{formatMoney(changeMinor, currency)}</span>
                  </>
                ) : null}
              </span>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            className="mt-3 w-full"
            disabled={!lines.length || short}
            loading={busy}
            onClick={takePayment}
          >
            {t("till.takePayment")}
          </Button>
        </div>
      </div>
    </div>
  );
}
