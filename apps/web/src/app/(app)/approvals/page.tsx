"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Inbox, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { ApiError, get, post } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { entityPath } from "@/lib/meta";
import { t } from "@/lib/i18n";

type Request = {
  id: string;
  rule_name: string | null;
  entity: string;
  record_id: string;
  record_title: string | null;
  summary: string | null;
  status: string;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  comment: string | null;
  created_at: string;
};

/** Decisions waiting on this user, what they asked for, and what has been settled. */
export default function ApprovalsPage() {
  return (
    <div className="p-5">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t("approvals.title")}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("approvals.lede")}
        </p>
      </header>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">{t("approvals.waitingOnYou")}</TabsTrigger>
          <TabsTrigger value="mine">{t("approvals.youAskedFor")}</TabsTrigger>
          <TabsTrigger value="decided">{t("approvals.decided")}</TabsTrigger>
        </TabsList>
        {["pending", "mine", "decided"].map((scope) => (
          <TabsContent key={scope} value={scope} className="pt-4">
            <RequestList scope={scope} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function RequestList({ scope }: { scope: string }) {
  const qc = useQueryClient();
  const [comments, setComments] = React.useState<Record<string, string>>({});
  const [deciding, setDeciding] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["approvals", scope],
    queryFn: () => get<{ data: Request[] }>(`approvals?scope=${scope}`),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: string; comment?: string }) =>
      post(`approvals/${id}/decide`, { decision, comment }),
    onSuccess: (_r, vars) => {
      toast.success(t(vars.decision === "approve" ? "approvals.approved" : "approvals.rejected"));
      // The decision writes to the record, so lists and detail pages move too.
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("approvals.decisionFailed")),
    onSettled: () => setDeciding(null),
  });

  if (isLoading || !data) return <Skeleton className="h-48 w-full max-w-3xl" />;

  if (data.data.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={
          scope === "pending"
            ? "Nothing waiting on you"
            : scope === "mine"
              ? "You have not sent anything for approval"
              : t("approvals.noneDecided")
        }
        description={
          scope === "pending"
            ? "Records that need your sign-off will appear here."
            : t("approvals.rulesNote")
        }
      />
    );
  }

  return (
    <ul className="max-w-3xl space-y-2">
      {data.data.map((r) => (
        <li key={r.id}>
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`${entityPath(r.entity)}/${r.record_id}`}
                    className="text-sm font-medium hover:text-brand"
                  >
                    {r.record_title ?? t("value.untitled")}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.rule_name} · asked {relativeTime(r.created_at)}
                    {r.requested_by_name ? ` by ${r.requested_by_name}` : ""}
                  </p>
                  {r.comment && (
                    <p className="mt-1 text-xs italic text-muted-foreground">“{r.comment}”</p>
                  )}
                </div>

                {r.status === "pending" ? (
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder={t("approvals.comment")}
                      className="w-48"
                      value={comments[r.id] ?? ""}
                      onChange={(e) => setComments((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      loading={deciding === `${r.id}:approve`}
                      onClick={() => {
                        setDeciding(`${r.id}:approve`);
                        decide.mutate({ id: r.id, decision: "approve", comment: comments[r.id] });
                      }}
                    >
                      <Check />
                      {t("approvals.approve")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={deciding === `${r.id}:reject`}
                      onClick={() => {
                        setDeciding(`${r.id}:reject`);
                        decide.mutate({ id: r.id, decision: "reject", comment: comments[r.id] });
                      }}
                    >
                      <X />
                      {t("approvals.reject")}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge tone={r.status === "approved" ? "success" : r.status === "rejected" ? "danger" : "neutral"} dot>
                      {r.status}
                    </Badge>
                    {r.decided_by_name && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Avatar name={r.decided_by_name} size="xs" />
                        {r.decided_by_name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
