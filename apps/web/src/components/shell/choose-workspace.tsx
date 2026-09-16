"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, LogOut, MailPlus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EntryShell } from "@/components/brand/entry-shell";
import { NewWorkspaceDialog } from "@/components/shell/new-workspace-dialog";
import { t } from "@suite/shared/i18n";
import { usePendingInvitations } from "@/lib/queries";
import type { Session } from "@suite/shared/meta";

/**
 * What someone sees between having an account and having a business.
 *
 * The session is real but points at no workspace, so there is nothing to show
 * a sidebar of. There are exactly three ways forward and this screen is a
 * single list of them: open a business you are already in, accept an
 * invitation sent to this address, or start one.
 *
 * They were three stacked cards, each with its own heading and lede, so the
 * secondary path — "Start your own", two sentences and a button — carried the
 * same weight as the thing the person came here to do. One list, one row per
 * way in, and the wording of the last row changes with the situation rather
 * than offering somebody with no business at all to start "another" one.
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
  const first = session?.user.name?.split(" ")[0] ?? "";
  const nothingYet = !mine.length && !waiting.length && !invitations.isLoading;

  return (
    <>
      <EntryShell
        product={session?.product || t("app.name")}
        width="md"
        footer={
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut />
            {t("action.signOut")}
          </Button>
        }
      >
        <h1 className="text-xl font-semibold tracking-tight">
          {mine.length
            ? t("choose.titleReturning", undefined, { name: first })
            : t("choose.title", undefined, { name: first })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mine.length ? t("choose.ledeReturning") : t("choose.lede")}
        </p>

        <div className="mt-5 space-y-2">
          {mine.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              onClick={() => enter(o.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-brand/50 hover:bg-surface-hover disabled:opacity-60"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                <Building2 className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{o.name}</span>
              <ArrowRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
            </button>
          ))}

          {/* An invitation is a business you are not in yet, so it sits in the
              same list wearing a different icon and carrying its own verb. */}
          {waiting.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-brand">
                <MailPlus className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{inv.organization}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {inv.title ? `${inv.title} · ` : ""}
                  {inv.role_name}
                </p>
              </div>
              <Button variant="primary" size="sm" loading={busy} onClick={() => accept(inv.id, inv.organization)}>
                {t("choose.accept")}
              </Button>
            </div>
          ))}

          {/* Starting one is a way in like the others, so it is a row like the
              others — and it says "another" only when there is another. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border p-3 text-left transition-colors hover:border-brand/50 hover:bg-surface-hover disabled:opacity-60"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
              <Plus className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {mine.length ? t("workspace.create") : t("workspace.createFirst")}
              </span>
              <span className="block text-xs text-muted-foreground">{t("choose.startLede")}</span>
            </span>
          </button>
        </div>

        {/* Only when there is nothing else on the screen: otherwise it is a
            note about something the person did not ask about. */}
        {nothingYet && (
          <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">
            {t("choose.noneWaiting", undefined, { email: session?.user.email ?? "" })}
          </p>
        )}
      </EntryShell>

      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
