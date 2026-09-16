import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { get, qs } from "@/lib/api";
import type { AppMeta, EntityMeta, Session } from "@suite/shared/meta";
import { localizeAppMeta, localizeEntityMeta } from "@suite/shared/i18n";

export type Record_ = Record<string, unknown> & { id: string };

export type Page<T> = {
  data: T[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
};

/** Who you are, where you are, and what you may open. Re-read on every launch. */
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
    // Localised as it arrives, exactly as the web does it, so both clients
    // call a lead the same thing.
    queryFn: () => get<AppMeta>("meta").then(localizeAppMeta),
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

export function useEntityMeta(entity: string | undefined) {
  return useQuery({
    queryKey: ["meta", entity],
    queryFn: () => get<EntityMeta>(`meta/${entity}`).then(localizeEntityMeta),
    enabled: !!entity,
    staleTime: Infinity,
  });
}

const PER_PAGE = 25;

/**
 * A page at a time, appended as you scroll — a phone list has no pager.
 * `total_pages` from the API decides when to stop asking.
 */
export function useRecordList(entity: string | undefined, search: string) {
  return useInfiniteQuery({
    queryKey: ["list", entity, search],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      get<Page<Record_>>(`e/${entity}${qs({ page: pageParam, per_page: PER_PAGE, q: search || undefined })}`),
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    enabled: !!entity,
  });
}

export type SearchGroup = {
  entity: string;
  label: string;
  icon: string;
  total: number;
  items: { id: string; title: string }[];
};

/**
 * One term against every entity the person may read, answered by the server's
 * FTS index rather than by asking each list in turn. Two characters is the
 * floor: one letter matches most of a workspace and is never what anybody
 * meant.
 */
export function useGlobalSearch(term: string) {
  return useQuery({
    queryKey: ["search", term],
    queryFn: () => get<{ groups: SearchGroup[] }>(`search${qs({ q: term })}`),
    enabled: term.trim().length >= 2,
    staleTime: 10_000,
  });
}

export function useRecord(entity: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["record", entity, id],
    queryFn: () => get<Record_>(`e/${entity}/${id}`),
    enabled: !!entity && !!id,
  });
}
