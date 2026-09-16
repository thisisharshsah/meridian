import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { del, get, patch, post, qs } from "@/lib/api";
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
export function useRecordList(
  entity: string | undefined,
  search: string,
  filters: Record<string, string> = {},
) {
  return useInfiniteQuery({
    queryKey: ["list", entity, search, filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      get<Page<Record_>>(
        // The engine's own grammar: an unknown field is dropped rather than
        // interpolated, so a filter can only ever narrow what it is allowed to.
        `e/${entity}${qs({ page: pageParam, per_page: PER_PAGE, q: search || undefined, ...filters })}`,
      ),
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    enabled: !!entity,
  });
}

export type StatsRow = { bucket: string | number | boolean | null; value: number; count: number };

/**
 * One aggregate from the server rather than a page of records counted here: a
 * phone should not download a year of invoices to add up what is owed.
 */
export function useStats(
  entity: string,
  req: { group_by?: string; measure?: string; agg?: string; filters?: Record<string, string> },
  enabled = true,
) {
  return useQuery({
    queryKey: ["stats", entity, req],
    queryFn: () => post<{ data: StatsRow[] }>(`stats/${entity}`, req),
    enabled,
    staleTime: 30_000,
  });
}

/** A short list — the few records a screen shows without paging. */
export function useShortList(entity: string | undefined, params: Record<string, string | number>) {
  return useQuery({
    queryKey: ["list", entity, params],
    queryFn: () => get<Page<Record_>>(`e/${entity}${qs(params)}`),
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

/**
 * What a write invalidates.
 *
 * Broadly, on purpose: the server's hooks can change a record this write never
 * mentioned — an invoice's totals from a line, a project's progress from a
 * task — so anything showing records, figures or history is asked again rather
 * than guessed at.
 */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["list", "record", "stats", "lookup", "search"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
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

/** Records of another entity, for choosing one: the server searches and labels them. */
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
