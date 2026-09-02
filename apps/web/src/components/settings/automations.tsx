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

const TRIGGERS = [
  { value: "on_create", label: "a record is created" },
  { value: "on_update", label: "a record is updated" },
  { value: "on_create_or_update", label: "a record is created or updated" },
];

const OPS = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "contains", label: "contains" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "changed", label: "changed" },
  { value: "changed_to", label: "changed to" },
];

const NO_VALUE_OPS = ["is_empty", "is_not_empty", "changed"];

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
    onError: () => toast.error("Could not change that rule"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`settings/automations/${id}`),
    onSuccess: () => {
      toast.success("Rule deleted");
      qc.invalidateQueries({ queryKey: ["settings", "automations"] });
    },
    onError: () => toast.error("Could not delete that rule"),
  });

  if (!canManage) {
    return (
      <EmptyState
        icon={Workflow}
        title="Only an owner can manage automation"
        description="Ask an owner of this workspace to set up rules."
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
          <CardTitle>Automation rules</CardTitle>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New rule
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.data.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No rules yet"
              description="Set a field, or open a task, whenever a record meets conditions you choose."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus />
                  New rule
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
                      On {entityLabel(a.entity)} · when{" "}
                      {TRIGGERS.find((t) => t.value === a.trigger)?.label ?? a.trigger} ·{" "}
                      {a.actions.length} action{a.actions.length === 1 ? "" : "s"}
                      {a.actions.some((x) => (x.delay_days ?? 0) > 0) && (
                        <span className="ml-1 text-brand">
                          · {Math.max(...a.actions.map((x) => x.delay_days ?? 0))}-day follow-up
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-subtle-foreground">
                      {a.run_count === 0
                        ? "Not fired yet"
                        : `Fired ${a.run_count} time${a.run_count === 1 ? "" : "s"}${
                            a.last_run_at ? `, last ${relativeTime(a.last_run_at)}` : ""
                          }`}
                    </p>
                    {a.last_error && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                        <AlertTriangle className="mt-px size-3 shrink-0" />
                        {a.last_error}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge tone={a.is_active ? "success" : "neutral"} dot>
                      {a.is_active ? "On" : "Off"}
                    </Badge>
                    <Switch
                      checked={a.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: a.id, is_active: v })}
                      aria-label={`Turn ${a.name} ${a.is_active ? "off" : "on"}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete rule"
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

      <p className="text-xs text-muted-foreground">
        Rules run once, on the write that triggered them. A field a rule sets does not fire further
        rules, which is what keeps two rules from triggering each other forever.
      </p>

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
        <CardTitle>Scheduled work</CardTitle>
        <span className="text-xs text-muted-foreground">
          {pending} waiting · {done} completed
          {failed > 0 ? ` · ${failed} failed` : ""}
        </span>
      </CardHeader>
      {data.upcoming.length > 0 && (
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {data.upcoming.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <Clock className="size-3.5 shrink-0 text-subtle-foreground" />
                <span className="flex-1">Follow-up action</span>
                <span className="text-muted-foreground">runs {relativeTime(j.run_at)}</span>
                {j.attempts > 1 && (
                  <span className="text-warning">attempt {j.attempts}</span>
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
      toast.success(existing ? "Rule updated" : "Rule created");
      qc.invalidateQueries({ queryKey: ["settings", "automations"] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError("Could not save that rule");
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
            <DialogTitle>{existing ? "Edit rule" : "New automation rule"}</DialogTitle>
            <DialogDescription>
              When something happens to a record and your conditions hold, run these actions.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <FormError message={formError} />

            <FieldRow label="Rule name" htmlFor="rule-name" error={errors.name} required>
              <Input
                id="rule-name"
                autoFocus
                placeholder="Won deal handover"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
              />
            </FieldRow>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Record type" htmlFor="rule-entity" error={errors.entity} required>
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
                    <SelectValue placeholder="Choose" />
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

              <FieldRow label="Run when" htmlFor="rule-trigger" error={errors.trigger} required>
                <Select value={trigger} onValueChange={setTrigger}>
                  <SelectTrigger id="rule-trigger">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
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
                  Conditions
                </h4>
                {conditions.length > 1 && (
                  <Select value={match} onValueChange={setMatch}>
                    <SelectTrigger className="h-6 w-auto min-w-0 px-1.5 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">match all</SelectItem>
                      <SelectItem value="any">match any</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {conditions.length === 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  No conditions — the rule runs on every matching write.
                </p>
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
                          <SelectValue placeholder="Field" />
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
                          <SelectValue placeholder="is" />
                        </SelectTrigger>
                        <SelectContent>
                          {OPS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
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
                        aria-label="Remove condition"
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
                Add condition
              </Button>
            </section>

            {/* --------------------------------- actions -------------------------------- */}
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
                Then
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
                          <SelectItem value="set_field">Set a field</SelectItem>
                          <SelectItem value="create_task">Create a task</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto"
                        aria-label="Remove action"
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
                            <SelectValue placeholder="Field" />
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
                          placeholder="Task subject — use {{name}} to include the record"
                          value={a.subject ?? ""}
                          onChange={(e) =>
                            setActions((s) => s.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)))
                          }
                        />
                        <div className="grid gap-2 sm:grid-cols-4">
                          <Input
                            type="number"
                            min={0}
                            placeholder="Wait days"
                            title="Wait this many days before creating the task. The rule's conditions are re-checked then."
                            value={a.delay_days ?? ""}
                            onChange={(e) =>
                              setActions((s) =>
                                s.map((x, j) =>
                                  j === i ? { ...x, delay_days: Number(e.target.value) || undefined } : x,
                                ),
                              )
                            }
                          />
                          <Input
                            type="number"
                            min={0}
                            placeholder="Due in days"
                            value={a.due_in_days ?? ""}
                            onChange={(e) =>
                              setActions((s) =>
                                s.map((x, j) =>
                                  j === i ? { ...x, due_in_days: Number(e.target.value) || 0 } : x,
                                ),
                              )
                            }
                          />
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
                              <SelectItem value="owner">The record owner</SelectItem>
                              <SelectItem value="actor">Whoever made the change</SelectItem>
                            </SelectContent>
                          </Select>
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
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
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
                Add action
              </Button>
            </section>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {existing ? "Save rule" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <SelectValue placeholder="Value" />
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
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const numeric = ["money", "percent", "quantity", "int"].includes(field?.kind.type ?? "");
  return (
    <Input
      inputMode={numeric ? "decimal" : undefined}
      placeholder={numeric ? "0" : "Value"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
