"use client";

import Link from "next/link";

import { useAppMeta } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { entityPath } from "@suite/shared/meta";

/**
 * The rest of the module, across the top — on a phone only.
 *
 * A wide screen has the sidebar, which shows every module and every entity at
 * once. A narrow one had a bottom bar and a drawer, so crossing from leads to
 * deals meant opening a menu to move between two things that belong to the
 * same module. The module is the page and its entities are its tabs, which is
 * the shape the phone app uses too.
 *
 * The tabs come from the registry, already narrowed to what this business uses
 * and what this person may open, so nothing here names an entity. A module
 * with one entity has nothing to offer and draws nothing.
 */
export function EntityTabs({ entityKey }: { entityKey: string }) {
  const meta = useAppMeta();
  const module = meta.data?.modules.find((m) => m.entities.some((e) => e.key === entityKey));
  const tabs = module?.entities ?? [];
  if (tabs.length < 2) return null;

  return (
    <nav
      aria-label={module?.label}
      className="-mx-4 mb-3 flex gap-1 overflow-x-auto border-b border-border px-4 md:hidden"
    >
      {tabs.map((e) => {
        const on = e.key === entityKey;
        return (
          <Link
            key={e.key}
            href={entityPath(e.key)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-2 py-2.5 text-sm transition-colors",
              on
                ? "border-brand font-semibold text-brand"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {e.label_plural}
          </Link>
        );
      })}
    </nav>
  );
}
