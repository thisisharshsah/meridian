"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, patch, post, qs, type Page } from "@/lib/api";
import type { AppMeta, EntityMeta, Session } from "@/lib/meta";
import { localizeAppMeta, localizeEntityMeta, t } from "@/lib/i18n";

export type Record_ = Record<string, unknown> & { id: string };

/** The app map and the session change rarely; hold them for the session. */
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => get<Session>("auth/me"),
    staleTime: 5 * 60_000,
  });
}

export function useAppMeta() {
  return useQuery({
    queryKey: ["meta"],
    // Localised as it arrives, so no screen has to remember to do it.
    queryFn: () => get<AppMeta>("meta").then(localizeAppMeta),
    staleTime: Infinity,
  });
}

export function useEntityMeta(entity: string | undefined) {
  return useQuery({
    queryKey: ["meta", entity],
    queryFn: () => get<EntityMeta>(`meta/${entity}`).then(localizeEntityMeta),
    enabled: !!entity,
    staleTime: Infinity,
  });
}

export type PendingInvitation = {
  id: string;
  organization: string;
  role_name: string;
  title: string | null;
  expires_at: string;
};

/** Businesses that have invited the address this session belongs to. */
export function usePendingInvitations() {
  return useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => get<{ data: PendingInvitation[] }>("my-invitations"),
    staleTime: 60_000,
  });
}

export type ListParams = Record<string, string | number | boolean | null | undefined>;

/**
 * What to call the product on this screen.
 *
 * An installation sold as Aurovie Rooms says so everywhere: it is the
 * customer's software, not somebody else's with the interesting parts
 * switched off. The catalogue name covers the moment before the session
 * lands.
 */
export function useProductName(): string {
  const { data } = useSession();
  return data?.product || t("app.name");
}

export function useList(entity: string | undefined, params: ListParams = {}) {
  return useQuery({
    queryKey: ["list", entity, params],
    queryFn: () => get<Page<Record_>>(`e/${entity}${qs(params)}`),
    enabled: !!entity,
    placeholderData: (prev) => prev,
  });
}

export function useRecord(entity: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["record", entity, id],
    queryFn: () => get<Record_>(`e/${entity}/${id}`),
    enabled: !!entity && !!id,
  });
}

export function useAuditTrail(entity: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["audit", entity, id],
    queryFn: () => get<{ data: AuditEvent[] }>(`e/${entity}/${id}/audit`),
    enabled: !!entity && !!id,
  });
}

export type AuditEvent = {
  id: string;
  action: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
  user_name: string | null;
};

export function useLookup(entity: string | undefined, search: string) {
  return useQuery({
    queryKey: ["lookup", entity, search],
    queryFn: () =>
      get<{ data: { id: string; label: string }[]; total: number }>(
        `lookup/${entity}${qs({ q: search || undefined, per_page: 20 })}`,
      ),
    enabled: !!entity,
    staleTime: 30_000,
  });
}

export function useGlobalSearch(term: string) {
  return useQuery({
    queryKey: ["search", term],
    queryFn: () =>
      get<{
        groups: { entity: string; label: string; icon: string; total: number; items: { id: string; title: string }[] }[];
      }>(`search${qs({ q: term })}`),
    enabled: term.trim().length >= 2,
    staleTime: 10_000,
  });
}

export type StatsRequest = {
  group_by?: string;
  measure?: string;
  agg?: "sum" | "count" | "avg" | "min" | "max";
  filters?: Record<string, string>;
};

export type StatsRow = { bucket: string | number | boolean | null; value: number; count: number };

export function useStats(entity: string, req: StatsRequest, enabled = true) {
  return useQuery({
    queryKey: ["stats", entity, req],
    queryFn: () => post<{ data: StatsRow[] }>(`stats/${entity}`, req),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * One place that knows which caches a write invalidates. Hooks on the server
 * can change a parent document (invoice totals, project progress), so a write
 * invalidates lists and records broadly rather than surgically.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["list"] });
    qc.invalidateQueries({ queryKey: ["record"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
    qc.invalidateQueries({ queryKey: ["lookup"] });
  };
}

export function useCreate(entity: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => post<Record_>(`e/${entity}`, body),
    onSuccess: invalidate,
  });
}

export function useUpdate(entity: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patch<Record_>(`e/${entity}/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDelete(entity: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`e/${entity}/${id}`),
    onSuccess: invalidate,
  });
}
