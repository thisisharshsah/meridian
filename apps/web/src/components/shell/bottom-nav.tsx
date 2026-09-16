"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu } from "lucide-react";

import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { entityPath, type ModuleMeta } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/** The bar holds home, three modules and the rest; anything further is More. */
export const NAV_MODULES = 3;

/**
 * Phone navigation. The drawer holds everything, but reaching a drawer costs a
 * tap and a decision, and on a phone the screens someone actually lives in
 * should be one thumb-press away.
 *
 * Three of the five are this business's own modules, and a module is a page
 * whose entities are its tabs — so Sales lands on leads with accounts, deals
 * and quotes across the top. They come from the API's module list rather than
 * a hardcoded choice, so this can never offer a screen a role cannot open.
 *
 * Search is not here: the topbar carries it at every width, and a third module
 * is worth more than a second way to reach the same box.
 */
export function BottomNav({ modules, onMenu }: { modules: ModuleMeta[]; onMenu: () => void }) {
  const pathname = usePathname();

  const shortcuts = modules.filter((m) => m.entities.length > 0).slice(0, NAV_MODULES);

  const cell =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors";
  const on = "text-brand";
  const off = "text-muted-foreground hover:text-foreground";

  return (
    <nav
      aria-label={t("nav.primary")}
      // The safe-area padding keeps the row clear of the iOS home indicator,
      // which otherwise sits directly over the right-hand item.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Link href="/" className={cn(cell, pathname === "/" ? on : off)}>
        <LayoutDashboard className="size-5" />
        {t("nav.home")}
      </Link>

      {shortcuts.map((m) => {
        const href = entityPath(m.entities[0]!.key);
        const active = pathname.startsWith(`/${m.key}/`);
        return (
          <Link key={m.key} href={href} className={cn(cell, active ? on : off)}>
            <Icon name={m.icon} className="size-5" />
            <span className="max-w-full truncate">{m.label}</span>
          </Link>
        );
      })}

      <button type="button" onClick={onMenu} className={cn(cell, off)} aria-label={t("nav.openMenu")}>
        <Menu className="size-5" />
        {t("nav.more")}
      </button>
    </nav>
  );
}
