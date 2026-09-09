"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { t } from "@/lib/i18n";

/**
 * Moving the session to another business.
 *
 * Shared by the three places that offer it — the topbar switcher, the command
 * palette and the post-login picker — so they cannot disagree about what
 * switching means. The cache clear is the part that matters: every cached
 * answer belongs to the business being left, and one company's records
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
