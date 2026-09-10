"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FileQuestion, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ApiError } from "@/lib/api";
import { useEntityMeta } from "@/lib/queries";
import type { EntityMeta } from "@/lib/meta";
import { t } from "@/lib/i18n";

/**
 * Resolves an entity key to its metadata before rendering a screen, and turns
 * the two failure modes — no such entity, no permission — into pages rather
 * than a blank screen. The API is the authority; this just renders its answer.
 */
export function EntityGate({
  entityKey,
  children,
}: {
  entityKey: string;
  children: (meta: EntityMeta) => ReactNode;
}) {
  const { data, isLoading, error } = useEntityMeta(entityKey);

  if (isLoading) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    // A timed-out session used to be reported as "Screen not found", which
    // reads as data loss to someone who does not know what a session is.
    const signedOut = error instanceof ApiError && error.status === 401;
    return (
      <div className="p-5">
        <EmptyState
          icon={forbidden || signedOut ? Lock : FileQuestion}
          title={
            forbidden
              ? "You do not have access to this"
              : signedOut
                ? "Please sign in again"
                : t("record.gateTitle")
          }
          description={
            forbidden
              ? "Ask whoever set up your workspace to give your role access to these records."
              : signedOut
                ? "Your session timed out. Nothing has been lost — sign in and you'll come straight back."
                : t("record.gateBody")
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/">{t("record.backHome")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <>{data && children(data)}</>;
}
