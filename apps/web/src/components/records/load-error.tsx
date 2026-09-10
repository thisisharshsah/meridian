"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";

/**
 * What a screen shows when the data did not arrive.
 *
 * The alternative, and what several of these screens used to do, is fall
 * through to the empty state — so a board that failed to load said "no deals
 * yet". To someone who has a hundred deals that does not read as a network
 * problem, it reads as their business having been wiped, which is the single
 * most alarming thing a business system can say by accident.
 *
 * So: name the thing that did not load, say the data is safe, and offer the
 * one action that usually works.
 */
export function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  const signedOut = error instanceof ApiError && error.status === 401;

  return (
    <EmptyState
      icon={AlertTriangle}
      title={signedOut ? t("record.signInAgain") : `We couldn't load your ${what}`}
      description={
        signedOut
          ? "Your session timed out. Nothing has been lost — sign in and you'll come straight back."
          : t("record.offline")
      }
      action={
        onRetry && !signedOut ? (
          <Button variant="secondary" onClick={onRetry}>
            <RotateCw />
            {t("action.tryAgain")}
          </Button>
        ) : undefined
      }
    />
  );
}
