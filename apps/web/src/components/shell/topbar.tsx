"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePendingInvitations } from "@/lib/queries";
import { Building2, Check, LogOut, MailPlus, Moon, Plus, Search, Sun } from "lucide-react";

import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { NewWorkspaceDialog } from "@/components/shell/new-workspace-dialog";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session } from "@/lib/meta";

export function Topbar({ session, onSearch }: { session?: Session; onSearch: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const [switching, setSwitching] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  /**
   * Switching workspaces replaces the session cookies, so every cached answer
   * belongs to the business we just left. Clearing the cache before navigating
   * is what stops one company's records flashing up inside another.
   */
  const switchTo = async (organization_id: string) => {
    if (switching) return;
    setSwitching(true);
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
      toast.error("Could not switch workspace. Try again in a moment.");
    } finally {
      setSwitching(false);
    }
  };

  const invitations = usePendingInvitations();

  /**
   * Accepting lands you in the business you just joined, because that is what
   * you were doing. The switch is a second call: joining and choosing which
   * workspace the session points at are genuinely different things.
   */
  const acceptInvite = async (id: string, name: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch(`/api/${encodeURIComponent("my-invitations")}/${id}/accept`, { method: "POST" });
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
    } finally {
      setSwitching(false);
    }
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("suite-theme", next ? "dark" : "light");
    } catch {
      /* theme just won't persist */
    }
  };

  const signOut = async () => {
    await fetch("/api/session/logout", { method: "POST" }).catch(() => undefined);
    // Empty the cache, not just invalidate it. `router.replace` does not remount
    // the provider, so on a shared machine the next person to sign in would
    // otherwise hydrate the shell from this user's cached records — including
    // modules their own role cannot reach, since `["meta"]` never refetches.
    qc.clear();
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <button
        type="button"
        onClick={onSearch}
        className="flex h-8 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 text-sm text-subtle-foreground transition-colors hover:bg-surface-hover"
      >
        <Search className="size-3.5" />
        <span>Search…</span>
        <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-px font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {dark ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-surface-hover">
              <Avatar name={session?.user.name} size="sm" />
              <span className="hidden text-sm font-medium sm:block">{session?.user.name ?? "…"}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{session?.organization?.name}</DropdownMenuLabel>
            <div className="px-2 pb-1.5 text-xs text-muted-foreground">
              {session?.user.email}
              <div className="mt-0.5 capitalize">
                {session?.is_owner ? "Owner" : session?.role} · {session?.organization?.currency}
              </div>
            </div>
            {(invitations.data?.data.length ?? 0) > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("invite.waiting")}</DropdownMenuLabel>
                {invitations.data?.data.map((inv) => (
                  <DropdownMenuItem key={inv.id} disabled={switching} onSelect={() => acceptInvite(inv.id, inv.organization)}>
                    <MailPlus />
                    <span className="truncate">{t("invite.join", undefined, { name: inv.organization })}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {(session?.organizations.length ?? 0) > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("workspace.switch")}</DropdownMenuLabel>
                {session?.organizations.map((o) => (
                  <DropdownMenuItem
                    key={o.id}
                    disabled={o.id === session.organization?.id || switching}
                    onSelect={() => switchTo(o.id)}
                  >
                    {o.id === session.organization?.id ? <Check /> : <Building2 />}
                    <span className="truncate">{o.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreating(true)}>
              <Plus />
              {t("workspace.create")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={signOut}>
              <LogOut />
              {t("action.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </header>
  );
}
