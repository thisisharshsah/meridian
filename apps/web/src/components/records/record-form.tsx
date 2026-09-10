"use client";

import * as React from "react";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldRow, FormError, fieldDescribedBy } from "@/components/form/field";
import { FieldInput } from "@/components/records/field-input";
import { ApiError } from "@/lib/api";
import type { EntityMeta, FieldDef } from "@/lib/meta";
import { useCreate, useUpdate, type Record_ } from "@/lib/queries";
import { t } from "@/lib/i18n";

/**
 * Create/edit dialog generated from the entity metadata. Field-level errors
 * come back from the Rust validator keyed by field name, so server rules and
 * form rules never disagree.
 */
export function RecordForm({
  meta,
  record,
  open,
  onOpenChange,
  defaults,
  onSaved,
}: {
  meta: EntityMeta;
  record?: Record_ | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaults?: Record<string, unknown>;
  onSaved?: (r: Record_) => void;
}) {
  const editing = !!record?.id;
  const create = useCreate(meta.key);
  const update = useUpdate(meta.key);

  const editable = React.useMemo(() => meta.fields.filter((f) => !f.readonly), [meta.fields]);

  // A create dialog can carry twenty-odd fields, and a first-time user cannot
  // tell which two actually matter. Lead with what is required and fold the
  // rest away. Only worth splitting when it genuinely shortens the form, and
  // never when editing, where hiding a filled-in value would be a trap.
  const [primary, secondary] = React.useMemo(() => {
    const required = editable.filter((f) => f.required);
    const rest = editable.filter((f) => !f.required);
    if (editing || required.length === 0 || rest.length < 3) return [editable, []];
    return [required, rest];
  }, [editable, editing]);

  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  // `defaults` is deliberately absent from the dependency list below: every
  // caller passes a freshly allocated object literal, so including it re-runs
  // the effect on any parent re-render and erases whatever has been typed. The
  // latest value is read through a ref instead.
  const defaultsRef = React.useRef(defaults);
  defaultsRef.current = defaults;

  React.useEffect(() => {
    if (!open) return;
    const seed: Record<string, unknown> = {};
    for (const f of editable) {
      seed[f.name] = record
        ? (record[f.name] ?? null)
        : // A new record starts from the caller's defaults (the board column
          // you clicked "Add" in), then the field's own declared default.
          (defaultsRef.current?.[f.name] ?? f.default ?? null);
    }
    setValues(seed);
    setErrors({});
    setFormError(null);
  }, [open, record, editable]);

  const setValue = (name: string, v: unknown) => {
    setValues((s) => ({ ...s, [name]: v }));
    setErrors((e) => (e[name] ? { ...e, [name]: "" } : e));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setErrors({});

    // Send only what the user actually filled in, so unset optional fields
    // fall back to the column defaults rather than being written as null.
    const payload: Record<string, unknown> = {};
    for (const f of editable) {
      const v = values[f.name];
      if (editing) {
        payload[f.name] = v;
      } else if (v !== null && v !== undefined && v !== "") {
        payload[f.name] = v;
      }
    }

    try {
      const saved = editing
        ? await update.mutateAsync({ id: record!.id, body: payload })
        : await create.mutateAsync(payload);
      toast.success(editing ? `${meta.label} updated` : `${meta.label} created`);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        const map = err.fieldMap;
        setErrors(map);
        const named = Object.keys(map);
        // A field error keyed to something this form does not render (a hidden
        // or readonly column) would otherwise highlight nothing and leave the
        // dialog looking as though the click did nothing at all.
        const shown = editable.filter((f) => map[f.name]);
        setFormError(
          named.length === 0
            ? err.message
            : shown.length > 0
              ? "Please fix the highlighted fields below."
              : err.message || "Some details could not be saved.",
        );
        // Long forms scroll: without this the highlighted field can be well
        // below the fold and the user sees no reaction to pressing Create.
        const first = shown[0];
        if (first) {
          requestAnimationFrame(() => {
            const el = document.getElementById(`field-${first.name}`);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
            el?.focus?.();
          });
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  const pending = create.isPending || update.isPending;

  // If the server rejected something that lives in the collapsed half, the
  // disclosure has to be open or the highlight is invisible.
  const hasSecondaryError = secondary.some((f) => errors[f.name]);

  const renderField = (f: FieldDef) => (
    <FieldRow
      key={f.name}
      label={f.label}
      htmlFor={`field-${f.name}`}
      required={f.required}
      error={errors[f.name] || undefined}
      hint={f.help ?? undefined}
      className={spanClass(f)}
    >
      <FieldInput
        field={f}
        value={values[f.name]}
        onChange={(v) => setValue(f.name, v)}
        invalid={!!errors[f.name]}
        entity={meta.key}
        describedBy={fieldDescribedBy(`field-${f.name}`, {
          error: !!errors[f.name],
          hint: !!f.help,
        })}
        label={record?.[`${f.name}__label`] as string | undefined}
      />
    </FieldRow>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${meta.label.toLowerCase()}` : `New ${meta.label.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {editing ? "Update the details below." : `Add a ${meta.label.toLowerCase()} to ${meta.label_plural.toLowerCase()}.`}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <FormError message={formError} />
            <div className="grid gap-4 sm:grid-cols-2">{primary.map(renderField)}</div>

            {secondary.length > 0 && (
              <details className="group mt-4 rounded-md border border-border" open={hasSecondaryError}>
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium marker:content-none">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                    {t("action.moreDetails")}
                    <span className="font-normal text-muted-foreground">
                      {t("action.optionalCount", undefined, { n: secondary.length })}
                    </span>
                  </span>
                </summary>
                <div className="grid gap-4 border-t border-border p-3 sm:grid-cols-2">
                  {secondary.map(renderField)}
                </div>
              </details>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {editing ? t("action.save") : t("action.createOne", undefined, { thing: meta.label.toLowerCase() })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Long text gets the full width; everything else pairs up. */
function spanClass(f: FieldDef) {
  return f.kind.type === "long_text" ? "sm:col-span-2" : undefined;
}
