"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Search } from "lucide-react";

import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { entityPath, type ModuleMeta } from "@/lib/meta";
import { t } from "@/lib/i18n";

/**
 * Phone navigation. The drawer holds everything, but reaching a drawer costs a
 * tap and a decision, and on a phone the two or three screens someone actually
 * lives in should be one thumb-press away.
 *
 * The middle slots come from the API's module list rather than a hardcoded pair,
 * so this can never offer a screen the user's role cannot open.
 */
export function BottomNav({
  modules,
  onSearch,
  onMenu,
}: {
  modules: ModuleMeta[];
  onSearch: () => void;
  onMenu: () => void;
}) {
  const pathname = usePathname();

  const shortcuts = modules
    .map((m) => ({ module: m, entity: m.entities[0] }))
    .filter((x) => !!x.entity)
    .slice(0, 2);

  const cell =
    "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors";
  const on = "text-brand";
  const off = "text-muted-foreground hover:text-foreground";

  return (
    <nav
      aria-label="Primary"
      // pb-[env(...)] keeps the row clear of the iOS home indicator, which
      // otherwise sits directly over the right-hand item.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Link href="/" className={cn(cell, pathname === "/" ? on : off)}>
        <LayoutDashboard className="size-5" />
        {t("nav.home")}
      </Link>

      {shortcuts.map(({ module, entity }) => {
        const href = entityPath(entity!.key);
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={module.key} href={href} className={cn(cell, active ? on : off)}>
            <Icon name={entity!.icon} className="size-5" />
            <span className="max-w-full truncate">{entity!.label_plural}</span>
          </Link>
        );
      })}

      <button type="button" onClick={onSearch} className={cn(cell, off)}>
        <Search className="size-5" />
        {t("nav.search")}
      </button>

      <button type="button" onClick={onMenu} className={cn(cell, off)} aria-label={t("nav.openMenu")}>
        <Menu className="size-5" />
        {t("nav.more")}
      </button>
    </nav>
  );
}
