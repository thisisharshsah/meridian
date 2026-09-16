import * as React from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
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

  return (
    <>
      <Stack.Screen options={{ title: meta.data.label }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Title>{title}</Title>

        {/* A document's lines, where it has them: the thing an invoice is
            actually billing for, above the fields that describe it. */}
        {inline ? (
          <LineItems parentId={id} child={inline} currency={currency} />
        ) : null}

        {inline ? <DocumentTotals meta={meta.data} record={record.data} currency={currency} /> : null}

        <Card>
          {meta.data.fields.map((f, i) => (
            <View
              key={f.name}
              style={{
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                gap: space.xs,
                borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: c.border,
              }}
            >
              <Body subtle style={{ fontSize: 12 }}>{f.label}</Body>
              <FieldValue field={f} record={record.data} currency={currency} />
            </View>
          ))}
        </Card>

        {/* Moving the record along the chain — convert, invoice, issue —
            above the ways to change or remove it. */}
        <RecordActions meta={meta.data} record={record.data} onDone={() => record.refetch()} />

        {related.map((ch) => (
          <RelatedList key={ch.entity} child={ch} parentId={id} />
        ))}

        <History entity={key} id={id} />

        <Actions meta={meta.data} id={id} onGone={() => router.back()} />

        <View style={{ height: space.xl }} />
      </ScrollView>
    </>
  );
}

/**
 * What can be done to this record, as the metadata says — a role without
 * permission is not shown a button that would answer 403.
 */
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
