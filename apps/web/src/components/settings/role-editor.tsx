"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Icon } from "@/components/icon";
import { FieldRow, FormError } from "@/components/form/field";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type Role = {
  id: string; key: string; name: string; description: string | null;
  permissions: string[]; is_system: boolean; member_count: number;
};

type CatalogEntity = {
  key: string; label: string; icon: string;
  grants: { view: string; create: string; edit: string; delete: string; all: string };
};

type CatalogModule = {
  key: string; label: string; icon: string;
  entities: CatalogEntity[];
  grants: { all: string; view: string };
};

type Catalog = { modules: CatalogModule[]; actions: string[]; everything: string };

const ACTIONS = ["view", "create", "edit", "delete"] as const;
type ActionName = (typeof ACTIONS)[number];

/**
 * Roles and the permission matrix that defines them.
 *
 * The matrix is built from the API's permission catalogue, which the server
 * derives from its entity registry — so it offers exactly the grants the
 * permission checker understands, and a new module appears here on its own.
 */
export function RolesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Role | null>(null);
  const [cloning, setCloning] = React.useState<Role | null>(null);
  const [creating, setCreating] = React.useState(false);

  const roles = useQuery({
    queryKey: ["settings", "roles"],
    queryFn: () => get<{ data: Role[] }>("settings/roles"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`settings/roles/${id}`),
    onSuccess: () => {
      toast.success(t("role.deleted"));
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t("role.deleteFailed")),
  });

  if (roles.isLoading || !roles.data) return <Skeleton className="h-64 w-full max-w-5xl" />;

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("role.title")}</CardTitle>
          {canManage && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t("role.new")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {roles.data.data.map((role) => (
              <li key={role.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 rounded-md bg-surface-muted p-1.5">
                  {role.is_system ? (
                    <Lock className="size-3.5 text-muted-foreground" />
                  ) : (
                    <KeyRound className="size-3.5 text-muted-foreground" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {role.name}
                    {role.is_system && <Badge tone="neutral">{t("role.builtIn")}</Badge>}
                    <span className="text-xs font-normal text-muted-foreground">
                      {role.member_count} member{role.member_count === 1 ? "" : "s"}
                    </span>
                  </p>
                  {role.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
                  )}
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {role.permissions.slice(0, 8).map((p) => (
                      <li
                        key={p}
                        className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {p === "*" ? (
                          <span className="flex items-center gap-1 text-brand">
                            <Check className="size-3" />
                            everything
                          </span>
                        ) : (
                          p
                        )}
                      </li>
                    ))}
                    {role.permissions.length > 8 && (
                      <li className="px-1 text-[11px] text-subtle-foreground">
                        +{role.permissions.length - 8} more
                      </li>
                    )}
                  </ul>
                </div>

                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Duplicate ${role.name}`}
                      title={t("role.duplicate")}
                      onClick={() => setCloning(role)}
                    >
                      <Copy />
                    </Button>
                    {!role.is_system && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${role.name}`}
                          onClick={() => setEditing(role)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${role.name}`}
                          onClick={() => remove.mutate(role.id)}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {canManage && (
        <p className="text-xs text-muted-foreground">
          Built-in roles cannot be changed, so a role somebody already holds never shifts meaning
          underneath them. Duplicate one to start from its permissions.
        </p>
      )}

      <RoleDialog
        open={creating || !!editing || !!cloning}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
            setCloning(null);
          }
        }}
        existing={editing}
        cloneOf={cloning}
      />
    </div>
  );
}

function RoleDialog({
  open, onOpenChange, existing, cloneOf,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: Role | null;
  cloneOf: Role | null;
}) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["settings", "permissions"],
    queryFn: () => get<Catalog>("settings/permissions"),
    enabled: open,
  });

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [granted, setGranted] = React.useState<Set<string>>(new Set());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    const source = existing ?? cloneOf;
    setName(cloneOf ? `${cloneOf.name} (copy)` : (existing?.name ?? ""));
    setDescription(source?.description ?? "");
    setGranted(new Set(source?.permissions ?? []));
  }, [open, existing, cloneOf]);

  /**
   * Does the current grant set allow `action` on `entity`?
   * Mirrors the server's matcher, so a checkbox shows what the API would decide
   * rather than only what was literally stored.
   */
  const allows = React.useCallback(
    (entityKey: string, action: ActionName) => {
      if (granted.has("*")) return true;
      if (granted.has(`${entityKey}.${action}`)) return true;
      if (granted.has(`${entityKey}.*`)) return true;
      const module = entityKey.split(".")[0];
      if (granted.has(`${module}.*`)) return true;
      if (granted.has(`${module}.*.${action}`)) return true;
      return false;
    },
    [granted],
  );

  /**
   * Toggling writes explicit `entity.action` grants and drops the broad ones it
   * would contradict — otherwise unchecking a box under a `module.*` grant
   * would appear to do nothing.
   */
  /**
   * Expand every wildcard that covers *anything* into explicit grants, then
   * apply the one change.
   *
   * The subtlety: a broad grant like `crm.*` or `crm.*.view` covers sibling
   * entities too. Deleting it and re-expanding only the entity that was
   * clicked silently revokes the action everywhere else in that module — the
   * screen shows one box changing while several others quietly turn off.
   */
  const expandAll = (prev: Set<string>): Set<string> => {
    const next = new Set(prev);
    const modules = catalog.data?.modules ?? [];
    const everything = prev.has("*");

    for (const m of modules) {
      const moduleAll = everything || prev.has(`${m.key}.*`);
      for (const e of m.entities) {
        const entityAll = moduleAll || prev.has(`${e.key}.*`);
        for (const a of ACTIONS) {
          if (entityAll || prev.has(`${m.key}.*.${a}`) || prev.has(`${e.key}.${a}`)) {
            next.add(`${e.key}.${a}`);
          }
        }
      }
      next.delete(`${m.key}.*`);
      for (const a of ACTIONS) next.delete(`${m.key}.*.${a}`);
      for (const e of m.entities) next.delete(`${e.key}.*`);
    }
    next.delete("*");
    return next;
  };

  const toggle = (entityKey: string, action: ActionName, on: boolean) => {
    setGranted((prev) => {
      const next = expandAll(prev);
      if (on) next.add(`${entityKey}.${action}`);
      else next.delete(`${entityKey}.${action}`);
      return next;
    });
  };

  const toggleEntity = (entity: CatalogEntity, on: boolean) => {
    for (const a of ACTIONS) toggle(entity.key, a, on);
  };

  const toggleModule = (module: CatalogModule, on: boolean) => {
    setGranted((prev) => {
      // Same expansion first. Clearing a module while the role holds `*` would
      // otherwise drop `*` and grant nothing back, wiping every other module.
      const next = expandAll(prev);
      for (const e of module.entities) {
        for (const a of ACTIONS) {
          if (on) next.add(`${e.key}.${a}`);
          else next.delete(`${e.key}.${a}`);
        }
      }
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || undefined, permissions: compact(granted, catalog.data) };
      return existing ? patch(`settings/roles/${existing.id}`, body) : post("settings/roles", body);
    },
    onSuccess: () => {
      toast.success(t(existing ? "role.updated" : "role.created"));
      qc.invalidateQueries({ queryKey: ["settings"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError("Could not save that role");
      }
    },
  });

  const grantCount = compact(granted, catalog.data).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            setFormError(null);
            save.mutate();
          }}
          className="flex min-h-0 flex-col"
        >
          <DialogHeader>
            <DialogTitle>
              {existing
                ? t("role.edit")
                : cloneOf
                  ? t("role.duplicateOf", undefined, { name: cloneOf.name })
                  : t("role.new")}
            </DialogTitle>
            <DialogDescription>
              Tick what this role may do. Everything here comes from the modules actually installed.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={formError} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label={t("role.name")} htmlFor="role-name" error={errors.name} required>
                <Input
                  id="role-name"
                  autoFocus
                  placeholder={t("role.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={!!errors.name}
                />
              </FieldRow>
              <FieldRow label={t("role.description")} htmlFor="role-desc">
                <Input
                  id="role-desc"
                  placeholder={t("role.descriptionPlaceholder")}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FieldRow>
            </div>

            {errors.permissions && (
              <p className="text-xs text-danger">{errors.permissions}</p>
            )}

            {catalog.isLoading || !catalog.data ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-muted">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        {t("role.records")}
                      </th>
                      {ACTIONS.map((a) => (
                        <th
                          key={a}
                          className="w-20 px-2 py-2 text-center text-xs font-medium capitalize text-muted-foreground"
                        >
                          {a}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catalog.data.modules.map((m) => {
                      const everything = m.entities.every((e) =>
                        ACTIONS.every((a) => allows(e.key, a)),
                      );
                      return (
                        <React.Fragment key={m.key}>
                          <tr className="border-b border-border bg-surface-muted/50">
                            <td className="px-3 py-1.5">
                              <span className="flex items-center gap-2 text-xs font-semibold">
                                <Icon name={m.icon} className="size-3.5 text-muted-foreground" />
                                {m.label}
                              </span>
                            </td>
                            <td colSpan={4} className="px-2 py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => toggleModule(m, !everything)}
                                className="text-xs text-brand hover:underline"
                              >
                                {t(everything ? "role.clearModule" : "role.grantEverything")}
                              </button>
                            </td>
                          </tr>

                          {m.entities.map((e) => (
                            <tr key={e.key} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5">
                                <span className="flex items-center gap-2 pl-4">
                                  <Icon name={e.icon} className="size-3.5 opacity-60" />
                                  {e.label}
                                </span>
                              </td>
                              {ACTIONS.map((a) => (
                                <td key={a} className="px-2 py-1.5 text-center">
                                  <Checkbox
                                    checked={allows(e.key, a)}
                                    onCheckedChange={(v) => toggle(e.key, a, v === true)}
                                    aria-label={`${a} ${e.label}`}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <span className="mr-auto text-xs text-muted-foreground">
              {grantCount} grant{grantCount === 1 ? "" : "s"}
            </span>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!grantCount}>
              {t(existing ? "role.save" : "role.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Collapse explicit grants back into the shortest equivalent set, so a role
 * that can do everything to invoices stores `books.invoices.*` rather than four
 * separate lines. Purely cosmetic — the checker treats both the same.
 */
function compact(granted: Set<string>, catalog: Catalog | undefined): string[] {
  if (granted.has("*")) return ["*"];
  if (!catalog) return [...granted];

  const out = new Set<string>();

  // The matrix only renders entities the catalogue lists, so anything granted
  // outside it — an embedded entity, or a grant written before a module was
  // hidden — has to be carried through untouched. Rebuilding purely from the
  // visible rows would silently revoke it on the next save.
  const visible = new Set(catalog.modules.flatMap((m) => m.entities.map((e) => e.key)));
  const visibleModules = new Set(catalog.modules.map((m) => m.key));
  for (const g of granted) {
    const target = g
      .replace(/\.(view|create|edit|delete)$/, "")
      .replace(/\.\*$/, "");
    if (!visible.has(target) && !visibleModules.has(target)) out.add(g);
  }

  for (const m of catalog.modules) {
    const entityStates = m.entities.map((e) => ({
      key: e.key,
      actions: ACTIONS.filter(
        (a) =>
          granted.has(`${e.key}.${a}`) ||
          granted.has(`${e.key}.*`) ||
          granted.has(`${m.key}.*`) ||
          granted.has(`${m.key}.*.${a}`),
      ),
    }));

    const full = entityStates.filter((e) => e.actions.length === ACTIONS.length);
    if (full.length === m.entities.length && m.entities.length > 0) {
      out.add(`${m.key}.*`);
      continue;
    }

    for (const e of entityStates) {
      if (e.actions.length === ACTIONS.length) out.add(`${e.key}.*`);
      else for (const a of e.actions) out.add(`${e.key}.${a}`);
    }
  }

  return [...out].sort();
}
