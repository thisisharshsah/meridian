"use client";

import * as React from "react";
import { Building2, Check, KeyRound, ShieldCheck, Users, Webhook, Workflow } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/misc";
import { FieldRow, FormError } from "@/components/form/field";
import { InviteSection } from "@/components/settings/invite-dialog";
import { AutomationsTab } from "@/components/settings/automations";
import { RolesTab } from "@/components/settings/role-editor";
import { IntegrationsTab } from "@/components/settings/integrations";
import { ApiError, get, patch } from "@/lib/api";
import { CURRENCIES } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/format";

type Org = {
  id: string; name: string; slug: string; currency: string; country: string | null;
  timezone: string; fiscal_year_start_month: number; created_at: string;
  member_count: number; role_count: number; can_edit: boolean;
};

type Member = {
  membership_id: string; user_id: string; name: string; email: string; title: string | null;
  status: string; is_owner: boolean; role_id: string | null; role_name: string | null;
  last_login_at: string | null; joined_at: string;
};

type Role = {
  id: string; key: string; name: string; description: string | null;
  permissions: string[]; is_system: boolean; member_count: number;
};

export default function SettingsPage() {
  return (
    <div className="p-5">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your organization, the people in it, and what each role can reach.
        </p>
      </header>

      <Tabs defaultValue="organization">
        <TabsList>
          <TabsTrigger value="organization">
            <Building2 className="size-3.5" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="size-3.5" />
            Members
          </TabsTrigger>
          <TabsTrigger value="roles">
            <ShieldCheck className="size-3.5" />
            Roles
          </TabsTrigger>
          <TabsTrigger value="automations">
            <Workflow className="size-3.5" />
            Automation
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Webhook className="size-3.5" />
            Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organization" className="pt-4">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="members" className="pt-4">
          <MembersTab />
        </TabsContent>
        <TabsContent value="roles" className="pt-4">
          <RolesGate />
        </TabsContent>
        <TabsContent value="automations" className="pt-4">
          <AutomationsGate />
        </TabsContent>
        <TabsContent value="integrations" className="pt-4">
          <IntegrationsGate />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrganizationTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings", "organization"],
    queryFn: () => get<Org>("settings/organization"),
  });

  const [form, setForm] = React.useState<Partial<Org>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data) setForm({ name: data.name, currency: data.currency, country: data.country ?? "", timezone: data.timezone });
  }, [data]);

  const save = useMutation({
    mutationFn: (body: Partial<Org>) => patch<Org>("settings/organization", body),
    onSuccess: () => {
      toast.success("Workspace updated");
      qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError("Could not save those settings");
      }
    },
  });

  if (isLoading || !data) return <Skeleton className="h-72 w-full max-w-2xl" />;

  const readOnly = !data.can_edit;

  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              setFormError(null);
              save.mutate(form);
            }}
          >
            <FormError message={formError} />

            <FieldRow label="Name" htmlFor="org-name" error={errors.name} required>
              <Input
                id="org-name"
                value={form.name ?? ""}
                disabled={readOnly}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
              />
            </FieldRow>

            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow
                label="Base currency"
                htmlFor="org-currency"
                error={errors.currency}
                hint="Every stored amount is in this currency."
              >
                <Select
                  value={form.currency ?? "USD"}
                  onValueChange={(v) => setForm((s) => ({ ...s, currency: v }))}
                >
                  <SelectTrigger id="org-currency" disabled={readOnly}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>

              <FieldRow label="Country" htmlFor="org-country" error={errors.country}>
                <Input
                  id="org-country"
                  value={form.country ?? ""}
                  disabled={readOnly}
                  onChange={(e) => setForm((s) => ({ ...s, country: e.target.value }))}
                />
              </FieldRow>
            </div>

            {readOnly ? (
              <p className="text-xs text-muted-foreground">
                Only an owner can change these settings.
              </p>
            ) : (
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save changes
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>At a glance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Workspace URL" value={data.slug} mono />
          <Row label="Members" value={String(data.member_count)} />
          <Row label="Roles" value={String(data.role_count)} />
          <Row label="Time zone" value={data.timezone} />
          <Row label="Created" value={formatDate(data.created_at)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "text-sm"}>{value}</span>
    </div>
  );
}

function MembersTab() {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ["settings", "members"],
    queryFn: () => get<{ data: Member[]; can_manage: boolean }>("settings/members"),
  });
  const roles = useQuery({
    queryKey: ["settings", "roles"],
    queryFn: () => get<{ data: Role[] }>("settings/roles"),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      patch(`settings/members/${id}`, body),
    onSuccess: () => {
      toast.success("Member updated");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update that member"),
  });

  if (members.isLoading || !members.data) return <Skeleton className="h-64 w-full" />;

  const canManage = members.data.can_manage;

  return (
    <div className="space-y-4">
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <span className="text-xs text-muted-foreground">
          {members.data.data.length} in this workspace
        </span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Person</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Last seen</TH>
              <TH>Joined</TH>
            </TR>
          </THead>
          <TBody>
            {members.data.data.map((m) => (
              <TR key={m.membership_id} className="hover:bg-transparent">
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.name} size="md" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {m.name}
                        {m.is_owner && (
                          <Badge tone="brand">
                            <KeyRound className="size-2.5" />
                            Owner
                          </Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email}
                        {m.title ? ` · ${m.title}` : ""}
                      </p>
                    </div>
                  </div>
                </TD>

                <TD>
                  {canManage && !m.is_owner ? (
                    <Select
                      value={m.role_id ?? ""}
                      onValueChange={(v) => update.mutate({ id: m.membership_id, body: { role_id: v } })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="No role" />
                      </SelectTrigger>
                      <SelectContent>
                        {(roles.data?.data ?? []).map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-sm">{m.role_name ?? "—"}</span>
                  )}
                </TD>

                <TD>
                  {canManage && !m.is_owner ? (
                    <Select
                      value={m.status}
                      onValueChange={(v) => update.mutate({ id: m.membership_id, body: { status: v } })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="invited">Invited</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge tone={m.status === "active" ? "success" : m.status === "invited" ? "warning" : "danger"} dot>
                      {m.status}
                    </Badge>
                  )}
                </TD>

                <TD className="text-sm text-muted-foreground">
                  {m.last_login_at ? relativeTime(m.last_login_at) : "Never"}
                </TD>
                <TD className="text-sm text-muted-foreground">{formatDate(m.joined_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>

    <InviteSection canManage={canManage} />
    </div>
  );
}

/// Roles are viewable by anyone who reaches Settings, but only an owner can
/// change them; the org payload already says which you are.
function RolesGate() {
  const { data } = useQuery({
    queryKey: ["settings", "organization"],
    queryFn: () => get<Org>("settings/organization"),
  });
  return <RolesTab canManage={data?.can_edit ?? false} />;
}

/// Integrations are owner-only, like automation.
function IntegrationsGate() {
  const { data } = useQuery({
    queryKey: ["settings", "organization"],
    queryFn: () => get<Org>("settings/organization"),
  });
  return <IntegrationsTab canManage={data?.can_edit ?? false} />;
}

/// Automation is owner-only; the org payload already says whether you are one.
function AutomationsGate() {
  const { data } = useQuery({
    queryKey: ["settings", "organization"],
    queryFn: () => get<Org>("settings/organization"),
  });
  return <AutomationsTab canManage={data?.can_edit ?? false} />;
}
