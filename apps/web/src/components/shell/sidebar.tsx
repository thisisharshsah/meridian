"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CheckCheck,
  ChevronDown,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";

import { Icon } from "@/components/icon";
import { Logo, Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { entityPath, type ModuleMeta } from "@/lib/meta";
import { Skeleton } from "@/components/ui/misc";

const OPEN_KEY = "suite-open-modules";

/**
 * Module list comes straight from the API, filtered to what this user may see,
 * so the navigation can never offer a screen the server would refuse.
 *
 * Three shapes from one component: the full column, an icon-only rail, and the
 * phone drawer (always full, since a rail inside a drawer helps nobody).
 */
export function Sidebar({
  modules,
  loading,
  className,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  modules: ModuleMeta[];
  loading: boolean;
  className?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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

  // Shared by every row so the rail and the full column stay in step.
  const row = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-md py-1.5 text-sm font-medium transition-colors",
      collapsed ? "justify-center px-0" : "px-2.5",
      active
        ? "bg-sidebar-active text-foreground"
        : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
    );

  return (
    <nav
      // Only the persistent column answers to the pre-paint width class; the
      // drawer is always full width and must not be caught by it.
      data-nav-rail={onToggleCollapse ? "" : undefined}
      // Delegated so the drawer closes on an actual navigation but stays open
      // when a module row is only being expanded.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) onNavigate?.();
      }}
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-sidebar transition-[width]",
        collapsed ? "w-14" : "w-60",
        className,
      )}
    >
      <div className={cn("flex h-13 items-center", collapsed ? "justify-center px-0" : "px-4")}>
        <Link
          href="/"
          className="text-sidebar-foreground hover:text-foreground"
          aria-label="Meridian home"
        >
          {collapsed ? <Logo size={24} /> : <Wordmark />}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        <Link
          href="/"
          className={cn("mb-1", row(pathname === "/"))}
          title={collapsed ? "Home" : undefined}
          aria-label={collapsed ? "Home" : undefined}
        >
          <LayoutDashboard className="size-4 shrink-0" />
          {!collapsed && "Home"}
        </Link>

        {loading && (
          <div className="space-y-2 px-1 pt-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-7", collapsed ? "w-8" : "w-full")} />
            ))}
          </div>
        )}

        {modules.map((m) => {
          const expanded = isOpen(m.key);
          const active = m.key === activeModule;

          // Collapsed there is no room for a submenu, so the icon becomes a
          // direct link to the module's first screen rather than a disclosure
          // that expands into nothing.
          if (collapsed) {
            const first = m.entities[0];
            if (!first) return null;
            return (
              <Link
                key={m.key}
                href={entityPath(first.key)}
                className={cn("mt-0.5", row(active))}
                title={m.description ? `${m.label} — ${m.description}` : m.label}
                aria-label={m.label}
              >
                <Icon name={m.icon} className="size-4 shrink-0" />
              </Link>
            );
          }

          return (
            <div key={m.key} className="mt-0.5">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [m.key]: !expanded }))}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "text-foreground"
                    : "text-sidebar-foreground hover:bg-surface-hover hover:text-foreground",
                )}
                aria-expanded={expanded}
                title={m.description ?? undefined}
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
                    const on = pathname === href || pathname.startsWith(`${href}/`);
                    return (
                      <li key={e.key}>
                        <Link
                          href={href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                            on
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
        {[
          { href: "/approvals", label: "Approvals", icon: CheckCheck },
          { href: "/reports", label: "Reports", icon: BarChart3 },
          { href: "/settings", label: "Settings", icon: Settings },
        ].map(({ href, label, icon: I }) => (
          <Link
            key={href}
            href={href}
            className={cn("mb-0.5", row(pathname.startsWith(href)))}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
          >
            <I className="size-4 shrink-0" />
            {!collapsed && label}
          </Link>
        ))}

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cn("mt-1 w-full", row(false))}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose className="size-4 shrink-0" />
                Collapse
              </>
            )}
          </button>
        )}
      </div>
    </nav>
  );
}
