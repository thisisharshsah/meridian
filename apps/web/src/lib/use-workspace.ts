"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { t } from "@suite/shared/i18n";

/**
 * Accepting an invitation, then landing in what you just joined.
 *
 * Two calls, and the second is what makes it a place you are rather than a
 * place you belong to: joining creates the membership, switching moves the
 * session into it. Shared, so the switcher and the empty home screen cannot
 * disagree about what "Join" does.
 */
export function useAcceptInvitation() {
  const router = useRouter();
  const qc = useQueryClient();
  const [joining, setJoining] = React.useState(false);

  const accept = React.useCallback(
    async (id: string, name: string) => {
      if (joining) return;
      setJoining(true);
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
        setJoining(false);
      }
    },
    [joining, qc, router],
  );

  return { accept, joining };
}

/**
 * Moving the session to another business.
 *
 * Shared by the places that offer it — the home heading, the topbar switcher,
 * the command palette and the empty home screen — so they cannot disagree
 * about what switching means. The cache clear is the part that matters: every
 * cached answer belongs to the business being left, and one company's records
 * appearing inside another is the failure this must never have.
 */
export function useSwitchWorkspace() {
  const router = useRouter();
  const qc = useQueryClient();
  const [switching, setSwitching] = React.useState(false);

  const switchTo = React.useCallback(
    async (organizationId: string) => {
      if (switching) return;
      setSwitching(true);
      try {
        const res = await fetch("/api/session/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organization_id: organizationId }),
        });
        if (!res.ok) throw new Error();
        qc.clear();
        router.replace("/");
        router.refresh();
      } catch {
        toast.error(t("workspace.switchFailed"));
        setSwitching(false);
      }
    },
    [switching, qc, router],
  );

  return { switchTo, switching };
}
