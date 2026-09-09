"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Plus, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { Icon } from "@/components/icon";
import { FieldRow, FormError } from "@/components/form/field";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";

type Hook = {
  id: string; name: string; url: string; events: string[]; is_active: boolean;
  last_status: number | null; last_error: string | null; last_delivered_at: string | null;
  failure_streak: number; delivered_count: number;
};

type EventGroup = {
  entity: string; label: string; icon: string; events: string[]; all: string;
};

type Delivery = {
  id: string; event: string; status: string; response_code: number | null;
  error: string | null; attempts: number; duration_ms: number | null; created_at: string;
};

/**
 * Outbound webhooks. Deliveries ride the job queue, so this screen shows health
 * (last response, failure streak) rather than pretending a send is instant.
 */
export function IntegrationsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [creating, setCreating] = React.useState(false);
  const [inspecting, setInspecting] = React.useState<Hook | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "webhooks"],
    queryFn: () =>
      get<{ data: Hook[]; available_events: EventGroup[]; allow_private: boolean }>(
        "settings/webhooks",
      ),
    enabled: canManage,
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      patch(`settings/webhooks/${id}`, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "webhooks"] }),
    onError: () => toast.error("Could not change that webhook"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`settings/webhooks/${id}`),
    onSuccess: () => {
      toast.success("Webhook deleted");
      qc.invalidateQueries({ queryKey: ["settings", "webhooks"] });
    },
  });

  const ping = useMutation({
    mutationFn: (id: string) => post(`settings/webhooks/${id}/test`, {}),
    onSuccess: () => toast.success("Test delivery queued"),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not send a test"),
  });

  if (!canManage) {
    return (
      <EmptyState
        icon={Webhook}
        title="Only an owner can manage integrations"
        description="Ask an owner of this workspace to set up webhooks."
      />
    );
  }

  if (isLoading || !data) return <Skeleton className="h-64 w-full max-w-4xl" />;

  return (
    <div className="max-w-4xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New webhook
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.data.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="No webhooks yet"
              description="Send a signed POST to another system whenever a record changes."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus />
                  New webhook
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {data.data.map((h) => (
                <li key={h.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 rounded-md bg-surface-muted p-1.5">
                    <Webhook className="size-3.5 text-muted-foreground" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => setInspecting(h)}
                      className="text-left text-sm font-medium hover:text-brand"
                    >
                      {h.name}
                    </button>
                    <p className="truncate font-mono text-xs text-muted-foreground">{h.url}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-subtle-foreground">
                      {h.events.slice(0, 4).map((e) => (
                        <span key={e} className="rounded bg-surface-muted px-1.5 py-0.5 font-mono">
                          {e}
                        </span>
                      ))}
                      {h.events.length > 4 && <span>+{h.events.length - 4}</span>}
                    </p>
                    <p className="mt-1 text-xs text-subtle-foreground">
                      {h.delivered_count} delivered
                      {h.last_delivered_at ? `, last ${relativeTime(h.last_delivered_at)}` : ""}
                    </p>
                    {h.last_error && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-danger">
                        <AlertTriangle className="mt-px size-3 shrink-0" />
                        {h.last_error}
                        {h.failure_streak > 1 && ` (${h.failure_streak} in a row)`}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {h.last_status && (
                      <Badge tone={h.last_status < 300 ? "success" : "danger"}>{h.last_status}</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Send a test"
                      title="Send a test delivery"
                      onClick={() => ping.mutate(h.id)}
                    >
                      <Send />
                    </Button>
                    <Switch
                      checked={h.is_active}
                      onCheckedChange={(v) => toggle.mutate({ id: h.id, is_active: v })}
                      aria-label={`Turn ${h.name} ${h.is_active ? "off" : "on"}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete"
                      onClick={() => remove.mutate(h.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Every request carries <code className="font-mono">X-Meridian-Signature</code>, an HMAC-SHA256
        of the timestamp and body under the webhook&rsquo;s secret — verify it before trusting a
        payload.{" "}
        {data.allow_private
          ? "Private network addresses are permitted on this server."
          : "Private and loopback addresses are refused; set WEBHOOKS_ALLOW_PRIVATE=1 to permit them."}
      </p>

      <WebhookDialog
        open={creating}
        onOpenChange={setCreating}
        eventGroups={data.available_events}
      />
      <DeliveriesDialog hook={inspecting} onOpenChange={(v) => !v && setInspecting(null)} />
    </div>
  );
}

function WebhookDialog({
  open, onOpenChange, eventGroups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventGroups: EventGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState<Set<string>>(new Set());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setUrl("");
    setEvents(new Set());
    setErrors({});
    setFormError(null);
    setSecret(null);
    setCopied(false);
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      post<{ secret: string }>("settings/webhooks", { name, url, events: [...events] }),
    onSuccess: (r) => {
      setSecret(r.secret);
      qc.invalidateQueries({ queryKey: ["settings", "webhooks"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError("Could not create that webhook");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>Webhook created</DialogTitle>
              <DialogDescription>
                This signing secret is shown once and is not stored anywhere you can read it back.
                The receiving system needs it to verify signatures.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(secret);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      toast.message("Select the secret and copy it manually");
                    }
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              setFormError(null);
              create.mutate();
            }}
            className="flex min-h-0 flex-col"
          >
            <DialogHeader>
              <DialogTitle>New webhook</DialogTitle>
              <DialogDescription>
                Post a signed payload to another system when these records change.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <FormError message={formError} />

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldRow label="Name" htmlFor="hook-name" error={errors.name} required>
                  <Input
                    id="hook-name"
                    autoFocus
                    placeholder="Deal notifier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Endpoint URL" htmlFor="hook-url" error={errors.url} required>
                  <Input
                    id="hook-url"
                    placeholder="https://example.com/hooks/meridian"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={!!errors.url}
                  />
                </FieldRow>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
                  Events
                </p>
                {errors.events && <p className="mb-2 text-xs text-danger">{errors.events}</p>}
                <div className="max-h-72 overflow-y-auto rounded-md border border-border scrollbar-thin">
                  <table className="w-full text-sm">
                    <tbody>
                      {eventGroups.map((g) => (
                        <tr key={g.entity} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5">
                            <span className="flex items-center gap-2">
                              <Icon name={g.icon} className="size-3.5 opacity-60" />
                              {g.label}
                            </span>
                          </td>
                          {g.events.map((e) => (
                            <td key={e} className="w-24 px-2 py-1.5 text-center">
                              <label className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                                <Checkbox
                                  checked={events.has(e)}
                                  onCheckedChange={(v) =>
                                    setEvents((prev) => {
                                      const next = new Set(prev);
                                      if (v === true) next.add(e);
                                      else next.delete(e);
                                      return next;
                                    })
                                  }
                                  aria-label={e}
                                />
                                {e.split(".").pop()}
                              </label>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </DialogBody>

            <DialogFooter>
              <span className="mr-auto text-xs text-muted-foreground">
                {events.size} event{events.size === 1 ? "" : "s"}
              </span>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("action.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending}>
                Create webhook
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesDialog({
  hook, onOpenChange,
}: {
  hook: Hook | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { data } = useQuery({
    queryKey: ["settings", "webhooks", hook?.id, "deliveries"],
    queryFn: () => get<{ data: Delivery[] }>(`settings/webhooks/${hook!.id}/deliveries`),
    enabled: !!hook,
  });

  return (
    <Dialog open={!!hook} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{hook?.name}</DialogTitle>
          <DialogDescription>The last 50 delivery attempts.</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0">
          {!data ? (
            <Skeleton className="m-4 h-40" />
          ) : data.data.length === 0 ? (
            <EmptyState icon={Send} title="Nothing delivered yet" />
          ) : (
            <ul className="divide-y divide-border">
              {data.data.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                  <Badge tone={d.status === "delivered" ? "success" : d.status === "failed" ? "danger" : "neutral"} dot>
                    {d.status}
                  </Badge>
                  <span className="font-mono">{d.event}</span>
                  <span className="ml-auto text-muted-foreground">
                    {d.response_code ? `HTTP ${d.response_code}` : "—"}
                    {d.duration_ms !== null ? ` · ${d.duration_ms}ms` : ""}
                    {d.attempts > 1 ? ` · attempt ${d.attempts}` : ""}
                  </span>
                  <span className="text-subtle-foreground">{relativeTime(d.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Deliveries failing repeatedly disable a webhook; this makes that visible. */
export function webhookHealth(h: Hook) {
  return cn(h.failure_streak > 0 ? "text-danger" : "text-success");
}
