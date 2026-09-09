"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, LogOut, MailPlus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wordmark } from "@/components/brand/logo";
import { NewWorkspaceDialog } from "@/components/shell/new-workspace-dialog";
import { t } from "@/lib/i18n";
import { usePendingInvitations } from "@/lib/queries";
import type { Session } from "@/lib/meta";

/**
 * What someone sees between having an account and having a business.
 *
 * The session is real but points at no workspace, so there is nothing to show
 * a sidebar of. There are exactly two ways forward and both are on this screen:
 * accept an invitation someone sent to this address, or start something.
 */
export function ChooseWorkspace({ session }: { session?: Session }) {
  const router = useRouter();
  const qc = useQueryClient();
  const invitations = usePendingInvitations();
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const accept = async (id: string, name: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/my-invitations/${id}/accept`, { method: "POST" });
      if (!res.ok) throw new Error();
      const joined = await res.json();
      await fetch("/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id: joined.organization_id }),
      });
      qc.clear();
      toast.success(t("invite.accepted", undefined, { name }));
      router.replace("/");
      router.refresh();
    } catch {
      toast.error(t("invite.failed"));
      setBusy(false);
    }
  };

  const enter = async (organization_id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization_id }),
      });
      if (!res.ok) throw new Error();
      qc.clear();
      router.replace("/");
      router.refresh();
    } catch {
      toast.error(t("choose.enterFailed"));
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    router.replace("/login");
    router.refresh();
  };

  const waiting = invitations.data?.data ?? [];
  const mine = session?.organizations ?? [];

  return (
    <div className="min-h-dvh bg-surface-muted px-4 py-10">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
        <header className="flex flex-col gap-1">
          <Wordmark />
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            {mine.length > 0
              ? t("choose.titleReturning", undefined, { name: session?.user.name?.split(" ")[0] ?? "there" })
              : t("choose.title", undefined, { name: session?.user.name?.split(" ")[0] ?? "there" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mine.length > 0 ? t("choose.ledeReturning") : t("choose.lede")}
          </p>
        </header>

        {mine.length > 0 && (
          <Card>
            <CardHeader className="flex-col items-stretch gap-0">
              <CardTitle>{t("choose.yours")}</CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("choose.yoursLede")}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {mine.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={busy}
                  onClick={() => enter(o.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-border p-3 text-left transition-colors hover:border-brand/50 hover:bg-surface-hover disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                    <Building2 className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</span>
                  <ArrowRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {waiting.length > 0 && (
          <Card>
            <CardHeader className="flex-col items-stretch gap-0">
              <CardTitle>{t("choose.invited")}</CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("choose.invitedLede", undefined, { email: session?.user.email ?? "" })}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {waiting.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                    <MailPlus className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{inv.organization}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.title ? `${inv.title} · ` : ""}
                      {inv.role_name}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full sm:w-auto"
                    loading={busy}
                    onClick={() => accept(inv.id, inv.organization)}
                  >
                    {t("choose.accept")}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-col items-stretch gap-0">
            <CardTitle>{t("choose.start")}</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("choose.startLede")}</p>
          </CardHeader>
          <CardContent>
            <Button
              variant={waiting.length || mine.length ? "secondary" : "primary"}
              size="lg"
              onClick={() => setCreating(true)}
            >
              <Plus />
              {t("workspace.create")}
            </Button>
          </CardContent>
        </Card>

        {waiting.length === 0 && mine.length === 0 && !invitations.isLoading && (
          <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
            <Building2 className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {t("choose.noneWaiting", undefined, { email: session?.user.email ?? "" })}
          </p>
        )}

        <div className="pt-1">
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut />
            {t("action.signOut")}
          </Button>
        </div>
      </div>

      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
