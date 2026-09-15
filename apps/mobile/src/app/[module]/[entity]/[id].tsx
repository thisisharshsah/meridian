import * as React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";

import { RequireSession } from "@/components/guard";
import { FieldValue } from "@/components/field-value";
import { Body, Card, Loading, Problem, Title } from "@/components/ui";
import { useEntityMeta, useRecord, useSession } from "@/lib/queries";
import { space, useTheme } from "@/lib/theme";
import { entityKeyFrom } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function Detail() {
  return (
    <RequireSession>
      <DetailScreen />
    </RequireSession>
  );
}

function DetailScreen() {
  const c = useTheme();
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

  const currency = session.data?.organization?.currency ?? "USD";
  const title = String(record.data[meta.data.title_field] ?? t("value.untitled"));

  return (
    <>
      <Stack.Screen options={{ title: meta.data.label }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Title>{title}</Title>

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

        <View style={{ height: space.xl }} />
      </ScrollView>
    </>
  );
}
