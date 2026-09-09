"use client";

import * as React from "react";
import Link from "next/link";
import { Check, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

const DISMISS_KEY = "suite-setup-dismissed";

export type SetupStep = {
  icon: LucideIcon;
  title: string;
  why: string;
  href: string;
  cta: string;
  done: boolean;
};

/**
 * The first-run checklist. It stays until every step is done or the owner puts
 * it away, which is the whole point: the previous version only rendered while
 * the workspace was completely empty, so it vanished the moment you finished
 * step one and left you standing in the middle of your own setup with no idea
 * what came next.
 *
 * Each step says what the thing IS, not just its name. "Deal" and "account"
 * carry no meaning for someone who has never used a CRM, and they are the
 * first two words this product asks them to understand.
 */
export function SetupGuide({ steps }: { steps: SetupStep[] }) {
  const [dismissed, setDismissed] = React.useState(true);

  // Starts hidden and appears once storage has been read, so the card cannot
  // flash on screen for someone who already put it away.
  React.useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  if (dismissed || allDone) return null;

  const hide = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* a browser that blocks storage just gets the card again next visit */
    }
  };

  return (
    <Card className="mb-5 border-brand/30 bg-brand-subtle/30">
      <CardHeader className="flex-col items-stretch gap-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("setup.title")}</CardTitle>
          <span className="text-xs font-medium text-muted-foreground">
            {t("setup.progress", undefined, { done, total: steps.length })}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("setup.lede")}
        </p>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-label="Setup progress"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const next = !s.done && steps.slice(0, i).every((p) => p.done);
          return (
            <div
              key={s.title}
              className={cn(
                "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center",
                next ? "border-brand/40 bg-surface" : "border-border bg-surface/60",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  s.done ? "bg-success-subtle text-success-strong" : "bg-brand-subtle text-brand",
                )}
                aria-hidden="true"
              >
                {s.done ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>

              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", s.done && "text-muted-foreground")}>
                  {s.title}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.why}</p>
              </div>

              {/* Full width on a phone: a button wedged beside wrapping text
                  squeezes the explanation into a column three words wide. */}
              {!s.done && (
                <Button
                  variant={next ? "primary" : "secondary"}
                  size="sm"
                  asChild
                  className="w-full sm:w-auto sm:shrink-0"
                >
                  <Link href={s.href}>{s.cta}</Link>
                </Button>
              )}
              <span className="sr-only">
                {s.done ? "Done" : `Step ${i + 1} of ${steps.length}`}
              </span>
            </div>
          );
        })}

        {/* The arc past setup. Without it the guide reads as five chores; with
            it, the chores are the first week of something that keeps going. */}
        <p className="pt-1 text-center text-xs text-muted-foreground">{t("setup.after")}</p>

        <div className="pt-1 text-center">
          <button
            type="button"
            onClick={hide}
            className="text-xs text-subtle-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("setup.hide")}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
