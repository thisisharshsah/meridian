"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CheckCheck, ChevronDown, LayoutDashboard, Settings } from "lucide-react";

import { Icon } from "@/components/icon";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { entityPath, type ModuleMeta } from "@/lib/meta";
import { Skeleton } from "@/components/ui/misc";

const OPEN_KEY = "suite-open-modules";

/**
 * Module list comes straight from the API, filtered to what this user may see,
 * so the navigation can never offer a screen the server would refuse.
 */
export function Sidebar({
  modules,
  loading,
  className,
  onNavigate,
}: {
  modules: ModuleMeta[];
  loading: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeModule = pathname.split("/")[1] ?? "";

  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [restored, setRestored] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) setOpen(JSON.parse(raw));
    } catch {
      // A browser that blocks storage just gets the default open state.
    }
    setRestored(true);
  }, []);

  React.useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* not worth failing a render over */
    }
  }, [open, restored]);

  const isOpen = (key: string) => open[key] ?? key === activeModule;

  return (
    <nav
      // Delegated so the drawer closes on an actual navigation but stays open
      // when a module row is only being expanded.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}
      className={cn(
        "flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar",
        className,
      )}
    >
      <div className="flex h-13 items-center px-4">
        <Link href="/" className="text-sidebar-foreground hover:text-foreground">
          <Wordmark />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        <Link
          href="/"
          className={cn(
            "mb-1 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname === "/"
              ? "bg-sidebar-active text-foreground"
              : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <LayoutDashboard className="size-4" />
          Home
        </Link>

        {loading && (
          <div className="space-y-2 px-1 pt-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}

        {modules.map((m) => {
          const expanded = isOpen(m.key);
          return (
            <div key={m.key} className="mt-0.5">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [m.key]: !expanded }))}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  m.key === activeModule
                    ? "text-foreground"
                    : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
                )}
                aria-expanded={expanded}
              >
                <Icon name={m.icon} className="size-4" />
                <span className="flex-1 text-left">{m.label}</span>
                <ChevronDown
                  className={cn("size-3.5 opacity-50 transition-transform", expanded && "rotate-180")}
                />
              </button>

              {expanded && (
                <ul className="mb-1 ml-[1.4rem] border-l border-border pl-2">
                  {m.entities.map((e) => {
                    const href = entityPath(e.key);
                    const active = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <li key={e.key}>
                        <Link
                          href={href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                            active
                              ? "bg-sidebar-active font-medium text-foreground"
                              : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
                          )}
                        >
                          <Icon name={e.icon} className="size-3.5 opacity-70" />
                          {e.label_plural}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-2">
        <Link
          href="/approvals"
          className={cn(
            "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname.startsWith("/approvals")
              ? "bg-sidebar-active text-foreground"
              : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <CheckCheck className="size-4" />
          Approvals
        </Link>
        <Link
          href="/reports"
          className={cn(
            "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname.startsWith("/reports")
              ? "bg-sidebar-active text-foreground"
              : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <BarChart3 className="size-4" />
          Reports
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-sidebar-active text-foreground"
              : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
          )}
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </div>
    </nav>
  );
}
