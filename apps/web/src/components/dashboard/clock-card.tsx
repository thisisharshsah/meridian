"use client";

import * as React from "react";
import { LogIn, LogOut, Timer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCreate, useList, useSession, useStats, useUpdate, type Record_ } from "@/lib/queries";
import { t } from "@/lib/i18n";

/** Local calendar date, not UTC: a shift belongs to the day the worker had. */
function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clockTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Monday of the current week, so "this week" means the same thing all week. */
function weekStart() {
  const d = new Date();
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function spell(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * Clock in and out, for whoever is signed in.
 *
 * Only appears for a user who has an employee record pointing at their login,
 * so an owner who never added themselves as staff is not asked to clock in to
 * their own business.
 */
export function ClockCard() {
  const { data: session } = useSession();
  const userId = session?.user.id;

  const employees = useList("hr.employees", userId ? { user_id: userId, per_page: 1 } : {});
  const employee = employees.data?.data[0] as Record_ | undefined;
  const employeeId = employee?.id as string | undefined;

  const day = today();
  const attendance = useList(
    "hr.attendance",
    employeeId ? { employee_id: employeeId, work_date: day, per_page: 1 } : {},
  );
  const record = attendance.data?.data[0] as Record_ | undefined;

  // Today's rota line and the running week, so the card answers "am I meant to
  // be here" and "how much have I done" without leaving the home screen.
  const shifts = useList(
    "hr.shifts",
    employeeId ? { employee_id: employeeId, shift_date: day, per_page: 1 } : {},
  );
  const shift = shifts.data?.data[0] as Record_ | undefined;

  const week = useStats(
    "hr.attendance",
    {
      measure: "worked_minutes",
      agg: "sum",
      filters: employeeId ? { employee_id: employeeId, work_date__gte: weekStart() } : {},
    },
    !!employeeId,
  );
  const weekMinutes = week.data?.data[0]?.value ?? 0;

  const create = useCreate("hr.attendance");
  const update = useUpdate("hr.attendance");

  // A minute clock so the running total moves while the card is open.
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!userId || !employeeId) return null;

  const clockedInAt = record?.clock_in as string | null | undefined;
  const clockedOutAt = record?.clock_out as string | null | undefined;
  const working = !!clockedInAt && !clockedOutAt;
  const finished = !!clockedInAt && !!clockedOutAt;

  const runningMinutes = clockedInAt
    ? Math.max(0, Math.round((Date.now() - new Date(clockedInAt).getTime()) / 60000))
    : 0;

  const clockIn = async () => {
    try {
      await create.mutateAsync({
        employee_id: employeeId,
        work_date: day,
        clock_in: new Date().toISOString(),
        status: "present",
      });
      toast.success("Clocked in");
    } catch {
      toast.error("Could not clock you in. Try again in a moment.");
    }
  };

  const clockOut = async () => {
    if (!record) return;
    try {
      await update.mutateAsync({
        id: record.id as string,
        body: { clock_out: new Date().toISOString() },
      });
      toast.success("Clocked out");
    } catch {
      toast.error("Could not clock you out. Try again in a moment.");
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Card className="mb-5">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cnDot(working)}
            aria-hidden="true"
          >
            <Timer className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {working
                ? t("clock.workingSince", undefined, { time: clockTime(clockedInAt!) })
                : finished
                  ? t("clock.doneToday", undefined, { duration: spell((record?.worked_minutes as number) ?? 0) })
                  : t("clock.notIn")}
            </p>
            <p className="text-xs text-muted-foreground">
              {working
                ? t("clock.soFar", undefined, { duration: spell(runningMinutes) })
                : finished
                  ? `${clockTime(clockedInAt!)} to ${clockTime(clockedOutAt!)}`
                  : t("clock.startWhenReady")}
            </p>
          </div>
        </div>

        {!finished && (
          <Button
            variant={working ? "secondary" : "primary"}
            size="lg"
            loading={pending}
            onClick={working ? clockOut : clockIn}
            className="w-full sm:w-auto"
          >
            {working ? <LogOut /> : <LogIn />}
            {working ? t("clock.out") : t("clock.in")}
          </Button>
        )}
      </CardContent>

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">
          {t("clock.todaysShift")}:{" "}
          <span className="font-medium text-foreground">
            {shift
              ? `${clockTime(shift.starts_at as string)} – ${clockTime(shift.ends_at as string)}`
              : t("clock.noShift")}
          </span>
        </span>
        <span className="text-muted-foreground">
          {t("clock.thisWeek")}:{" "}
          <span className="font-medium text-foreground tabular-nums">{spell(weekMinutes)}</span>
        </span>
      </div>
    </Card>
  );
}

function cnDot(working: boolean) {
  return [
    "flex size-9 shrink-0 items-center justify-center rounded-full",
    working ? "bg-success-subtle text-success-strong" : "bg-surface-muted text-muted-foreground",
  ].join(" ");
}
