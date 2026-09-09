"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Building2, Search } from "lucide-react";

import { Icon } from "@/components/icon";
import { useAppMeta, useGlobalSearch, useSession } from "@/lib/queries";
import { useSwitchWorkspace } from "@/lib/use-workspace";
import { entityPath } from "@/lib/meta";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

/** Cross-module search plus jump-to-screen, on the usual Cmd/Ctrl-K. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 180);

  const { data: meta } = useAppMeta();
  const { data: session } = useSession();
  const { switchTo } = useSwitchWorkspace();
  const { data: results, isFetching } = useGlobalSearch(debounced);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      // Escape closes anything that covers the page. Without it the only way
      // out of a full-screen overlay is finding the dimmed area behind it.
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Put focus back where it was. A keyboard user who opens this with Cmd-K and
  // closes it again should not be returned to the top of the document.
  const restoreTo = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (open) {
      restoreTo.current = document.activeElement as HTMLElement | null;
    } else {
      restoreTo.current?.focus?.();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const screens = (meta?.modules ?? []).flatMap((m) =>
    m.entities.map((e) => ({ ...e, module: m.label })),
  );

  // Filtered rather than hidden. Typing "inv" to reach Invoices used to make
  // the jump list disappear at the second keystroke, which is precisely when
  // it becomes useful -- the list was only ever shown to someone who had not
  // yet said what they wanted.
  const needle = term.trim().toLowerCase();

  // Switching from here is the quickest route there is: Cmd-K, type the name,
  // Enter. Only the ones you are not already in, since "switch to where I
  // already am" is not an offer.
  const others = (session?.organizations ?? []).filter(
    (o) => o.id !== session?.organization?.id && (!needle || o.name.toLowerCase().includes(needle)),
  );
  const jumpTo = (needle
    ? screens.filter((sc) => `${sc.label_plural} ${sc.module}`.toLowerCase().includes(needle))
    : screens
  ).slice(0, needle ? 4 : 12);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label={t("palette.close")}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={() => onOpenChange(false)}
      />
      <Command
        loop
        shouldFilter={false}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.label")}
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-subtle-foreground" />
          <Command.Input
            autoFocus
            value={term}
            onValueChange={setTerm}
            placeholder={t("palette.placeholder")}
            className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
          />
          {isFetching && <span className="text-xs text-subtle-foreground">…</span>}
        </div>

        <Command.List className="max-h-[55vh] overflow-y-auto p-1.5 scrollbar-thin">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
            {debounced.length >= 2 ? t("palette.nothing") : t("palette.hint")}
          </Command.Empty>

          {others.length > 0 && (
            <Command.Group
              heading={
                <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {t("workspace.switch")}
                </span>
              }
            >
              {others.map((o) => (
                <Command.Item
                  key={o.id}
                  value={`switch-${o.id}`}
                  onSelect={() => {
                    onOpenChange(false);
                    switchTo(o.id);
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-surface-hover"
                >
                  <Building2 className="size-4 text-subtle-foreground" />
                  <span className="truncate">{o.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {jumpTo.length > 0 && (
            <Command.Group
              heading={
                <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {t("palette.goTo")}
                </span>
              }
            >
              {jumpTo.map((s) => (
                <Command.Item
                  key={s.key}
                  value={s.key}
                  onSelect={() => go(entityPath(s.key))}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-surface-hover"
                >
                  <Icon name={s.icon} className="size-4 text-subtle-foreground" />
                  {s.label_plural}
                  <span className="ml-auto text-xs text-subtle-foreground">{s.module}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {(results?.groups ?? []).map((g) => (
            <Command.Group
              key={g.entity}
              heading={
                <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {g.label}
                </span>
              }
            >
              {g.items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${g.entity}-${item.id}`}
                  onSelect={() => go(`${entityPath(g.entity)}/${item.id}`)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                    "data-[selected=true]:bg-surface-hover",
                  )}
                >
                  <Icon name={g.icon} className="size-4 text-subtle-foreground" />
                  <span className="truncate">{item.title || "Untitled"}</span>
                </Command.Item>
              ))}
              {g.total > g.items.length && (
                <Command.Item
                  value={`more-${g.entity}`}
                  onSelect={() => go(`${entityPath(g.entity)}?q=${encodeURIComponent(debounced)}`)}
                  className="cursor-pointer rounded-md px-2.5 py-1.5 text-xs text-brand data-[selected=true]:bg-surface-hover"
                >
                  See all {g.total} in {g.label}
                </Command.Item>
              )}
            </Command.Group>
          ))}

        </Command.List>
      </Command>
    </div>
  );
}

function useDebounced<T>(value: T, delay: number) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
