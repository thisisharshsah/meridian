import * as React from "react";
import { View } from "react-native";

import { EntityTabs } from "@/components/entity-tabs";
import { RequireSession } from "@/components/guard";
import { Empty, Loading, Problem } from "@/components/ui";
import { RecordsList } from "@/components/records-list";
import { useAppMeta } from "@/lib/queries";
import { t } from "@suite/shared/i18n";

/**
 * One of the bar's module pages: the module's entities as tabs, and the
 * selected one's records underneath.
 *
 * Which module a slot holds is the registry's answer, not this file's — slot 0
 * is whatever `/api/meta` returns first, already narrowed to what the business
 * uses and what this person may open. Three fixed slots rather than a route
 * per module, because a tab bar keeps a screen per slot and switching between
 * them has to be instant; a stack that pushes a new screen each time is the
 * thing that felt wrong.
 */
export function ModuleScreen({ slot }: { slot: number }) {
  return (
    <RequireSession>
      <Module slot={slot} />
    </RequireSession>
  );
}

function Module({ slot }: { slot: number }) {
  const meta = useAppMeta();
  const module = meta.data?.modules[slot];
  const [entity, setEntity] = React.useState<string | null>(null);

  // The module can change under the slot — switching business, or a role that
  // reaches fewer of them — so the choice is dropped when it no longer belongs.
  const entities = module?.entities ?? [];
  const current = entities.some((e) => e.key === entity) ? entity! : (entities[0]?.key ?? null);

  if (meta.isPending) return <Loading />;
  if (meta.error) return <Problem error={meta.error} onRetry={() => meta.refetch()} />;
  if (!module || !current) return <Empty title={t("record.gateTitle")} body={t("record.gateBody")} />;

  return (
    <View style={{ flex: 1 }}>
      <EntityTabs entities={entities} value={current} onChange={setEntity} />
      <RecordsList entityKey={current} />
    </View>
  );
}
