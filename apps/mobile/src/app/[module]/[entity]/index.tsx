import * as React from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { EntityTabs } from "@/components/entity-tabs";
import { RequireSession } from "@/components/guard";
import { RecordsList } from "@/components/records-list";
import { useAppMeta, useEntityMeta } from "@/lib/queries";
import { entityKeyFrom, entityPath } from "@suite/shared/meta";

export default function List() {
  return (
    <RequireSession>
      <ListScreen />
    </RequireSession>
  );
}

/**
 * One entity's records, reached by a link rather than by a tab — from search,
 * or from a figure on the home screen.
 *
 * The module's other entities are still across the top, and here they do
 * navigate, because this screen exists at a particular address and that
 * address should follow what is being looked at.
 */
function ListScreen() {
  const router = useRouter();
  // `q` arrives when search sends someone here to see the rest of a group.
  const { module, entity, q } = useLocalSearchParams<{ module: string; entity: string; q?: string }>();
  const key = entityKeyFrom(module, entity);
  const meta = useEntityMeta(key);
  const app = useAppMeta();

  const entities = app.data?.modules.find((m) => m.entities.some((e) => e.key === key))?.entities ?? [];

  return (
    <>
      <Stack.Screen options={{ title: meta.data?.label_plural ?? "" }} />
      <View style={{ flex: 1 }}>
        <EntityTabs
          entities={entities}
          value={key}
          onChange={(next) => router.replace(entityPath(next))}
        />
        <RecordsList entityKey={key} initialSearch={q ?? ""} />
      </View>
    </>
  );
}
