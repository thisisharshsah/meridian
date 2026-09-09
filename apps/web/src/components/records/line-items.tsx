"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { FieldInput } from "@/components/records/field-input";
import { RefPicker } from "@/components/records/ref-picker";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { ChildDef, EntityMeta, FieldDef } from "@/lib/meta";
import { useCreate, useDelete, useEntityMeta, useList, useUpdate, type Record_ } from "@/lib/queries";
import { LoadError } from "@/components/records/load-error";

const EDITABLE = ["description", "quantity", "unit_price", "discount_percent", "tax_rate"];

/**
 * Inline editor for a document's line items. Each cell writes straight to the
 * API on blur; the server recomputes the line and the document totals, and the
 * refreshed values come back through the invalidated queries — so the numbers
 * on screen are always the server's, never the browser's arithmetic.
 */
export function LineItems({
  parent,
  parentId,
  child,
  currency,
}: {
  parent: EntityMeta;
  parentId: string;
  child: ChildDef;
  currency: string;
}) {
  const { data: meta } = useEntityMeta(child.entity);
  const { data, isLoading, isError, error, refetch } = useList(child.entity, {
    [child.foreign_key]: parentId,
    per_page: 200,
    sort: "sort_order",
  });

  const create = useCreate(child.entity);
  const update = useUpdate(child.entity);
  const remove = useDelete(child.entity);

  if (isError) {
    return <LoadError what={meta?.label_plural.toLowerCase() ?? "lines"} error={error} onRetry={() => refetch()} />;
  }

  if (!meta || isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  const columns = EDITABLE.map((n) => meta.fields.find((f) => f.name === n)).filter(
    (f): f is FieldDef => !!f,
  );
  const itemField = meta.fields.find((f) => f.name === "item_id");
  const rows = data?.data ?? [];
  const canEdit = meta.permissions.edit && parent.permissions.edit;

  const addRow = async () => {
    try {
      await create.mutateAsync({
        [child.foreign_key]: parentId,
        description: "New line",
        quantity: "1",
        unit_price: "0",
        sort_order: rows.length,
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not add a line");
    }
  };

  const saveCell = async (row: Record_, name: string, value: unknown) => {
    if (row[name] === value) return;
    try {
      await update.mutateAsync({ id: row.id, body: { [name]: value } });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save that change");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{child.label}</CardTitle>
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={addRow} loading={create.isPending}>
            <Plus />
            Add line
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState
            title="No lines yet"
            description="Add the products or services this document covers."
            action={
              canEdit ? (
                <Button variant="primary" size="sm" onClick={addRow}>
                  <Plus />
                  Add line
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {itemField && <TH className="w-44">Item</TH>}
                {columns.map((f) => (
                  <TH key={f.name} className={numericHeader(f)}>
                    {f.label}
                  </TH>
                ))}
                <TH className="w-28 text-right">Amount</TH>
                {canEdit && <TH className="w-9" />}
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id} className="hover:bg-transparent">
                  {itemField && (
                    <TD>
                      {canEdit ? (
                        <RefPicker
                          entity="inventory.items"
                          value={(row.item_id as string) ?? null}
                          onChange={(v) => saveCell(row, "item_id", v)}
                        />
                      ) : (
                        <span className="text-sm">{(row.item_id__label as string) ?? "—"}</span>
                      )}
                    </TD>
                  )}

                  {columns.map((f) => (
                    <TD key={f.name} className={cellWidth(f)}>
                      {canEdit ? (
                        <CellEditor field={f} row={row} onSave={saveCell} />
                      ) : (
                        <span className="text-sm tnum">{String(row[f.name] ?? "—")}</span>
                      )}
                    </TD>
                  ))}

                  <TD className="text-right font-medium tnum">
                    {formatMoney(row.line_total as number, currency)}
                  </TD>

                  {canEdit && (
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove line"
                        onClick={() => remove.mutate(row.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Holds the edit locally and commits on blur, so a keystroke does not become a
 * request and the caret never jumps mid-word.
 */
function CellEditor({
  field,
  row,
  onSave,
}: {
  field: FieldDef;
  row: Record_;
  onSave: (row: Record_, name: string, value: unknown) => void;
}) {
  const [draft, setDraft] = React.useState<unknown>(row[field.name]);

  React.useEffect(() => {
    setDraft(row[field.name]);
  }, [row, field.name]);

  return (
    <div
      onBlur={() => onSave(row, field.name, draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
      }}
    >
      <FieldInput field={field} value={draft} onChange={setDraft} />
    </div>
  );
}

function numericHeader(f: FieldDef) {
  return ["quantity", "unit_price", "discount_percent", "tax_rate"].includes(f.name) ? "w-28" : "";
}

function cellWidth(f: FieldDef) {
  return f.name === "description" ? "min-w-[12rem]" : "w-28";
}
