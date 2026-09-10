"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Mail, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/misc";
import { FieldRow, FormError } from "@/components/form/field";
import { ApiError, del, get, post } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { t } from "@/lib/i18n";

type Role = { id: string; key: string; name: string; is_system: boolean };
type Invite = {
  id: string; email: string; title: string | null; role_name: string | null;
  invited_by_name: string | null; expires_at: string; expired: boolean; created_at: string;
};

/**
 * There is no mail server, so the invitation link is produced here for the
 * inviter to send however they like. It is shown once — the server keeps only a
 * digest — so the dialog makes copying it the obvious next step.
 */
export function InviteSection({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const invites = useQuery({
    queryKey: ["settings", "invitations"],
    queryFn: () => get<{ data: Invite[] }>("settings/invitations"),
    enabled: canManage,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => del(`settings/invitations/${id}`),
    onSuccess: () => {
      toast.success(t("invite.revoked"));
      qc.invalidateQueries({ queryKey: ["settings", "invitations"] });
    },
    onError: () => toast.error(t("invite.revokeFailed")),
  });

  if (!canManage) return null;

  const pending = invites.data?.data ?? [];

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>{t("invite.pending")}</CardTitle>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <UserPlus />
          {t("invite.someone")}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {pending.length === 0 ? (
          <EmptyState
            icon={Mail}
            title={t("invite.noneOutstanding")}
            description={t("invite.handItOver")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.role_name}
                    {i.title ? ` · ${i.title}` : ""} · invited {relativeTime(i.created_at)}
                    {i.invited_by_name ? ` by ${i.invited_by_name}` : ""}
                  </p>
                </div>
                <span className={i.expired ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
                  {i.expired ? "Expired" : `Expires ${formatDate(i.expires_at)}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("invite.revoke")}
                  onClick={() => revoke.mutate(i.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <InviteDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ["settings", "roles"],
    queryFn: () => get<{ data: Role[] }>("settings/roles"),
  });

  const [email, setEmail] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setTitle("");
    setErrors({});
    setFormError(null);
    setLink(null);
    setCopied(false);
    // Default to the least privileged role rather than whichever sorts first.
    const viewer = roles.data?.data.find((r) => r.key === "viewer");
    setRoleId(viewer?.id ?? roles.data?.data[0]?.id ?? "");
  }, [open, roles.data]);

  const create = useMutation({
    mutationFn: () =>
      post<{ path: string }>("settings/invitations", {
        email,
        role_id: roleId,
        title: title || undefined,
      }),
    onSuccess: (r) => {
      setLink(`${window.location.origin}${r.path}`);
      qc.invalidateQueries({ queryKey: ["settings", "invitations"] });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(e.fieldMap);
        if (!Object.keys(e.fieldMap).length) setFormError(e.message);
      } else {
        setFormError("Could not create that invitation");
      }
    },
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is blocked in some contexts; the link stays selectable.
      toast.message(t("invite.copyManually"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("invite.ready")}</DialogTitle>
              <DialogDescription>
                Send this link to {email}. It works once, expires in 14 days, and cannot be
                retrieved again — so copy it now.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-2">
                <Link2 className="size-4 shrink-0 text-subtle-foreground" />
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{link}</code>
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                {t("invite.done")}
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
          >
            <DialogHeader>
              <DialogTitle>{t("invite.someone")}</DialogTitle>
              <DialogDescription>
                You will get a link to pass on yourself — this workspace does not send email.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <FormError message={formError} />

              <FieldRow label={t("invite.email")} htmlFor="invite-email" error={errors.email} required>
                <Input
                  id="invite-email"
                  type="email"
                  autoFocus
                  placeholder={t("invite.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!errors.email}
                />
              </FieldRow>

              <FieldRow label={t("invite.role")} htmlFor="invite-role" error={errors.role_id} required>
                <Select value={roleId} onValueChange={setRoleId}>
                  <SelectTrigger id="invite-role">
                    <SelectValue placeholder={t("invite.rolePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles.data?.data ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>

              <FieldRow label="Job title" htmlFor="invite-title" hint={t("invite.optional")}>
                <Input
                  id="invite-title"
                  placeholder={t("invite.titlePlaceholder")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FieldRow>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t("action.cancel")}
              </Button>
              <Button type="submit" variant="primary" loading={create.isPending} disabled={!roleId}>
                {t("invite.createLink")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
