"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown, MailPlus, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewWorkspaceDialog } from "@/components/shell/new-workspace-dialog";
import { usePendingInvitations } from "@/lib/queries";
import { useAcceptInvitation, useSwitchWorkspace } from "@/lib/use-workspace";
import { t } from "@suite/shared/i18n";
import type { Session } from "@suite/shared/meta";

/**
 * Which business you are in, and every way to be in another one.
 *
 * Choosing a business used to be a screen of its own that everyone with more
 * than one passed through on the way to work. It is a control now, and this is
 * it: the businesses you are in, the invitations waiting for your address, and
 * starting another — the same list wherever it is opened from.
 *
 * `heading` renders it as the home screen's title, because the name of the
 * business you are typing into is the thing that screen is about; `topbar` is
 * the compact one that rides along everywhere else.
 */
export function WorkspaceSwitcher({
  session,
  variant = "topbar",
}: {
  session?: Session;
  variant?: "topbar" | "heading";
}) {
  const { switchTo, switching } = useSwitchWorkspace();
  const { accept, joining } = useAcceptInvitation();
  const invitations = usePendingInvitations();
  const [creating, setCreating] = React.useState(false);

  const current = session?.organization;
  const all = session?.organizations ?? [];
  const waiting = invitations.data?.data ?? [];
  if (!current) return null;

  const busy = switching || joining;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === "heading" ? (
            <button
              type="button"
              aria-label={t("workspace.switch")}
              className="-ml-1.5 flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xl font-semibold tracking-tight transition-colors hover:bg-surface-hover"
            >
              <span className="truncate">{current.name}</span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t("workspace.current") + ": " + current.name}
              className="flex h-8 min-w-0 max-w-52 items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors hover:bg-surface-hover"
            >
              <Building2 className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
              <span className="truncate">{current.name}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            </button>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          {all.length > 1 && <DropdownMenuLabel>{t("workspace.switch")}</DropdownMenuLabel>}
          {all.map((o) => (
            <DropdownMenuItem key={o.id} disabled={o.id === current.id || busy} onSelect={() => switchTo(o.id)}>
              {o.id === current.id ? <Check /> : <Building2 />}
              <span className="truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}

          {/* An invitation is a business you are not in yet, so it belongs in
              the list of businesses rather than on a screen of its own. */}
          {waiting.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("choose.invited")}</DropdownMenuLabel>
              {waiting.map((inv) => (
                <DropdownMenuItem key={inv.id} disabled={busy} onSelect={() => accept(inv.id, inv.organization)}>
                  <MailPlus />
                  <span className="min-w-0 flex-1 truncate">{inv.organization}</span>
                  <span className="text-xs text-brand">{t("choose.accept")}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            {t("workspace.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
