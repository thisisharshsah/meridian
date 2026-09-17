import * as React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { FieldValue } from "@/components/field-value";
import { DocumentTotals, LineItems } from "@/components/line-items";
import { RecordActions } from "@/components/record-actions";
import { History, RelatedList } from "@/components/related";
import { Body, Button, Card, Loading, Problem, Title } from "@/components/ui";
import { useDelete, useEntityMeta, useRecord, useSession } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityKeyFrom, entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";
import { DEFAULT_CURRENCY } from "@suite/shared/constants";

export default function Detail() {
  return (
    <RequireSession>
      <DetailScreen />
    </RequireSession>
  );
}

function DetailScreen() {
  const c = useTheme();
  const router = useRouter();
  const { module, entity, id } = useLocalSearchParams<{ module: string; entity: string; id: string }>();
  const key = entityKeyFrom(module, entity);
  const meta = useEntityMeta(key);
  const record = useRecord(key, id);
  const session = useSession();

  if (meta.isPending || record.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  // A record can be gone, or never have been yours to read; the API answers the
  // same either way, and so does this.
  if (record.error) return <Problem error={record.error} onRetry={() => record.refetch()} />;
  if (!meta.data || !record.data) return null;

  const currency = session.data?.organization?.currency ?? DEFAULT_CURRENCY;
  const title = String(record.data[meta.data.title_field] ?? t("value.untitled"));
  // One child can be declared inline: the lines that belong to this document
  // rather than a related list that merely points at it.
  const inline = meta.data.children.find((ch) => ch.inline);
  // Everything else that points at this record: a customer's deals, an
  // invoice's payments.
  const related = meta.data.children.filter((ch) => !ch.inline);

  // Sections, not a scroll. A document carries its fields, its lines, what
  // points at it and what has happened to it; stacked they are several screens
  // of scrolling to reach the history. Tabs are what the web uses for the
  // related lists, and the same idea covers all four.
  const sections = [
    { key: "details", label: t("record.details") },
    ...(inline ? [{ key: "lines", label: inline.label }] : []),
    ...(related.length ? [{ key: "related", label: t("record.related") }] : []),
    { key: "history", label: t("record.history") },
  ];
  const [section, setSection] = React.useState("details");
  const showing = sections.some((x) => x.key === section) ? section : "details";

  return (
    <>
      <Stack.Screen options={{ title: meta.data.label }} />
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm }}>
          <Title>{title}</Title>

          {/* What identifies this record at a glance, before any tab. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
            {meta.data.fields
              .filter((f) => ["status", "stage", "total", "balance_due", "amount"].includes(f.name))
              .slice(0, 3)
              .map((f) => (
                <View key={f.name} style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  <Body subtle style={{ fontSize: 12 }}>{f.label}</Body>
                  <FieldValue field={f} record={record.data!} currency={currency} strong />
                </View>
              ))}
          </View>

          <RecordActions meta={meta.data} record={record.data} onDone={() => record.refetch()} />
        </View>

        {sections.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0, marginTop: space.md }}
            contentContainerStyle={{ alignItems: "center", gap: space.xs, paddingHorizontal: space.md }}
          >
            {sections.map((x) => {
              const on = x.key === showing;
              return (
                <Pressable
                  key={x.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSection(x.key)}
                  style={({ pressed }) => ({
                    minHeight: 40,
                    justifyContent: "center",
                    paddingHorizontal: space.sm,
                    borderBottomWidth: 2,
                    borderBottomColor: on ? c.brand : "transparent",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Body style={{ fontSize: 14, fontWeight: on ? "700" : "500", color: on ? c.brand : c.mutedForeground }}>
                    {x.label}
                  </Body>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          {showing === "details" ? (
            <>
              <Card>
                {meta.data.fields.map((f, i) => (
                  <View
                    key={f.name}
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: c.border,
                    }}
                  >
                    <Body subtle style={{ fontSize: 12, width: 110 }}>{f.label}</Body>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <FieldValue field={f} record={record.data!} currency={currency} />
                    </View>
                  </View>
                ))}
              </Card>

              <Actions meta={meta.data} id={id} onGone={() => router.back()} />
            </>
          ) : null}

          {showing === "lines" && inline ? (
            <>
              <LineItems parentId={id} child={inline} currency={currency} />
              <DocumentTotals meta={meta.data} record={record.data} currency={currency} />
            </>
          ) : null}

          {showing === "related"
            ? related.map((ch) => <RelatedList key={ch.entity} child={ch} parentId={id} />)
            : null}

          {showing === "history" ? <History entity={key} id={id} /> : null}

          <View style={{ height: space.xl }} />
        </ScrollView>
      </View>
    </>
  );
}

function Actions({
  meta,
  id,
  onGone,
}: {
  meta: { key: string; label: string; permissions: { edit: boolean; delete: boolean } };
  id: string;
  onGone: () => void;
}) {
  const router = useRouter();
  const remove = useDelete(meta.key);
  const [busy, setBusy] = React.useState(false);

  const confirm = () =>
    Alert.alert(
      t("record.deleteThisQ", undefined, { label: meta.label.toLowerCase() }),
      t("record.cannotUndo"),
      [
        { text: t("action.cancel"), style: "cancel" },
        {
          text: t("action.delete"),
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await remove.mutateAsync(id);
              onGone();
            } catch {
              setBusy(false);
              Alert.alert(t("record.deleteFailedThing", undefined, { label: meta.label.toLowerCase() }));
            }
          },
        },
      ],
    );

  if (!meta.permissions.edit && !meta.permissions.delete) return null;

  return (
    <View style={{ gap: space.sm }}>
      {meta.permissions.edit ? (
        <Button
          title={t("action.editThing", undefined, { label: meta.label.toLowerCase() })}
          onPress={() => router.push(`${entityPath(meta.key)}/${id}/edit`)}
          disabled={busy}
        />
      ) : null}
      {meta.permissions.delete ? (
        <Button title={t("action.delete")} variant="quiet" onPress={confirm} busy={busy} />
      ) : null}
    </View>
  );
}
