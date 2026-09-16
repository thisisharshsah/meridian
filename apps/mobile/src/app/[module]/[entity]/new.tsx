import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { RequireSession } from "@/components/guard";
import { RecordForm } from "@/components/record-form";
import { Loading, Problem } from "@/components/ui";
import { useEntityMeta } from "@/lib/queries";
import { entityKeyFrom, entityPath } from "@suite/shared/meta";
import { t } from "@suite/shared/i18n";

export default function NewRecord() {
  return (
    <RequireSession>
      <NewRecordScreen />
    </RequireSession>
  );
}

/** A record that does not exist yet. Saving opens the one that now does. */
function NewRecordScreen() {
  const router = useRouter();
  const { module, entity } = useLocalSearchParams<{ module: string; entity: string }>();
  const key = entityKeyFrom(module, entity);
  const meta = useEntityMeta(key);

  if (meta.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (!meta.data) return null;

  return (
    <>
      <Stack.Screen
        options={{ title: t("action.newThing", undefined, { thing: meta.data.label.toLowerCase() }) }}
      />
      <RecordForm
        meta={meta.data}
        onSaved={(saved) => router.replace(`${entityPath(key)}/${saved.id}`)}
        onCancel={() => router.back()}
      />
    </>
  );
}
