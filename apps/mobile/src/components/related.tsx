import * as React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { FieldValue } from "@/components/field-value";
import { Body, Card, Empty, Label, Loading } from "@/components/ui";
import { useAuditTrail, useEntityMeta, useShortList } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityPath, type ChildDef } from "@suite/shared/meta";
import { formatDateTime } from "@suite/shared/format";
import { t } from "@suite/shared/i18n";

/**
 * What else points at this record: a customer's deals, a project's tasks, an
 * invoice's payments.
 *
 * The registry says which entities are children and which column joins them,
 * so this is the same component whatever the record is — and each row leads
 * into that entity's own screen rather than trying to be it.
 */
export function RelatedList({ child, parentId }: { child: ChildDef; parentId: string }) {
  const c = useTheme();
  const router = useRouter();
  const meta = useEntityMeta(child.entity);
  const rows = useShortList(child.entity, { [child.foreign_key]: parentId, per_page: 10 });

  if (meta.isPending || rows.isPending) return <Loading />;
  if (!meta.data) return null;

  const records = rows.data?.data ?? [];
  const columns = meta.data.fields.filter((f) => f.in_list).slice(0, 3);

  return (
    <View style={{ gap: space.sm }}>
      <Label>{child.label}</Label>
      <Card>
        {records.length === 0 ? (
          <Empty title={t("mobile.noRecords", undefined, { label: meta.data.label_plural })} />
        ) : (
          records.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => router.push(`${entityPath(child.entity)}/${r.id}`)}
              style={({ pressed }) => ({
                gap: 2,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                minHeight: 56,
                justifyContent: "center",
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
                backgroundColor: pressed ? c.surfaceMuted : "transparent",
              })}
            >
              {columns[0] ? <FieldValue field={columns[0]} record={r} currency="" strong /> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                {columns.slice(1).map((f) => (
                  <View key={f.name} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                    <Body subtle style={{ fontSize: 12 }}>{f.label}</Body>
                    <FieldValue field={f} record={r} currency="" />
                  </View>
                ))}
              </View>
            </Pressable>
          ))
        )}
      </Card>
    </View>
  );
}

/**
 * What has happened to this record, and who did it.
 *
 * The server keeps the trail; this only reads it. Useful on a phone for the
 * question it is usually asked in a corridor — who changed this, and when.
 */
export function History({ entity, id }: { entity: string; id: string }) {
  const c = useTheme();
  const audit = useAuditTrail(entity, id);

  if (audit.isPending) return <Loading />;
  const events = audit.data?.data ?? [];

  return (
    <View style={{ gap: space.sm }}>
      <Label>{t("record.history")}</Label>
      <Card>
        {events.length === 0 ? (
          <Empty title={t("record.nothingYet")} body={t("record.nothingYetWhy")} />
        ) : (
          events.map((e, i) => (
            <View
              key={e.id}
              style={{
                gap: 2,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }}
            >
              <Body style={{ fontSize: 14 }}>{e.summary ?? e.action}</Body>
              <Body subtle style={{ fontSize: 12 }}>
                {[e.user_name, formatDateTime(e.created_at)].filter(Boolean).join(" · ")}
              </Body>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
