import * as React from "react";
import { Alert, Modal, Pressable, StyleSheet, View } from "react-native";
import { Plus } from "lucide-react-native";

import { FieldValue } from "@/components/field-value";
import { RecordForm } from "@/components/record-form";
import { Body, Button, Card, Empty, Label, Loading, Problem, Title } from "@/components/ui";
import { useDelete, useEntityMeta, useShortList, type Record_ } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { formatMoney } from "@suite/shared/format";
import type { ChildDef, EntityMeta } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

/**
 * The lines of a document — what a quote is quoting, what an invoice is
 * billing for.
 *
 * The parent owns them: a line carries the document's id in its foreign key,
 * so adding one is creating a record of the child entity with that key already
 * filled in, and the field for it is not shown because there is nothing to
 * decide. Totals are not edited here at all — the server multiplies, discounts
 * and taxes each line and sums the document from them, and the record above
 * re-reads once a line changes.
 */
export function LineItems({
  parentId,
  child,
  currency,
}: {
  parentId: string;
  child: ChildDef;
  currency: string;
}) {
  const c = useTheme();
  const meta = useEntityMeta(child.entity);
  const lines = useShortList(child.entity, { [child.foreign_key]: parentId, per_page: 100 });
  const remove = useDelete(child.entity);
  const [editing, setEditing] = React.useState<Record_ | null>(null);
  const [adding, setAdding] = React.useState(false);

  if (meta.isPending || lines.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (lines.error) return <Problem error={lines.error} onRetry={() => lines.refetch()} />;
  if (!meta.data) return null;

  const rows = lines.data?.data ?? [];
  const fields = meta.data.fields;
  const titleField = fields.find((f) => f.name === meta.data!.title_field) ?? fields[0];
  // What a line is worth, if the entity has such a column at all.
  const amount = fields.find((f) => f.name === "amount" || f.name === "line_total");
  const quantity = fields.find((f) => f.name === "quantity");

  const confirmRemove = (line: Record_) =>
    Alert.alert(
      t("record.deleteThisQ", undefined, { label: meta.data!.label.toLowerCase() }),
      t("record.cannotUndo"),
      [
        { text: t("action.cancel"), style: "cancel" },
        {
          text: t("action.delete"),
          style: "destructive",
          onPress: () => {
            remove.mutate(line.id);
          },
        },
      ],
    );

  return (
    <View style={{ gap: space.sm }}>
      <Label>{child.label}</Label>

      <Card>
        {rows.length === 0 ? (
          <Empty title={t("record.noLines")} body={t("record.noLinesWhy")} />
        ) : (
          rows.map((line, i) => (
            <Pressable
              key={line.id}
              accessibilityRole="button"
              onPress={() => setEditing(line)}
              onLongPress={() => confirmRemove(line)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                minHeight: 56,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
                backgroundColor: pressed ? c.surfaceMuted : "transparent",
              })}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Body numberOfLines={1} style={{ fontWeight: "600" }}>
                  {titleField ? (
                    <FieldValue field={titleField} record={line} currency={currency} strong />
                  ) : (
                    String(line[meta.data!.title_field] ?? t("value.untitled"))
                  )}
                </Body>
                {quantity ? (
                  <Body muted style={{ fontSize: 12 }}>
                    <FieldValue field={quantity} record={line} currency={currency} />
                  </Body>
                ) : null}
              </View>
              {amount ? <FieldValue field={amount} record={line} currency={currency} strong /> : null}
            </Pressable>
          ))
        )}
      </Card>

      {meta.data.permissions.create ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAdding(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: space.xs,
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Plus size={16} color={c.brand} />
          <Body style={{ color: c.brand }}>{t("action.addLine")}</Body>
        </Pressable>
      ) : null}

      <Modal
        visible={adding || !!editing}
        animationType="slide"
        onRequestClose={() => {
          setAdding(false);
          setEditing(null);
        }}
      >
        <View style={{ flex: 1, backgroundColor: c.background, paddingTop: space.xl }}>
          <Title style={{ fontSize: 18, paddingHorizontal: space.lg }}>
            {editing
              ? t("action.editThing", undefined, { label: meta.data.label.toLowerCase() })
              : t("action.newThing", undefined, { thing: meta.data.label.toLowerCase() })}
          </Title>
          <RecordForm
            meta={meta.data}
            record={editing}
            // The line belongs to this document, so its owner is not a
            // question: the key is filled in and the field is not offered.
            fixed={{ [child.foreign_key]: parentId }}
            onSaved={() => {
              setAdding(false);
              setEditing(null);
            }}
            onCancel={() => {
              setAdding(false);
              setEditing(null);
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

/** A document's totals, read from the parent the server just recalculated. */
export function DocumentTotals({ meta, record, currency }: { meta: EntityMeta; record: Record_; currency: string }) {
  const c = useTheme();
  const totals = meta.fields.filter(
    (f) => f.readonly && ["subtotal", "discount_total", "tax_total", "total", "amount_paid", "balance_due"].includes(f.name),
  );
  if (!totals.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Label>{t("record.totals")}</Label>
      <Card>
        {totals.map((f, i) => (
          <View
            key={f.name}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: c.border,
            }}
          >
            <Body muted>{f.label}</Body>
            <Body style={{ fontWeight: f.name === "total" ? "700" : "400", fontVariant: ["tabular-nums"] }}>
              {formatMoney(record[f.name] as number, currency, { showZero: true })}
            </Body>
          </View>
        ))}
      </Card>
    </View>
  );
}
