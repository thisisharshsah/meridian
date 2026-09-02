"use client";

import { use } from "react";
import { DetailView } from "@/components/records/detail-view";
import { EntityGate } from "@/components/records/entity-gate";

export default function RecordPage({
  params,
}: {
  params: Promise<{ module: string; entity: string; id: string }>;
}) {
  const { module, entity, id } = use(params);
  return (
    <EntityGate entityKey={`${module}.${entity}`}>
      {(meta) => <DetailView meta={meta} id={id} />}
    </EntityGate>
  );
}
