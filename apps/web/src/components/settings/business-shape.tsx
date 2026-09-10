"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Icon } from "@/components/icon";
import { get, put } from "@/lib/api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type ModuleRow = {
  key: string;
  label: string;
  icon: string;
  description: string;
  /** Part of the package this workspace was sold. */
  licensed: boolean;
  in_use: boolean;
};
type TypeRow = { key: string; label: string; description: string; icon: string; modules: string[] };

export type Shape = {
  modules: ModuleRow[];
  business_types: TypeRow[];
  business_type: string;
  /** The package this workspace is on. */
  edition: { key: string; name: string; description: string };
  can_edit: boolean;
};

export function useBusinessShape() {
  return useQuery({
    queryKey: ["settings", "modules"],
    queryFn: () => get<Shape>("settings/modules"),
  });
}

/**
 * Saving the shape of a workspace: which parts of the suite it shows.
 *
 * Sent as the whole set rather than one toggle at a time, so what the screen
 * shows and what the server holds are the same thing after one round trip
 * even if two people are editing.
 */
export function useSaveShape(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { modules: string[]; business_type?: string }) =>
      put("settings/modules", body),
    onSuccess: () => {
      // The sidebar is built from `meta`, so it has to be refetched or the
      // change does not appear until the next full load.
      qc.invalidateQueries({ queryKey: ["meta"] });
      qc.invalidateQueries({ queryKey: ["settings", "modules"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("shape.saved"));
      onDone?.();
    },
    onError: () => toast.error(t("shape.failed")),
  });
}

/**
 * The one-time question, shown on the home page until it is answered.
 *
 * Asked here rather than on the signup form: signup is where friction costs
 * the most, and this is a question about the business rather than about the
 * account. Answering it is optional — the whole suite is a perfectly good
 * answer, and it is what happens if this card is ignored forever.
 */
export function BusinessShapePrompt() {
  const { data } = useBusinessShape();
  const save = useSaveShape();
  const [hidden, setHidden] = React.useState(false);

  if (!data || !data.can_edit || data.business_type !== "general" || hidden) return null;

  const choose = (type: TypeRow) => {
    setHidden(true);
    save.mutate({
      // An empty preset means the whole suite, which is what every module is.
      modules: type.modules.length ? type.modules : data.modules.map((m) => m.key),
      business_type: type.key,
    });
  };

  return (
    <Card className="mb-5 border-brand/30 bg-brand-subtle/30">
      <CardHeader className="flex-col items-stretch gap-0">
        <CardTitle>{t("shape.promptTitle")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t("shape.promptLede")}</p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.business_types
            .filter((b) => b.key !== "general")
            .map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => choose(b)}
                className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-brand hover:bg-brand-subtle/40"
              >
                <Icon name={b.icon} className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{b.label}</span>
                  <span className="block text-xs text-muted-foreground">{b.description}</span>
                </span>
              </button>
            ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t("shape.changeable")}</p>
          <Button variant="ghost" size="sm" onClick={() => setHidden(true)}>
            {t("shape.showAll")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** The same choice, kept somewhere it can be changed. */
export function BusinessShapeTab() {
  const { data, isLoading } = useBusinessShape();
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const save = useSaveShape(() => setPicked(null));

  if (isLoading || !data) return <Skeleton className="h-64 w-full max-w-3xl" />;
  if (!data.can_edit) {
    return (
      <EmptyState
        icon={Check}
        title={t("shape.deniedTitle")}
        description={t("shape.deniedBody")}
      />
    );
  }

  const current = picked ?? data.modules.filter((m) => m.in_use).map((m) => m.key);
  const dirty = picked !== null;
  const toggle = (key: string) =>
    setPicked(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  const extras = data.modules.filter((m) => !m.licensed);

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader className="flex-col items-stretch gap-0">
          <CardTitle>{t("shape.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("shape.lede")}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("shape.onPackage", undefined, { product: data.edition.name })}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {data.modules.filter((m) => m.licensed).map((m) => (
              <li key={m.key} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-md bg-surface-muted p-1.5">
                  <Icon name={m.icon} className="size-3.5 text-muted-foreground" />
                </span>
                <label htmlFor={`mod-${m.key}`} className="min-w-0 flex-1 cursor-pointer">
                  {/* The catalogue renames several of these -- "Recruit" is
                      "Hiring" in the sidebar -- and the switch has to agree
                      with the menu it controls. */}
                  <span className="block text-sm font-medium">
                    {t(`module.${m.key}`, m.label)}
                  </span>
                  <span className="block text-xs text-muted-foreground">{m.description}</span>
                </label>
                <Switch
                  id={`mod-${m.key}`}
                  checked={current.includes(m.key)}
                  onCheckedChange={() => toggle(m.key)}
                  aria-label={t(`module.${m.key}`, m.label)}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Shown, not hidden: someone deciding whether to buy more should be
          able to see what more there is, and who to ask. */}
      {extras.length > 0 && (
        <Card>
          <CardHeader className="flex-col items-stretch gap-0">
            <CardTitle>{t("shape.notIncluded")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("shape.notIncludedWhy", undefined, { product: data.edition.name })}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {extras.map((m) => (
                <li key={m.key} className="flex items-start gap-3 px-4 py-3 opacity-60">
                  <span className="mt-0.5 rounded-md bg-surface-muted p-1.5">
                    <Icon name={m.icon} className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {t(`module.${m.key}`, m.label)}
                    </span>
                    <span className="block text-xs text-muted-foreground">{m.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={!dirty || current.length === 0}
          loading={save.isPending}
          onClick={() => save.mutate({ modules: current })}
        >
          {t("action.save")}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setPicked(null)}>
            {t("action.cancel")}
          </Button>
        )}
        <p className={cn("text-xs", current.length === 0 ? "text-danger" : "text-muted-foreground")}>
          {current.length === 0 ? t("shape.needOne") : t("shape.note")}
        </p>
      </div>
    </div>
  );
}
