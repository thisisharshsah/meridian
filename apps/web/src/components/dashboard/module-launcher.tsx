"use client";

import Link from "next/link";

import { Icon } from "@/components/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { entityPath, type ModuleMeta } from "@/lib/meta";
import { t } from "@/lib/i18n";

/**
 * An icon launcher for the phone, where the module list is folded away behind
 * a drawer and "CRM" is nine letters that explain nothing.
 *
 * The plain-English line under each name is not new copy: the API has always
 * sent a description for every module and the app threw it away, showing the
 * bare label and, on desktop only, a hover tooltip that a touchscreen can
 * never trigger. This puts it on screen where it answers the question the
 * reader actually has, which is "what is in here".
 */
export function ModuleLauncher({ modules }: { modules: ModuleMeta[] }) {
  const usable = modules.filter((m) => m.entities.length > 0);
  if (!usable.length) return null;

  return (
    <Card className="mb-5 md:hidden">
      <CardHeader className="flex-col items-stretch gap-0">
        <CardTitle>{t("launcher.title")}</CardTitle>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("launcher.lede")}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2">
          {usable.map((m) => (
            <li key={m.key}>
              <Link
                href={entityPath(m.entities[0].key)}
                className="flex h-full min-h-[84px] flex-col gap-1 rounded-md border border-border bg-surface p-3 transition-colors hover:bg-surface-hover"
              >
                <span className="flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                    <Icon name={m.icon} className="size-4" />
                  </span>
                  <span className="truncate text-sm font-medium">{m.label}</span>
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{m.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
