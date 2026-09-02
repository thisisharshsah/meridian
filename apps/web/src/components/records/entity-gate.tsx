"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FileQuestion, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ApiError } from "@/lib/api";
import { useEntityMeta } from "@/lib/queries";
import type { EntityMeta } from "@/lib/meta";

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
    return (
      <div className="p-5">
        <EmptyState
          icon={forbidden ? Lock : FileQuestion}
          title={forbidden ? "You do not have access to this" : "Screen not found"}
          description={
            forbidden
              ? "Ask an administrator to grant your role permission to view these records."
              : `There is no module called "${entityKey}".`
          }
          action={
            <Button variant="secondary" asChild>
              <Link href="/">Back to home</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return <>{data && children(data)}</>;
}
