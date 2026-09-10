"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Banknote, Building2, CalendarCheck, CircleDollarSign, DoorOpen,
  FolderKanban, Layers, Package, Receipt, ShoppingCart, Target, Ticket, TrendingUp, UserPlus,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, toneOf } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { PipelineChart, StatusBars } from "@/components/dashboard/charts";
import { SetupGuide, type SetupStep } from "@/components/dashboard/setup-guide";
import { BusinessShapePrompt, useBusinessShape } from "@/components/settings/business-shape";
import { ClockCard } from "@/components/dashboard/clock-card";
import { ModuleLauncher } from "@/components/dashboard/module-launcher";
import { useAppMeta, useList, useSession, useStats } from "@/lib/queries";
import { formatMoney, formatDate, daysUntil } from "@/lib/format";
import { cn } from "@/lib/utils";
import { plural, t } from "@/lib/i18n";

/**
 * What to do first, per kind of business.
 *
 * Ordered as the work actually happens: a hotel lists rooms before it can
 * take a booking, a pharmacy books in a delivery before it can sell from it.
 * Four or five steps — a checklist longer than that stops being a checklist
 * and starts being a chore.
 */
const SETUP_PLANS: Record<string, string[]> = {
  general: ["customer", "product", "deal", "invoice", "team"],
  shop: ["product", "sale", "customer", "invoice", "team"],
  pharmacy: ["product", "batch", "sale", "invoice", "team"],
  hospitality: ["room", "booking", "invoice", "team"],
  services: ["customer", "project", "invoice", "team"],
  trades: ["customer", "product", "invoice", "team"],
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const currency = session?.organization?.currency ?? "USD";
  const today = new Date().toISOString().slice(0, 10);

  // The home page is the one screen everybody lands on, so it has to be about
  // their business too. A hotel with Support switched off should not be shown
  // an open-ticket count, and nothing here should ask a shop to add a deal.
  // Until the answer arrives, assume everything: a card appearing late reads
  // better than one that flickers away.
  const shape = useBusinessShape();
  const uses = (key: string) =>
    !shape.data || shape.data.modules.find((m) => m.key === key)?.in_use !== false;
  const [sells, bills, supports] = [uses("crm"), uses("books"), uses("desk")];
  // Rendering assumes everything while the answer is in flight; fetching waits
  // for it. Otherwise the first render fires a request for figures it is about
  // to stop showing, and React Query will not take it back. Settled either
  // way, because a failed lookup should show the whole dashboard, not none of
  // it.
  const asked = !shape.isPending;

  const openPipeline = useStats(
    "crm.deals",
    { group_by: "stage", measure: "amount", agg: "sum" },
    asked && sells,
  );
  const invoiceTotals = useStats(
    "books.invoices",
    { group_by: "status", measure: "total", agg: "sum" },
    asked && bills,
  );
  const ticketCounts = useStats("desk.tickets", { group_by: "status" }, asked && supports);
  const receivable = useStats(
    "books.invoices",
    { measure: "balance_due", agg: "sum", filters: { status__ne: "paid" } },
    asked && bills,
  );
  const wonThisPeriod = useStats(
    "crm.deals",
    { measure: "amount", agg: "sum", filters: { stage: "closed_won" } },
    asked && sells,
  );

  const overdue = useList(asked && bills ? "books.invoices" : undefined, {
    status__ne: "paid",
    due_date__lt: today,
    sort: "due_date",
    per_page: 5,
  });
  const recentDeals = useList(
    asked && sells ? "crm.deals" : undefined,
    { sort: "-created_at", per_page: 5 },
  );

  const pipelineRows = (openPipeline.data?.data ?? []).filter(
    (r) => typeof r.bucket === "string" && !String(r.bucket).startsWith("closed_"),
  );
  const openPipelineValue = pipelineRows.reduce((sum, r) => sum + r.value, 0);
  const openDealCount = pipelineRows.reduce((sum, r) => sum + r.count, 0);

  const receivableValue = receivable.data?.data[0]?.value ?? 0;
  const wonValue = wonThisPeriod.data?.data[0]?.value ?? 0;
  const openTickets = (ticketCounts.data?.data ?? [])
    .filter((r) => ["open", "in_progress", "on_hold"].includes(String(r.bucket)))
    .reduce((s, r) => s + r.value, 0);

  const loading = openPipeline.isLoading || receivable.isLoading;

  // A brand-new workspace is all zeroes, and a grid of zeroes tells an owner
  // nothing about what to do next. Detect that state and lead with a first
  // task instead of a dashboard that reports on data they have not entered.
  const accounts = useList("crm.accounts", { per_page: 1 });
  const products = useList("inventory.items", { per_page: 1 });
  const members = useList("core.users", { per_page: 2 });
  const meta = useAppMeta();

  const hasCustomers = (accounts.data?.data.length ?? 0) > 0;
  const hasProducts = (products.data?.data.length ?? 0) > 0;
  const hasDeals = openDealCount > 0 || (recentDeals.data?.data.length ?? 0) > 0;
  const hasInvoices = (invoiceTotals.data?.data.length ?? 0) > 0;
  const hasTeam = (members.data?.data.length ?? 0) > 1;

  // A hotel does not open by chasing a deal, and a shop does not open by
  // raising an invoice. The menu already follows the kind of business; the
  // list of what to do first has to follow it too, or the product spends
  // someone's first morning pointing at the wrong screen.
  const plan = SETUP_PLANS[shape.data?.business_type ?? "general"] ?? SETUP_PLANS.general;
  const planned = (key: string) => plan.includes(key);

  // Only asked for when the plan calls for it: `useList(undefined)` makes no
  // request, so a shop never pays for a query about rooms.
  const rooms = useList(planned("room") ? "hospitality.rooms" : undefined, { per_page: 1 });
  const bookings = useList(
    planned("booking") ? "hospitality.reservations" : undefined,
    { per_page: 1 },
  );
  const batches = useList(planned("batch") ? "inventory.item_batches" : undefined, { per_page: 1 });
  const projects = useList(planned("project") ? "projects.projects" : undefined, { per_page: 1 });
  const tillSales = useList(planned("sale") ? "sales.counter_sales" : undefined, { per_page: 1 });
  const any = (q: { data?: { data: unknown[] } }) => (q.data?.data.length ?? 0) > 0;

  const ALL_STEPS: Record<string, SetupStep> = {
    customer: {
      icon: Building2,
      title: t("setup.customer.title"),
      why: t("setup.customer.why"),
      href: "/crm/accounts",
      cta: t("setup.customer.title"),
      done: hasCustomers,
    },
    product: {
      icon: Package,
      title: t("setup.product.title"),
      why: t("setup.product.why"),
      href: "/inventory/items",
      cta: t("setup.product.cta"),
      done: hasProducts,
    },
    batch: {
      icon: Layers,
      title: t("setup.batch.title"),
      why: t("setup.batch.why"),
      href: "/inventory/item_batches",
      cta: t("setup.batch.cta"),
      done: any(batches),
    },
    room: {
      icon: DoorOpen,
      title: t("setup.room.title"),
      why: t("setup.room.why"),
      href: "/hospitality/rooms",
      cta: t("setup.room.cta"),
      done: any(rooms),
    },
    booking: {
      icon: CalendarCheck,
      title: t("setup.booking.title"),
      why: t("setup.booking.why"),
      href: "/hospitality/reservations",
      cta: t("setup.booking.cta"),
      done: any(bookings),
    },
    sale: {
      icon: ShoppingCart,
      title: t("setup.sale.title"),
      why: t("setup.sale.why"),
      href: "/till",
      cta: t("setup.sale.cta"),
      done: any(tillSales),
    },
    project: {
      icon: FolderKanban,
      title: t("setup.project.title"),
      why: t("setup.project.why"),
      href: "/projects/projects",
      cta: t("setup.project.cta"),
      done: any(projects),
    },
    deal: {
      icon: Target,
      title: t("setup.deal.title"),
      why: t("setup.deal.why"),
      href: "/crm/deals",
      cta: t("dash.addDeal"),
      done: hasDeals,
    },
    invoice: {
      icon: Receipt,
      title: t("setup.invoice.title"),
      why: t("setup.invoice.why"),
      href: "/books/invoices",
      cta: t("dash.createInvoice"),
      done: hasInvoices,
    },
    team: {
      icon: UserPlus,
      title: t("setup.team.title"),
      why: t("setup.team.why"),
      href: "/settings",
      cta: t("dash.inviteSomeone"),
      done: hasTeam,
    },
  };

  const setupSteps: SetupStep[] = plan.map((key) => ALL_STEPS[key]).filter(Boolean);

  // A grid of zeroes tells a first-time owner nothing. Once anything at all
  // exists the figures start meaning something, so they come back immediately.
  // Every figure on this page is a count, and a failed request counts zero.
  // Without this an established business whose API is down is shown the
  // brand-new-workspace guide and a wall of $0.00, which says the data is gone
  // rather than that it could not be reached.
  const figuresFailed =
    openPipeline.isError || receivable.isError || invoiceTotals.isError || accounts.isError;

  const nothingYet =
    !loading &&
    !accounts.isLoading &&
    !figuresFailed &&
    !hasCustomers &&
    !hasDeals &&
    !hasInvoices;

  return (
    <div className="p-5">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {session?.user.name?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Here is where {session?.organization?.name ?? t("value.thisWorkspace")} stands today.
        </p>
      </header>

      {figuresFailed && (
        <Card className="mb-5 border-warning/40 bg-warning-subtle">
          <CardContent className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium">{t("dash.stale")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                We couldn&rsquo;t reach your data just now, so anything below may be missing or
                showing zero. Nothing has been lost.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <ClockCard />

      <BusinessShapePrompt />
      {!figuresFailed && <SetupGuide steps={setupSteps} />}

      <ModuleLauncher modules={meta.data?.modules ?? []} />

      {!nothingYet && (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sells && (
          <Stat
            label={t("dash.openPipeline")}
            value={formatMoney(openPipelineValue, currency)}
            sub={plural("dash.openDealCount", openDealCount)}
            icon={Target}
            tone="brand"
            loading={loading}
            href="/crm/deals"
          />
        )}
        {sells && (
          <Stat
            label={t("dash.won")}
            value={formatMoney(wonValue, currency)}
            sub={t("dash.wonWhy")}
            icon={TrendingUp}
            tone="success"
            loading={loading}
            href="/crm/deals?stage=closed_won"
          />
        )}
        {bills && (
          <Stat
            label={t("dash.receivable")}
            value={formatMoney(receivableValue, currency)}
            sub={t("dash.receivableWhy")}
            icon={CircleDollarSign}
            tone="warning"
            loading={loading}
            href="/books/invoices"
          />
        )}
        {supports && (
          <Stat
            label={t("dash.openTickets")}
            value={String(openTickets)}
            sub={t("dash.ticketsWhy")}
            icon={Ticket}
            tone="danger"
            loading={ticketCounts.isLoading}
            href="/desk/tickets"
          />
        )}
      </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {sells && (
        <Card>
          <CardHeader>
            <CardTitle>{t("dash.pipelineByStage")}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/crm/deals">
                {t("dash.allDeals")} <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {openPipeline.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : pipelineRows.length === 0 ? (
              <EmptyState icon={Target} title={t("dash.noDeals")} description={t("dash.noDealsWhy")} />
            ) : (
              <PipelineChart rows={pipelineRows} currency={currency} />
            )}
          </CardContent>
        </Card>
        )}

        {bills && (
        <Card>
          <CardHeader>
            <CardTitle>{t("dash.invoicesByStatus")}</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/books/invoices">
                {t("dash.allInvoices")} <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {invoiceTotals.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (invoiceTotals.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Receipt} title={t("dash.noInvoices")} description={t("dash.noInvoicesWhy")} />
            ) : (
              <StatusBars rows={invoiceTotals.data!.data} currency={currency} />
            )}
          </CardContent>
        </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {bills && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-warning" />
              {t("dash.overdueInvoices")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {overdue.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (overdue.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Banknote} title={t("dash.nothingOverdue")} description={t("dash.nothingOverdueWhy")} />
            ) : (
              <ul className="divide-y divide-border">
                {overdue.data!.data.map((inv) => {
                  const late = daysUntil(inv.due_date as string) ?? 0;
                  return (
                    <li key={inv.id}>
                      <Link
                        href={`/books/invoices/${inv.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {String(inv.number)} · {String(inv.account_id__label ?? "—")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("dash.dueOn", undefined, {
                              date: formatDate(inv.due_date as string),
                            })}
                            {" · "}
                            {plural("dash.daysLate", Math.abs(late))}
                          </p>
                        </div>
                        <span className="tnum text-sm font-medium">
                          {formatMoney(inv.balance_due as number, currency)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        )}

        {sells && (
        <Card>
          <CardHeader>
            <CardTitle>{t("dash.latestDeals")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentDeals.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (recentDeals.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Target} title={t("dash.noDealsYet")} description={t("dash.noDealsYetWhy")} />
            ) : (
              <ul className="divide-y divide-border">
                {recentDeals.data!.data.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/crm/deals/${d.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{String(d.name)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {String(d.account_id__label ?? t("value.none"))}
                        </p>
                      </div>
                      <Badge tone={toneOf(stageTone(String(d.stage)))} dot>
                        {String(d.stage).replace(/_/g, " ")}
                      </Badge>
                      <span className="tnum text-sm font-medium">
                        {formatMoney(d.amount as number, currency, { compact: true })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, icon: Icon, tone, loading, href,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "brand" | "success" | "warning" | "danger";
  loading?: boolean;
  href: string;
}) {
  const tones = {
    brand: "bg-brand-subtle text-brand-subtle-foreground",
    success: "bg-success-subtle text-success",
    warning: "bg-warning-subtle text-warning-strong",
    danger: "bg-danger-subtle text-danger",
  };
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("rounded-md p-1.5", tones[tone])}>
          <Icon className="size-3.5" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight tnum">{value}</p>
      )}
      <p className="mt-0.5 text-xs text-subtle-foreground">{sub}</p>
    </Link>
  );
}

function stageTone(stage: string) {
  if (stage === "closed_won") return "success";
  if (stage === "closed_lost") return "danger";
  if (stage === "negotiation") return "warning";
  if (stage === "proposal") return "brand";
  return "neutral";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
