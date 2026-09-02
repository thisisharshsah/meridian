"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Search, Sun } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
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
            <DropdownMenuLabel>{session?.organization.name}</DropdownMenuLabel>
            <div className="px-2 pb-1.5 text-xs text-muted-foreground">
              {session?.user.email}
              <div className="mt-0.5 capitalize">
                {session?.is_owner ? "Owner" : session?.role} · {session?.organization.currency}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={signOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
