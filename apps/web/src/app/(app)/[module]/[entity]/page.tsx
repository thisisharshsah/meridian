"use client";

import { use } from "react";
import { ListView } from "@/components/records/list-view";
import { EntityGate } from "@/components/records/entity-gate";
import { EntityTabs } from "@/components/records/entity-tabs";

export default function EntityListPage({
  params,
}: {
  params: Promise<{ module: string; entity: string }>;
}) {
  const { module, entity } = use(params);
  return (
    <EntityGate entityKey={`${module}.${entity}`}>
      {(meta) => (
        <>
          {/* Phone only: the wide screen has the sidebar for this. */}
          <EntityTabs entityKey={meta.key} />
          <ListView meta={meta} />
        </>
      )}
    </EntityGate>
  );
}
