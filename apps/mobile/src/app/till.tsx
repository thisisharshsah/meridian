import * as React from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Minus, Plus } from "lucide-react-native";

import { RequireSession } from "@/components/guard";
import { Body, Button, Empty, Input, Label, Loading, Problem } from "@/components/ui";
import { patch, post } from "@/lib/api";
import { useSession, useShortList, useStats, type Record_ } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { DEFAULT_CURRENCY } from "@suite/shared/constants";
import { formatMoney, moneyToInput, MONEY_SCALE } from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

type Line = { itemId: string; name: string; unitMinor: number; qty: number };

const METHODS = [
  { value: "cash", labelKey: "till.method.cash" },
  { value: "card", labelKey: "till.method.card" },
  { value: "transfer", labelKey: "till.method.transfer" },
] as const;

export default function Till() {
  return (
    <RequireSession>
      <TillScreen />
    </RequireSession>
  );
}

/**
 * The till, on the device that is already in the shopkeeper's hand.
 *
 * The basket is held here and written once, at payment: tapping a product must
 * cost nothing, and a queue is the wrong place to find out the network is
 * slow. Nothing exists server-side until it is paid for, so an abandoned
 * basket leaves no half-finished sale for anyone to reconcile.
 *
 * The lines are then written one at a time rather than at once, because each
 * one retotals the sale and firing them together makes the running total a
 * race. The web's till learned that already.
 */
function TillScreen() {
  const c = useTheme();
  const session = useSession();
  const currency = session.data?.organization?.currency ?? DEFAULT_CURRENCY;

  const [term, setTerm] = React.useState("");
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => setQuery(term.trim()), 200);
    return () => clearTimeout(id);
  }, [term]);

  const items = useShortList("inventory.items", { per_page: 60, ...(query ? { q: query } : {}) });

  // What the drawer should hold. A shop counts up at close and the figures are
  // already here, so nobody should be adding up receipts.
  // Midnight where the shop is, as the instant the server stores. `sold_at` is
  // a timestamp and the engine refuses a bare date for one — which is how the
  // web's till came to report a day's takings of nothing.
  const startOfToday = React.useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }, []);
  const takings = useStats("sales.counter_sales", {
    group_by: "payment_method",
    measure: "total",
    agg: "sum",
    filters: { status: "completed", sold_at__gte: startOfToday },
  });
  const takenToday = (takings.data?.data ?? []).reduce((s, r) => s + r.value, 0);
  // A failed lookup is not a day with no takings in it.
  const takingsFailed = takings.isError;

  const [lines, setLines] = React.useState<Line[]>([]);
  const [method, setMethod] = React.useState<string>("cash");
  const [tendered, setTendered] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const totalMinor = lines.reduce((s, l) => s + l.unitMinor * l.qty, 0);
  const tenderedMinor = Math.round((parseFloat(tendered) || 0) * MONEY_SCALE);
  const changeMinor = tenderedMinor > totalMinor ? tenderedMinor - totalMinor : 0;
  const short = method === "cash" && tendered !== "" && tenderedMinor < totalMinor;

  const add = (r: Record_) => {
    const id = r.id;
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
          name: (r.name as string) || t("record.item"),
          unitMinor: (r.sell_price as number) ?? 0,
          qty: 1,
        },
      ];
    });
  };

  const bump = (itemId: string, by: number) =>
    setLines((cur) => cur.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + by } : l)).filter((l) => l.qty > 0));

  const takePayment = async () => {
    if (!lines.length || busy) return;
    setBusy(true);
    try {
      const sale = await post<Record_>("e/sales.counter_sales", {
        sold_at: new Date().toISOString(),
        payment_method: method,
        ...(tendered ? { amount_tendered: tendered } : {}),
      });

      for (const [i, l] of lines.entries()) {
        await post("e/sales.counter_sale_items", {
          counter_sale_id: sale.id,
          item_id: l.itemId,
          description: l.name,
          quantity: String(l.qty),
          unit_price: moneyToInput(l.unitMinor),
          sort_order: i,
        });
      }

      const done = await patch<Record_>(`e/sales.counter_sales/${sale.id}`, { status: "completed" });
      Alert.alert(
        String(done.number ?? t("value.sale")),
        [
          formatMoney(done.total as number, currency),
          changeMinor ? t("till.changeDue", undefined, { amount: formatMoney(changeMinor, currency) }) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setLines([]);
      setTendered("");
      takings.refetch();
    } catch {
      Alert.alert(t("till.saleFailed"));
    } finally {
      setBusy(false);
    }
  };

  const products = items.data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: t("nav.till") }} />
      <View style={{ flex: 1 }}>
        <View style={{ padding: space.md, gap: space.sm }}>
          <Input
            value={term}
            onChangeText={setTerm}
            placeholder={t("till.searchPlaceholder")}
            accessibilityLabel={t("till.scanLabel")}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            // A scanner is a keyboard that types fast and presses return. One
            // match is unambiguous, so ring it up and clear for the next item;
            // anything else stays on screen to be chosen by hand.
            onSubmitEditing={() => {
              if (products.length === 1) {
                add(products[0]);
                setTerm("");
              }
            }}
          />
        </View>

        {items.isPending ? <Loading /> : null}
        {items.error ? <Problem error={items.error} onRetry={() => items.refetch()} /> : null}

        <FlatList
          style={{ flex: 1 }}
          data={products}
          keyExtractor={(r) => r.id}
          numColumns={2}
          columnWrapperStyle={{ gap: space.sm, paddingHorizontal: space.md }}
          contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            items.isPending ? null : (
              <Empty title={t("till.noProducts")} body={t("till.noProductsWhy")} />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => add(item)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 72,
                justifyContent: "center",
                gap: 2,
                padding: space.md,
                borderRadius: radius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                backgroundColor: pressed ? c.brandSubtle : c.surface,
              })}
            >
              <Body numberOfLines={2} style={{ fontWeight: "600", fontSize: 14 }}>
                {String(item.name ?? t("record.item"))}
              </Body>
              <Body muted style={{ fontSize: 13, fontVariant: ["tabular-nums"] }}>
                {formatMoney((item.sell_price as number) ?? 0, currency)}
              </Body>
            </Pressable>
          )}
        />

        <Basket
          lines={lines}
          currency={currency}
          totalMinor={totalMinor}
          changeMinor={changeMinor}
          short={short}
          method={method}
          onMethod={setMethod}
          tendered={tendered}
          onTendered={setTendered}
          onBump={bump}
          onPay={takePayment}
          busy={busy}
          takenToday={takenToday}
          takingsFailed={takingsFailed}
        />
      </View>
    </>
  );
}

/** The sale being rung up: pinned to the bottom, where the thumb is. */
function Basket({
  lines,
  currency,
  totalMinor,
  changeMinor,
  short,
  method,
  onMethod,
  tendered,
  onTendered,
  onBump,
  onPay,
  busy,
  takenToday,
  takingsFailed,
}: {
  lines: Line[];
  currency: string;
  totalMinor: number;
  changeMinor: number;
  short: boolean;
  method: string;
  onMethod: (v: string) => void;
  tendered: string;
  onTendered: (v: string) => void;
  onBump: (itemId: string, by: number) => void;
  onPay: () => void;
  busy: boolean;
  takenToday: number;
  takingsFailed: boolean;
}) {
  const c = useTheme();

  if (!lines.length) {
    return (
      <View
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          backgroundColor: c.surface,
          padding: space.lg,
          gap: space.xs,
        }}
      >
        <Body muted style={{ textAlign: "center" }}>{t("till.tapToStart")}</Body>
        <Body subtle style={{ textAlign: "center", fontSize: 12 }}>
          {t("till.takenToday")}: {takingsFailed ? t("till.takingsUnknown") : formatMoney(takenToday, currency, { showZero: true })}
        </Body>
      </View>
    );
  }

  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: c.surface,
        padding: space.md,
        gap: space.sm,
        maxHeight: "55%",
      }}
    >
      <View style={{ gap: space.xs }}>
        {lines.map((l) => (
          <View key={l.itemId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Body style={{ flex: 1 }} numberOfLines={1}>{l.name}</Body>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("till.oneLess", undefined, { label: l.name })}
              onPress={() => onBump(l.itemId, -1)}
              style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Minus size={16} color={c.mutedForeground} />
            </Pressable>
            <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "600", minWidth: 20, textAlign: "center" }}>
              {l.qty}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("till.oneMore", undefined, { label: l.name })}
              onPress={() => onBump(l.itemId, 1)}
              style={({ pressed }) => ({ padding: space.sm, opacity: pressed ? 0.6 : 1 })}
            >
              <Plus size={16} color={c.mutedForeground} />
            </Pressable>
            <Body style={{ fontVariant: ["tabular-nums"], minWidth: 72, textAlign: "right" }}>
              {formatMoney(l.unitMinor * l.qty, currency)}
            </Body>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Label>{t("till.total")}</Label>
        <Text style={{ color: c.foreground, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
          {formatMoney(totalMinor, currency, { showZero: true })}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: space.xs }}>
        {METHODS.map((m) => {
          const on = m.value === method;
          return (
            <Pressable
              key={m.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => onMethod(m.value)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 38,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: on ? c.brand : c.border,
                backgroundColor: pressed ? c.surfaceMuted : on ? c.brandSubtle : "transparent",
              })}
            >
              <Body style={{ fontSize: 13, fontWeight: on ? "700" : "500", color: on ? c.brandSubtleForeground : c.mutedForeground }}>
                {t(m.labelKey)}
              </Body>
            </Pressable>
          );
        })}
      </View>

      {/* Cash is the one that needs arithmetic, and it is the one a person is
          worst at doing while someone waits. */}
      {method === "cash" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Input
              value={tendered}
              onChangeText={onTendered}
              placeholder={t("till.cashGiven")}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </View>
          <View style={{ minWidth: 110, alignItems: "flex-end" }}>
            {short ? (
              <Body style={{ color: c.dangerStrong, fontSize: 13 }}>{t("till.notEnough")}</Body>
            ) : changeMinor ? (
              <>
                <Body subtle style={{ fontSize: 11 }}>{t("till.change")}</Body>
                <Body style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                  {formatMoney(changeMinor, currency)}
                </Body>
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      <Button title={t("till.takePayment")} onPress={onPay} busy={busy} disabled={short} />
    </View>
  );
}
