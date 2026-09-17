import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react-native";

import { Icon } from "@/components/icon";
import { Body, Card, Label } from "@/components/ui";
import { get, qs } from "@/lib/api";
import { useEntityMeta, useStats, type Page, type Record_ } from "@/lib/queries";
import { radius, space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * What to do first, per kind of business — the web's list, in the web's order.
 *
 * Ordered as the work actually happens: a hotel lists rooms before it can take
 * a booking, a pharmacy books in a delivery before it can sell from it. The
 * plan follows the business's own type, or the product spends somebody's first
 * morning pointing at the wrong screen.
 */
const PLANS: Record<string, string[]> = {
  general: ["customer", "product", "deal", "invoice"],
  shop: ["product", "sale", "customer", "invoice"],
  pharmacy: ["product", "batch", "sale", "invoice"],
  hospitality: ["room", "booking", "invoice"],
  services: ["customer", "project", "invoice"],
  trades: ["customer", "product", "invoice"],
};

/** Each step: what proves it done, and where it is done. */
const STEPS: Record<string, { entity: string; icon: string; titleKey: string; whyKey: string }> = {
  customer: { entity: "crm.accounts", icon: "Building2", titleKey: "setup.customer.title", whyKey: "setup.customer.why" },
  product: { entity: "inventory.items", icon: "Package", titleKey: "setup.product.title", whyKey: "setup.product.why" },
  deal: { entity: "crm.deals", icon: "Target", titleKey: "setup.deal.title", whyKey: "setup.deal.why" },
  invoice: { entity: "books.invoices", icon: "Receipt", titleKey: "setup.invoice.title", whyKey: "setup.invoice.why" },
  room: { entity: "hospitality.rooms", icon: "DoorOpen", titleKey: "setup.room.title", whyKey: "setup.room.why" },
  booking: { entity: "hospitality.reservations", icon: "BedDouble", titleKey: "setup.booking.title", whyKey: "setup.booking.why" },
  batch: { entity: "inventory.item_batches", icon: "Layers", titleKey: "setup.batch.title", whyKey: "setup.batch.why" },
  sale: { entity: "sales.counter_sales", icon: "ShoppingCart", titleKey: "setup.sale.title", whyKey: "setup.sale.why" },
  project: { entity: "projects.projects", icon: "FolderKanban", titleKey: "setup.project.title", whyKey: "setup.project.why" },
};

/**
 * The first week, on the home screen, until it is done.
 *
 * A brand-new business is all zeroes, and a grid of zeroes says nothing about
 * what to do next. Each step is proved done by asking for one record of the
 * entity behind it — not by a flag somebody could forget to set — and the
 * whole thing disappears once they all are.
 */
export function SetupGuide({ modules }: { modules: string[] }) {
  const c = useTheme();
  const router = useRouter();

  const shape = useQuery({
    queryKey: ["settings", "modules"],
    queryFn: () => get<{ business_type: string }>("settings/modules"),
    staleTime: 5 * 60_000,
  });

  const plan = (PLANS[shape.data?.business_type ?? "general"] ?? PLANS.general).filter((key) => {
    const step = STEPS[key];
    // A build or a business without the module behind a step cannot do it.
    return step && modules.some((m) => step.entity.startsWith(`${m}.`));
  });

  // One record is enough to prove a step done, and asking for one costs a page
  // of size one. `useQueries` rather than a loop of `useQuery`: the plan
  // changes length as the business type arrives, and a hook called a different
  // number of times between renders is a crash, not a bug you get to fix
  // later.
  const checks = useQueries({
    queries: plan.map((key) => ({
      queryKey: ["list", STEPS[key].entity, { per_page: 1 }],
      queryFn: () => get<Page<Record_>>(`e/${STEPS[key].entity}${qs({ per_page: 1 })}`),
    })),
  });
  const done = checks.map((q) => (q.data?.data.length ?? 0) > 0);
  const ready = checks.every((q) => !q.isPending);
  if (!ready || !plan.length || done.every(Boolean)) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Label>{t("setup.title")}</Label>
      <Body muted style={{ fontSize: 12 }}>{t("setup.lede")}</Body>
      <Card>
        {plan.map((key, i) => {
          const step = STEPS[key];
          const isDone = done[i];
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              onPress={() => router.push(entityPath(step.entity))}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                minHeight: 60,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
                backgroundColor: pressed ? c.surfaceMuted : "transparent",
                opacity: isDone ? 0.55 : 1,
              })}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDone ? c.successSubtle : c.brandSubtle,
                }}
              >
                {isDone ? (
                  <Check size={14} color={c.successStrong} />
                ) : (
                  <Icon name={step.icon} size={14} color={c.brand} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Body style={{ fontWeight: "600", fontSize: 14 }}>{t(step.titleKey)}</Body>
                <Body muted style={{ fontSize: 12 }}>{t(step.whyKey)}</Body>
              </View>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}

/**
 * Pipeline by stage, as bars.
 *
 * Length carries the magnitude and one hue carries all of them: the status
 * palette fails colour-blind separation when it has to carry identity alone,
 * which is the web's rule and the reason its charts look the way they do.
 */
export function StageBars({ entity, groupBy, title }: { entity: string; groupBy: string; title: string }) {
  const c = useTheme();
  const stats = useStats(entity, { group_by: groupBy, measure: "amount", agg: "sum" });
  // The bucket is the stored value — `closed_won` — and the field's options
  // are what a person calls it.
  const meta = useEntityMeta(entity);
  const field = meta.data?.fields.find((f) => f.name === groupBy);
  const labelOf = (bucket: string) =>
    (field && field.kind.type === "select" ? field.kind.options.find((o) => o.value === bucket)?.label : null) ?? bucket;

  const rows = (stats.data?.data ?? []).filter(
    (r) => typeof r.bucket === "string" && !String(r.bucket).startsWith("closed_"),
  );
  if (!rows.length) return null;

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <View style={{ gap: space.sm }}>
      <Label>{title}</Label>
      <Card style={{ padding: space.lg, gap: space.sm }}>
        {rows.map((r) => (
          <View key={String(r.bucket)} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Body style={{ fontSize: 13 }} numberOfLines={1}>{labelOf(String(r.bucket))}</Body>
              <Body muted style={{ fontSize: 12, fontVariant: ["tabular-nums"] }}>{r.count}</Body>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
              <View
                style={{
                  width: `${Math.max(2, Math.round((r.value / max) * 100))}%`,
                  height: "100%",
                  borderRadius: 3,
                  backgroundColor: c.brand,
                }}
              />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
