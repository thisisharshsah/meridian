"use client";

import { use } from "react";
import { ListView } from "@/components/records/list-view";
import { EntityGate } from "@/components/records/entity-gate";

export default function EntityListPage({
  params,
}: {
  params: Promise<{ module: string; entity: string }>;
}) {
  const { module, entity } = use(params);
  return (
    <EntityGate entityKey={`${module}.${entity}`}>
      {(meta) => <ListView meta={meta} />}
    </EntityGate>
  );
}
