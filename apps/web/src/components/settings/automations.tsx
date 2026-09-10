"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Plus, Trash2, Workflow, Zap } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Icon } from "@/components/icon";
import { FieldRow, FormError } from "@/components/form/field";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { optionsOf, type FieldDef } from "@/lib/meta";
import { useEntityMeta } from "@/lib/queries";
import { plural, t } from "@/lib/i18n";

type Condition = { field: string; op: string; value: string };
type ActionSpec = {
  type: "set_field" | "create_task";
  field?: string;
  value?: string;
  subject?: string;
  due_in_days?: number;
  assign_to?: string;
  priority?: string;
  delay_days?: number;
};

type Automation = {
  id: string;
  name: string;
  description: string | null;
  entity: string;
  trigger: string;
  conditions: { match: string; rules: Condition[] };
  actions: ActionSpec[];
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
  last_error: string | null;
};

type EntityOption = { key: string; label: string; label_plural: string; icon: string };

// Values the API knows; the words beside them come from the catalogue, so a
// trigger reads in the reader's language without the API learning about it.
const TRIGGERS = ["on_create", "on_update", "on_create_or_update"];

const OPS = [
  "eq", "ne", "gt", "gte", "lt", "lte",
  "contains", "is_empty", "is_not_empty", "changed", "changed_to",
];

const NO_VALUE_OPS = ["is_empty", "is_not_empty", "changed"];

/** How often a rule has run, as a sentence the catalogue owns end to end. */
function firedLabel(a: Automation): string {
  if (a.run_count === 0) return t("auto.neverFired");
  const fired = plural("auto.firedCount", a.run_count);
  return a.last_run_at
    ? t("auto.firedLast", undefined, { fired, when: relativeTime(a.last_run_at) })
    : fired;
}

/**
 * Rule list and builder. Every dropdown here is populated from the API's own
 * metadata, so the builder covers whichever entities and fields exist rather
 * than a list maintained in the browser.
 */
export function AutomationsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Automation | null>(null);
  const [creating, setCreating] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "automations"],
    queryFn: () => get<{ data: Automation[]; entities: EntityOption[] }>("settings/automations"),
    enabled: canManage,
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      patch(`settings/automations/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "automations"] }),
    onError: () => toast.error(t("auto.toggleFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`settings/automations/${id}`),
    onSuccess: () => {
      toast.success(t("auto.deleted"));
      qc.invalidateQueries({ queryKey: ["settings", "automations"] });
    },
    onError: () => toast.error(t("auto.deleteFailed")),
  });

  if (!canManage) {
    return (
      <EmptyState
        icon={Workflow}
        title={t("auto.deniedTitle")}
        description={t("auto.deniedBody")}
      />
    );
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full max-w-4xl" />;

  const entityLabel = (key: string) =>
    data.entities.find((e) => e.key === key)?.label_plural ?? key;
  const entityIcon = (key: string) => data.entities.find((e) => e.key === key)?.icon ?? "Workflow";

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("auto.title")}</CardTitle>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t("auto.new")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.data.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={t("auto.emptyTitle")}
              description={t("auto.emptyBody")}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus />
                  {t("auto.new")}
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.data.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 rounded-md bg-surface-muted p-1.5">
                    <Icon name={entityIcon(a.entity)} className="size-3.5 text-muted-foreground" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="text-left text-sm font-medium hover:text-brand"
                    >
                      {a.name}
                    </button>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("auto.summary", undefined, {
                        entity: entityLabel(a.entity),
                        trigger: t(`auto.trigger.${a.trigger}`, a.trigger),
                      })}
                      {" · "}
                      {plural("auto.actionCount", a.actions.length)}
                      {a.actions.some((x) => (x.delay_days ?? 0) > 0) && (
                        <span className="ml-1 text-brand">
                          {" · "}
                          {t("auto.followUp", undefined, {
                            days: Math.max(...a.actions.map((x) => x.delay_days ?? 0)),
                          })}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-subtle-foreground">{firedLabel(a)}</p>
                    {a.last_error && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                        <AlertTriangle className="mt-px size-3 shrink-0" />
                        {a.last_error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge tone={a.is_active ? "success" : "neutral"} dot>
                      {t(a.is_active ? "auto.on" : "auto.off")}
                    </Badge>
                    <Switch
                      checked={a.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: a.id, is_active: v })}
                      aria-label={t(a.is_active ? "auto.toggleOff" : "auto.toggleOn", undefined, {
                        name: a.name,
                      })}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("auto.deleteRule")}
                      onClick={() => remove.mutate(a.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ScheduledWork />

      <p className="text-xs text-muted-foreground">{t("auto.note")}</p>

      <AutomationDialog
        open={creating || !!editing}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
        existing={editing}
        entities={data.entities}
      />
    </div>
  );
}

/**
 * What the queue is holding. Delayed actions live in a table rather than a
 * timer, so this survives a restart — and so it is worth showing.
 */
function ScheduledWork() {
  const { data } = useQuery({
    queryKey: ["settings", "jobs"],
    queryFn: () =>
      get<{
        counts: Record<string, number>;
        upcoming: { id: string; kind: string; run_at: string; attempts: number; last_error: string | null }[];
      }>("settings/jobs"),
    refetchInterval: 30_000,
  });

  const pending = data?.counts.pending ?? 0;
  const failed = data?.counts.failed ?? 0;
  const done = data?.counts.done ?? 0;

  if (!data || (pending === 0 && failed === 0 && done === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("jobs.title")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("jobs.counts", undefined, { waiting: pending, done })}
          {failed > 0 && t("jobs.failed", undefined, { n: failed })}
        </span>
      </CardHeader>
      {data.upcoming.length > 0 && (
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {data.upcoming.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <Clock className="size-3.5 shrink-0 text-subtle-foreground" />
                <span className="flex-1">{t("jobs.followUp")}</span>
                <span className="text-muted-foreground">
                  {t("jobs.runs", undefined, { when: relativeTime(j.run_at) })}
                </span>
                {j.attempts > 1 && (
                  <span className="text-warning-strong">
                    {t("jobs.attempt", undefined, { n: j.attempts })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function AutomationDialog({
  open, onOpenChange, existing, entities,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: Automation | null;
  entities: EntityOption[];
}) {
  const qc = useQueryClient();

  const [name, setName] = React.useState("");
  const [entity, setEntity] = React.useState("");
  const [trigger, setTrigger] = React.useState("on_create_or_update");
  const [match, setMatch] = React.useState("all");
  const [conditions, setConditions] = React.useState<Condition[]>([]);
  const [actions, setActions] = React.useState<ActionSpec[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const { data: meta } = useEntityMeta(entity || undefined);
  const writable = React.useMemo(
    () => (meta?.fields ?? []).filter((f) => !f.readonly),
    [meta],
  );

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    if (existing) {
      setName(existing.name);
      setEntity(existing.entity);
      setTrigger(existing.trigger);
      setMatch(existing.conditions?.match ?? "all");
      setConditions(existing.conditions?.rules ?? []);
      setActions(existing.actions ?? []);
    } else {
      setName("");
      setEntity(entities[0]?.key ?? "");
      setTrigger("on_create_or_update");
      setMatch("all");
      setConditions([]);
      setActions([{ type: "create_task", subject: "", due_in_days: 3, assign_to: "owner" }]);
    }
  }, [open, existing, entities]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      existing
        ? patch(`settings/automations/${existing.id}`, body)
        : post("settings/automations", body),
    onSuccess: () => {
      toast.success(t(existing ? "auto.updated" : "auto.created"));
      qc.invalidateQueries({ queryKey: ["settings", "automations"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError(t("auto.saveFailed"));
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    save.mutate({
      name,
      entity,
      trigger,
      conditions: { match, rules: conditions },
      actions,
      is_active: existing?.is_active ?? true,
    });
  };

  const fieldByName = (n?: string) => writable.find((f) => f.name === n) ?? meta?.fields.find((f) => f.name === n);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t(existing ? "auto.dialogEdit" : "auto.dialogNew")}</DialogTitle>
<DialogDescription>{t("auto.dialogLede")}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <FormError message={formError} />

            <FieldRow label={t("auto.name")} htmlFor="rule-name" error={errors.name} required>
              <Input
                id="rule-name"
                autoFocus
                placeholder={t("auto.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
              />
            </FieldRow>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label={t("auto.entity")} htmlFor="rule-entity" error={errors.entity} required>
                <Select
                  value={entity}
                  onValueChange={(v) => {
                    setEntity(v);
                    // Fields belong to an entity, so a change invalidates both lists.
                    setConditions([]);
                    setActions([{ type: "create_task", subject: "", due_in_days: 3, assign_to: "owner" }]);
                  }}
                >
                  <SelectTrigger id="rule-entity">
                    <SelectValue placeholder={t("auto.choose")} />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.key} value={e.key}>
                        {e.label_plural}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>

              <FieldRow label={t("auto.trigger")} htmlFor="rule-trigger" error={errors.trigger} required>
                <Select value={trigger} onValueChange={setTrigger}>
                  <SelectTrigger id="rule-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(`auto.trigger.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
            </div>

            {/* ------------------------------- conditions ------------------------------- */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
                  {t("auto.conditions")}
                </h4>
                {conditions.length > 1 && (
                  <Select value={match} onValueChange={setMatch}>
                    <SelectTrigger className="h-6 w-auto min-w-0 px-1.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("auto.matchAll")}</SelectItem>
                      <SelectItem value="any">{t("auto.matchAny")}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {conditions.length === 0 && (
                <p className="mb-2 text-xs text-muted-foreground">{t("auto.noConditions")}</p>
              )}

              <div className="space-y-2">
                {conditions.map((c, i) => {
                  const field = fieldByName(c.field);
                  const needsValue = !NO_VALUE_OPS.includes(c.op);
                  return (
                    <div key={i} className="flex items-start gap-2">
                      <Select
                        value={c.field}
                        onValueChange={(v) =>
                          setConditions((s) => s.map((x, j) => (j === i ? { ...x, field: v, value: "" } : x)))
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={t("auto.field")} />
                        </SelectTrigger>
                        <SelectContent>
                          {(meta?.fields ?? []).map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={c.op}
                        onValueChange={(v) =>
                          setConditions((s) => s.map((x, j) => (j === i ? { ...x, op: v } : x)))
                        }
                      >
                        <SelectTrigger className="w-36 shrink-0">
                          <SelectValue placeholder={t("auto.op.eq")} />
                        </SelectTrigger>
                        <SelectContent>
                          {OPS.map((o) => (
                            <SelectItem key={o} value={o}>
                              {t(`auto.op.${o}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {needsValue && (
                        <div className="flex-1">
                          <ConditionValue
                            field={field}
                            value={c.value}
                            onChange={(v) =>
                              setConditions((s) => s.map((x, j) => (j === i ? { ...x, value: v } : x)))
                            }
                          />
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("auto.removeCondition")}
                        onClick={() => setConditions((s) => s.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={!meta}
                onClick={() =>
                  setConditions((s) => [
                    ...s,
                    { field: meta?.fields[0]?.name ?? "", op: "eq", value: "" },
                  ])
                }
              >
                <Plus />
                {t("auto.addCondition")}
              </Button>
            </section>

            {/* --------------------------------- actions -------------------------------- */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
                {t("auto.then")}
              </h4>
              {errors.actions && <p className="mb-2 text-xs text-danger">{errors.actions}</p>}

              <div className="space-y-3">
                {actions.map((a, i) => (
                  <div key={i} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <Select
                        value={a.type}
                        onValueChange={(v) =>
                          setActions((s) =>
                            s.map((x, j) =>
                              j === i
                                ? v === "set_field"
                                  ? { type: "set_field", field: writable[0]?.name, value: "" }
                                  : { type: "create_task", subject: "", due_in_days: 3, assign_to: "owner" }
                                : x,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="set_field">{t("auto.act.set_field")}</SelectItem>
                          <SelectItem value="create_task">{t("auto.act.create_task")}</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label={t("auto.removeAction")}
                        onClick={() => setActions((s) => s.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </div>

                    {a.type === "set_field" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Select
                          value={a.field ?? ""}
                          onValueChange={(v) =>
                            setActions((s) => s.map((x, j) => (j === i ? { ...x, field: v, value: "" } : x)))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("auto.field")} />
                          </SelectTrigger>
                          <SelectContent>
                            {writable.map((f) => (
                              <SelectItem key={f.name} value={f.name}>
                                {f.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <ConditionValue
                          field={fieldByName(a.field)}
                          value={a.value ?? ""}
                          onChange={(v) => setActions((s) => s.map((x, j) => (j === i ? { ...x, value: v } : x)))}
                        />
                        {errors[`actions.${i}.value`] && (
                          <p className="text-xs text-danger sm:col-span-2">{errors[`actions.${i}.value`]}</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          placeholder={t("auto.subjectPlaceholder")}
                          value={a.subject ?? ""}
                          onChange={(e) =>
                            setActions((s) => s.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))
                          }
                        />
                        <div className="grid gap-2 sm:grid-cols-4">
                          {/* Labelled, not just placeheld: three of these four
                              arrive pre-filled, so the placeholder is gone
                              exactly when someone needs to know what the
                              number means. */}
                          <SmallField label={t("auto.waitDays")} htmlFor={`delay-${i}`}>
                          <Input
                            id={`delay-${i}`}
                            type="number"
                            min={0}
                            title={t("auto.waitDaysHelp")}
                            value={a.delay_days ?? ""}
                            onChange={(e) =>
                              setActions((s) =>
                                s.map((x, j) =>
                                  j === i ? { ...x, delay_days: Number(e.target.value) || undefined } : x,
                                ),
                              )
                            }
                          />
                          </SmallField>
                          <SmallField label={t("auto.dueInDays")} htmlFor={`due-${i}`}>
                          <Input
                            id={`due-${i}`}
                            type="number"
                            min={0}
                            value={a.due_in_days ?? ""}
                            onChange={(e) =>
                              setActions((s) =>
                                s.map((x, j) =>
                                  j === i ? { ...x, due_in_days: Number(e.target.value) || 0 } : x,
                                ),
                              )
                            }
                          />
                          </SmallField>
                          <SmallField label={t("auto.assignTo")}>
                          <Select
                            value={a.assign_to ?? "owner"}
                            onValueChange={(v) =>
                              setActions((s) => s.map((x, j) => (j === i ? { ...x, assign_to: v } : x)))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">{t("auto.assignOwner")}</SelectItem>
                              <SelectItem value="actor">{t("auto.assignActor")}</SelectItem>
                            </SelectContent>
                          </Select>
                          </SmallField>
                          <SmallField label={t("auto.priority")}>
                          <Select
                            value={a.priority ?? "normal"}
                            onValueChange={(v) =>
                              setActions((s) => s.map((x, j) => (j === i ? { ...x, priority: v } : x)))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">{t("auto.priority.low")}</SelectItem>
                              <SelectItem value="normal">{t("auto.priority.normal")}</SelectItem>
                              <SelectItem value="high">{t("auto.priority.high")}</SelectItem>
                            </SelectContent>
                          </Select>
                          </SmallField>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() =>
                  setActions((s) => [...s, { type: "create_task", subject: "", due_in_days: 3, assign_to: "owner" }])
                }
              >
                <Plus />
                {t("auto.addAction")}
              </Button>
            </section>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t(existing ? "auto.saveRule" : "auto.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A label above a control, for a row too tight to spend a FieldRow on. */
function SmallField({
  label, htmlFor, children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** A value input shaped by the field it is compared against. */
function ConditionValue({
  field, value, onChange,
}: {
  field: FieldDef | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field?.kind.type === "select") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("auto.value")} />
        </SelectTrigger>
        <SelectContent>
          {optionsOf(field).map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field?.kind.type === "bool") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("auto.value")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t("value.yes")}</SelectItem>
          <SelectItem value="false">{t("value.no")}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const numeric = ["money", "percent", "quantity", "int"].includes(field?.kind.type ?? "");
  return (
    <Input
      inputMode={numeric ? "decimal" : undefined}
      placeholder={numeric ? "0" : t("auto.value")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
