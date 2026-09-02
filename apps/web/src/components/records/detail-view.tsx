"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Icon, iconFor } from "@/components/icon";
import { FieldValue } from "@/components/records/field-value";
import { RecordForm } from "@/components/records/record-form";
import { Timeline } from "@/components/records/timeline";
import { LineItems } from "@/components/records/line-items";
import { RecordActions } from "@/components/records/record-actions";
import { ListView } from "@/components/records/list-view";
import { entityPath, type EntityMeta, type FieldDef } from "@/lib/meta";
import { useDelete, useEntityMeta, useRecord, useSession } from "@/lib/queries";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Record page: a header with the identifying fields, the full field list, the
 * document's own line items where it has them, related lists, and the history.
 */
export function DetailView({ meta, id }: { meta: EntityMeta; id: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const currency = session?.organization.currency ?? "USD";

  const { data: record, isLoading, isError } = useRecord(meta.key, id);
  const remove = useDelete(meta.key);
  const [editing, setEditing] = React.useState(false);

  const inlineChild = meta.children.find((c) => c.inline);
  const relatedChildren = meta.children.filter((c) => !c.inline);

  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !record) {
    return (
      <div className="p-5">
        <EmptyState
          icon={iconFor(meta.icon)}
          title={`${meta.label} not found`}
          description="It may have been deleted, or you may not have access to it."
          action={
            <Button variant="secondary" asChild>
              <Link href={entityPath(meta.key)}>Back to {meta.label_plural.toLowerCase()}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const title = (record[meta.title_field] as string) || "Untitled";
  const headline = headlineFields(meta);
  const detailFields = meta.fields.filter((f) => !headline.includes(f));

  const onDelete = async () => {
    try {
      await remove.mutateAsync(id);
      toast.success(`${meta.label} deleted`);
      router.push(entityPath(meta.key));
    } catch {
      toast.error("Could not delete this record");
    }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" asChild aria-label={`Back to ${meta.label_plural}`}>
          <Link href={entityPath(meta.key)}>
            <ArrowLeft />
          </Link>
        </Button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name={meta.icon} className="size-3.5" />
            <Link href={entityPath(meta.key)} className="hover:text-foreground">
              {meta.label_plural}
            </Link>
          </div>
          <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">{title}</h1>

          {headline.length > 0 && (
            <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              {headline.map((f) => (
                <div key={f.name} className="flex items-center gap-1.5">
                  <dt className="text-xs text-subtle-foreground">{f.label}</dt>
                  <dd>
                    <FieldValue field={f} record={record} currency={currency} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="flex gap-2">
          <RecordActions meta={meta} record={record} currency={currency} />
          {meta.permissions.edit && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )}
          {meta.permissions.delete && (
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {inlineChild && <LineItems parent={meta} parentId={id} child={inlineChild} currency={currency} />}

          {relatedChildren.length > 0 && (
            <Tabs defaultValue={relatedChildren[0].entity}>
              <TabsList>
                {relatedChildren.map((c) => (
                  <TabsTrigger key={c.entity} value={c.entity}>
                    {c.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {relatedChildren.map((c) => (
                <TabsContent key={c.entity} value={c.entity} className="pt-3">
                  <RelatedList entity={c.entity} foreignKey={c.foreign_key} parentId={id} />
                </TabsContent>
              ))}
            </Tabs>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <dl className="divide-y divide-border">
                {detailFields.map((f) => (
                  <div key={f.name} className="grid grid-cols-[11rem_1fr] gap-3 px-4 py-2">
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="min-w-0 text-sm">
                      <FieldValue field={f} record={record} currency={currency} />
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <TotalsCard meta={meta} record={record} currency={currency} />
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Timeline meta={meta} id={id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <RecordForm meta={meta} record={record} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

/** A related list is just the list screen, scoped to this parent. */
function RelatedList({ entity, foreignKey, parentId }: { entity: string; foreignKey: string; parentId: string }) {
  const { data: meta } = useEntityMeta(entity);
  if (!meta) return <Skeleton className="h-40 w-full" />;
  return <ListView meta={meta} fixedFilters={{ [foreignKey]: parentId }} embedded />;
}

/** Documents carry a totals block; anything else skips this card entirely. */
function TotalsCard({
  meta,
  record,
  currency,
}: {
  meta: EntityMeta;
  record: Record<string, unknown>;
  currency: string;
}) {
  const names = ["subtotal", "discount_total", "tax_total", "total", "amount_paid", "balance_due"];
  const rows = names
    .map((n) => meta.fields.find((f) => f.name === n))
    .filter((f): f is FieldDef => !!f);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Totals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 p-4">
        {rows.map((f) => {
          const emphasise = f.name === "total" || f.name === "balance_due";
          return (
            <div
              key={f.name}
              className={cn(
                "flex items-baseline justify-between gap-4 text-sm",
                emphasise && "border-t border-border pt-1.5 font-semibold",
              )}
            >
              <span className={cn("text-muted-foreground", emphasise && "text-foreground")}>{f.label}</span>
              <span className="tnum">{formatMoney(record[f.name] as number, currency)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** The few fields worth showing beside the title: status, owner, key amount. */
function headlineFields(meta: EntityMeta): FieldDef[] {
  const wanted = ["status", "stage", "priority", "owner_id", "assignee_id", "amount", "total", "balance_due"];
  return wanted
    .map((n) => meta.fields.find((f) => f.name === n))
    .filter((f): f is FieldDef => !!f)
    .slice(0, 4);
}
