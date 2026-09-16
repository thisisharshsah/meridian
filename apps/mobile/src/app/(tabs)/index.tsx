import * as React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronsUpDown } from "lucide-react-native";

import { AuthShell } from "@/components/auth-shell";
import { BusinessList, BusinessSheet } from "@/components/business-list";
import { RequireSession } from "@/components/guard";
import { Body, Card, Empty, Label, Loading, Problem, Title } from "@/components/ui";
import { useAppMeta, useSession, useShortList, useStats, type Record_ } from "@/lib/queries";
import { useSessionState } from "@/lib/session";
import { radius, space, useTheme } from "@/lib/theme";
import { entityPath } from "@suite/shared/meta";
import { formatMoney, daysUntil } from "@suite/shared/format";
import { plural, t } from "@suite/shared/i18n";

export default function Home() {
  return (
    <RequireSession>
      <HomeScreen />
    </RequireSession>
  );
}

function HomeScreen() {
  const session = useSession();

  if (session.isPending) return <Loading />;
  if (session.error) return <Problem error={session.error} onRetry={() => session.refetch()} />;

  // An account can belong to no business yet — someone invited who has not
  // accepted. That is not a different screen, it is this screen with nothing
  // in it yet, so it shows the ways in rather than sending them somewhere.
  if (!session.data?.organization) return <NoBusinessYet />;

  return <Dashboard />;
}

/**
 * Where the business stands, not a menu of it.
 *
 * Home listed every module and so did More, which made one of them pointless.
 * The modules are the bottom bar's job now; this screen answers what is
 * happening: what is owed, what is in the pipeline, and what has gone past its
 * due date. Each figure is one aggregate from the server, because a phone
 * should not download a year of invoices to add them up.
 */
function Dashboard() {
  const c = useTheme();
  const router = useRouter();
  const session = useSession();
  const meta = useAppMeta();
  const [switching, setSwitching] = React.useState(false);

  const organization = session.data?.organization;
  const currency = organization?.currency ?? "USD";
  const today = new Date().toISOString().slice(0, 10);

  // A build or a business without a module has no figures from it, and asking
  // would be a 403 rather than a zero.
  const has = (key: string) => (meta.data?.modules ?? []).some((m) => m.key === key);
  const [sells, bills] = [has("crm"), has("books")];

  const pipeline = useStats("crm.deals", { group_by: "stage", measure: "amount", agg: "sum" }, sells);
  const receivable = useStats(
    "books.invoices",
    { measure: "balance_due", agg: "sum", filters: { status__ne: "paid" } },
    bills,
  );
  const overdue = useShortList(bills ? "books.invoices" : undefined, {
    status__ne: "paid",
    due_date__lt: today,
    sort: "due_date",
    per_page: 5,
  });

  const openRows = (pipeline.data?.data ?? []).filter(
    (r) => typeof r.bucket === "string" && !String(r.bucket).startsWith("closed_"),
  );
  const openValue = openRows.reduce((sum, r) => sum + r.value, 0);
  const openCount = openRows.reduce((sum, r) => sum + r.count, 0);
  const owed = receivable.data?.data[0]?.value ?? 0;
  const late = overdue.data?.data ?? [];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {/* The business's name is the heading, and the heading is the switcher:
            this screen is about the business you are in, and choosing another
            is a control on it rather than a screen in front of it. */}
        <View style={{ gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.switch")}
            onPress={() => setSwitching(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              alignSelf: "flex-start",
              marginLeft: -space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              borderRadius: radius,
              backgroundColor: pressed ? c.surfaceMuted : "transparent",
            })}
          >
            <Title numberOfLines={1}>{organization?.name}</Title>
            <ChevronsUpDown size={16} color={c.subtleForeground} />
          </Pressable>
          <Body muted>{greeting()}, {session.data?.user.name?.split(" ")[0] ?? ""}</Body>
        </View>

        {meta.isPending ? <Loading /> : null}

        <View style={{ flexDirection: "row", gap: space.md }}>
          {bills ? (
            <Figure
              label={t("dash.receivable")}
              value={formatMoney(owed, currency, { compact: true, showZero: true })}
              why={t("dash.receivableWhy")}
              loading={receivable.isPending}
              onPress={() => router.navigate(entityPath("books.invoices"))}
            />
          ) : null}
          {sells ? (
            <Figure
              label={t("dash.openPipeline")}
              value={formatMoney(openValue, currency, { compact: true, showZero: true })}
              why={plural("dash.openDealCount", openCount)}
              loading={pipeline.isPending}
              onPress={() => router.navigate(entityPath("crm.deals"))}
            />
          ) : null}
        </View>

        {bills ? (
          <View style={{ gap: space.sm }}>
            <Label>{t("dash.overdueInvoices")}</Label>
            <Card>
              {overdue.isPending ? (
                <Loading />
              ) : late.length === 0 ? (
                <Empty title={t("dash.nothingOverdue")} body={t("dash.nothingOverdueWhy")} />
              ) : (
                late.map((inv, i) => (
                  <OverdueRow key={inv.id} invoice={inv} currency={currency} first={i === 0} />
                ))
              )}
            </Card>
          </View>
        ) : null}

        <View style={{ height: space.xl }} />
      </ScrollView>

      <BusinessSheet open={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

function Figure({
  label,
  value,
  why,
  loading,
  onPress,
}: {
  label: string;
  value: string;
  why: string;
  loading: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: pressed ? c.surfaceMuted : c.surface,
        borderColor: c.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius,
        padding: space.md,
        gap: 2,
      })}
    >
      <Label>{label}</Label>
      {loading ? (
        <Body muted>{t("dash.loading")}</Body>
      ) : (
        <Body style={{ fontSize: 20, fontWeight: "700" }} numberOfLines={1}>{value}</Body>
      )}
      <Body subtle style={{ fontSize: 11 }} numberOfLines={1}>{why}</Body>
    </Pressable>
  );
}

/** How late, in days, because "overdue" alone does not say how much trouble. */
function OverdueRow({ invoice, currency, first }: { invoice: Record_; currency: string; first: boolean }) {
  const c = useTheme();
  const router = useRouter();
  const days = daysUntil(invoice.due_date as string);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`${entityPath("books.invoices")}/${invoice.id}`)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        minHeight: 56,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: c.border,
        backgroundColor: pressed ? c.surfaceMuted : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body numberOfLines={1} style={{ fontWeight: "600" }}>
          {String(invoice.account_id__label ?? invoice.number ?? t("value.untitled"))}
        </Body>
        <Body style={{ color: c.dangerStrong, fontSize: 12 }}>
          {days === null ? "" : plural("dash.daysLate", Math.abs(days))}
        </Body>
      </View>
      <Body style={{ fontVariant: ["tabular-nums"], fontWeight: "600" }}>
        {formatMoney(invoice.balance_due as number, currency)}
      </Body>
    </Pressable>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return t("dash.morning");
  if (h < 18) return t("dash.afternoon");
  return t("dash.evening");
}

/** Home, for someone whose account is real but who is not in a business yet. */
function NoBusinessYet() {
  const session = useSession();
  const { signOut } = useSessionState();
  const c = useTheme();
  const first = session.data?.user.name?.split(" ")[0] ?? "";

  return (
    <>
      <AuthShell
        title={t("choose.title", undefined, { name: first })}
        lede={t("choose.lede")}
        footer={
          <Pressable
            accessibilityRole="button"
            onPress={() => void signOut()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Body style={{ color: c.brandSubtleForeground }}>{t("action.signOut")}</Body>
          </Pressable>
        }
      >
        <BusinessList />
        <Body muted style={{ fontSize: 12 }}>
          {t("choose.noneWaiting", undefined, { email: session.data?.user.email ?? "" })}
        </Body>
      </AuthShell>
    </>
  );
}
