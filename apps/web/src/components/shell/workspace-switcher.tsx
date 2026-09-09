"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NewWorkspaceDialog } from "@/components/shell/new-workspace-dialog";
import { useSwitchWorkspace } from "@/lib/use-workspace";
import { t } from "@/lib/i18n";
import type { Session } from "@/lib/meta";

/**
 * Which business you are in, and how to leave it.
 *
 * It sits in the topbar rather than inside the account menu because it answers
 * a question people have constantly and an account menu answers questions they
 * have twice a year. Someone running two similarly named companies needs the
 * name of the one they are typing into to be visible without clicking
 * anything — the switch itself is the smaller half of the job.
 */
export function WorkspaceSwitcher({ session }: { session?: Session }) {
  const { switchTo, switching } = useSwitchWorkspace();
  const [creating, setCreating] = React.useState(false);

  const current = session?.organization;
  const all = session?.organizations ?? [];
  if (!current) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("workspace.current") + ": " + current.name}
            className="flex h-8 min-w-0 max-w-[13rem] items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors hover:bg-surface-hover"
          >
            <Building2 className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
            <span className="truncate">{current.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-60">
          {all.length > 1 && <DropdownMenuLabel>{t("workspace.switch")}</DropdownMenuLabel>}
          {all.map((o) => (
            <DropdownMenuItem
              key={o.id}
              disabled={o.id === current.id || switching}
              onSelect={() => switchTo(o.id)}
            >
              {o.id === current.id ? <Check /> : <Building2 />}
              <span className="truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}
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
