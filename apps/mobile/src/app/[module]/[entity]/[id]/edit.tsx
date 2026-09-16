import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { RecordForm } from "@/components/record-form";
import { Loading, Problem } from "@/components/ui";
import { useEntityMeta, useRecord } from "@/lib/queries";
import { entityKeyFrom } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function EditRecord() {
  return (
    <RequireSession>
      <EditRecordScreen />
    </RequireSession>
  );
}

function EditRecordScreen() {
  const router = useRouter();
  const { module, entity, id } = useLocalSearchParams<{ module: string; entity: string; id: string }>();
  const key = entityKeyFrom(module, entity);
  const meta = useEntityMeta(key);
  const record = useRecord(key, id);

  if (meta.isPending || record.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (record.error) return <Problem error={record.error} onRetry={() => record.refetch()} />;
  if (!meta.data || !record.data) return null;

  return (
    <>
      <Stack.Screen
        options={{ title: t("action.editThing", undefined, { label: meta.data.label.toLowerCase() }) }}
      />
      <RecordForm
        meta={meta.data}
        record={record.data}
        onSaved={() => router.back()}
        onCancel={() => router.back()}
      />
    </>
  );
}
