"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Banknote, Building2, CircleDollarSign, Receipt, Target, Ticket,
  TrendingUp, UserPlus,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, toneOf } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { PipelineChart, StatusBars } from "@/components/dashboard/charts";
import { SetupGuide, type SetupStep } from "@/components/dashboard/setup-guide";
import { ClockCard } from "@/components/dashboard/clock-card";
import { ModuleLauncher } from "@/components/dashboard/module-launcher";
import { useAppMeta, useList, useSession, useStats } from "@/lib/queries";
import { formatMoney, formatDate, daysUntil } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

export default function DashboardPage() {
  const { data: session } = useSession();
  const currency = session?.organization?.currency ?? "USD";
  const today = new Date().toISOString().slice(0, 10);

  const openPipeline = useStats("crm.deals", {
    group_by: "stage",
    measure: "amount",
    agg: "sum",
  });
  const invoiceTotals = useStats("books.invoices", { group_by: "status", measure: "total", agg: "sum" });
  const ticketCounts = useStats("desk.tickets", { group_by: "status" });
  const receivable = useStats("books.invoices", {
    measure: "balance_due",
    agg: "sum",
    filters: { status__ne: "paid" },
  });
  const wonThisPeriod = useStats("crm.deals", {
    measure: "amount",
    agg: "sum",
    filters: { stage: "closed_won" },
  });

  const overdue = useList("books.invoices", {
    status__ne: "paid",
    due_date__lt: today,
    sort: "due_date",
    per_page: 5,
  });
  const recentDeals = useList("crm.deals", { sort: "-created_at", per_page: 5 });

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
  const members = useList("core.users", { per_page: 2 });
  const meta = useAppMeta();

  const hasCustomers = (accounts.data?.data.length ?? 0) > 0;
  const hasDeals = openDealCount > 0 || (recentDeals.data?.data.length ?? 0) > 0;
  const hasInvoices = (invoiceTotals.data?.data.length ?? 0) > 0;
  const hasTeam = (members.data?.data.length ?? 0) > 1;

  const setupSteps: SetupStep[] = [
    {
      icon: Building2,
      title: t("setup.customer.title"),
      why: t("setup.customer.why"),
      href: "/crm/accounts",
      cta: t("setup.customer.title"),
      done: hasCustomers,
    },
    {
      icon: Target,
      title: t("setup.deal.title"),
      why: t("setup.deal.why"),
      href: "/crm/deals",
      cta: "Add a deal",
      done: hasDeals,
    },
    {
      icon: Receipt,
      title: t("setup.invoice.title"),
      why: t("setup.invoice.why"),
      href: "/books/invoices",
      cta: "Create an invoice",
      done: hasInvoices,
    },
    {
      icon: UserPlus,
      title: t("setup.team.title"),
      why: t("setup.team.why"),
      href: "/settings",
      cta: "Invite someone",
      done: hasTeam,
    },
  ];

  // A grid of zeroes tells a first-time owner nothing. Once anything at all
  // exists the figures start meaning something, so they come back immediately.
  const nothingYet =
    !loading && !accounts.isLoading && !hasCustomers && !hasDeals && !hasInvoices;

  return (
    <div className="p-5">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {session?.user.name?.split(" ")[0] ?? "there"}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Here is where {session?.organization?.name ?? "your workspace"} stands today.
        </p>
      </header>

      <ClockCard />

      <SetupGuide steps={setupSteps} />

      <ModuleLauncher modules={meta.data?.modules ?? []} />

      {!nothingYet && (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Open pipeline"
          value={formatMoney(openPipelineValue, currency)}
          sub={`${openDealCount} open deal${openDealCount === 1 ? "" : "s"}`}
          icon={Target}
          tone="brand"
          loading={loading}
          href="/crm/deals"
        />
        <Stat
          label="Won"
          value={formatMoney(wonValue, currency)}
          sub="Closed won, all time"
          icon={TrendingUp}
          tone="success"
          loading={loading}
          href="/crm/deals?stage=closed_won"
        />
        <Stat
          label="Receivable"
          value={formatMoney(receivableValue, currency)}
          sub="Outstanding on unpaid invoices"
          icon={CircleDollarSign}
          tone="warning"
          loading={loading}
          href="/books/invoices"
        />
        <Stat
          label="Open tickets"
          value={String(openTickets)}
          sub="Awaiting a response or fix"
          icon={Ticket}
          tone="danger"
          loading={ticketCounts.isLoading}
          href="/desk/tickets"
        />
      </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/crm/deals">
                All deals <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {openPipeline.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : pipelineRows.length === 0 ? (
              <EmptyState icon={Target} title="No open deals" description="Add a deal to see your pipeline." />
            ) : (
              <PipelineChart rows={pipelineRows} currency={currency} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices by status</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/books/invoices">
                All invoices <ArrowUpRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {invoiceTotals.isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (invoiceTotals.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Receipt} title="No invoices yet" description="Bill a customer to see this chart." />
            ) : (
              <StatusBars rows={invoiceTotals.data!.data} currency={currency} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5 text-warning" />
              Overdue invoices
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
              <EmptyState icon={Banknote} title="Nothing overdue" description="Every invoice is inside its terms." />
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
                            Due {formatDate(inv.due_date as string)} · {Math.abs(late)} days late
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

        <Card>
          <CardHeader>
            <CardTitle>Latest deals</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentDeals.isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (recentDeals.data?.data.length ?? 0) === 0 ? (
              <EmptyState icon={Target} title="No deals yet" description="Your newest deals will show up here." />
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
                          {String(d.account_id__label ?? "No account")}
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
