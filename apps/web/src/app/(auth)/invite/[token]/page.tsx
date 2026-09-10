"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, MailWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/misc";
import { FieldRow, FormError } from "@/components/form/field";
import { ApiError, get } from "@/lib/api";
import { t } from "@/lib/i18n";

type Preview = {
  email: string;
  organization: string;
  role_name: string;
  has_account: boolean;
};

/**
 * Accepting an invitation. The link itself is the credential, so the page shows
 * only what the invitee already knows (their address, the workspace name) until
 * they authenticate.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => get<Preview>(`invitations/${token}`),
    retry: false,
  });

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    const message =
      error instanceof ApiError ? error.message : "This invitation link is not valid.";
    return (
      <div className="text-center">
        <div className="mx-auto mb-3 w-fit rounded-full bg-warning-subtle p-3">
          <MailWarning className="size-5 text-warning" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{t("auth.inviteUnavailable")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <p className="mt-1 text-xs text-subtle-foreground">
          {t("auth.linkStale")}
        </p>
        <Button variant="secondary" className="mt-5" asChild>
          <Link href="/login">{t("auth.goToSignIn")}</Link>
        </Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      // Accept, then sign in with the same credentials so the invitee lands
      // inside the workspace rather than on a login form.
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || undefined, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const err = body?.error;
        const map: Record<string, string> = Object.fromEntries(
          (err?.fields ?? []).map((f: { field: string; message: string }) => [f.field, f.message]),
        );
        setErrors(map);
        if (!Object.keys(map).length) setFormError(err?.message ?? "Could not accept this invitation");
        return;
      }

      const login = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.email, password }),
      });
      if (login.ok) {
        router.replace("/");
        router.refresh();
      } else {
        router.replace("/login");
      }
    } catch {
      setFormError("Cannot reach the server. Is it running?");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Join {data.organization}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("auth.invitedAs", undefined, { role: data.role_name })}
      </p>

      <div className="mt-5 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
        {data.email}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <FormError message={formError} />

        {!data.has_account && (
          <FieldRow label={t("auth.yourName")} htmlFor="invite-name" error={errors.name}>
            <Input
              id="invite-name"
              autoFocus
              placeholder={t("auth.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FieldRow>
        )}

        <FieldRow
          label={data.has_account ? "Your password" : "Choose a password"}
          htmlFor="invite-password"
          error={errors.password}
          hint={
            data.has_account
              ? "You already have an account with this address."
              : "At least 8 characters."
          }
          required
        >
          <PasswordInput
            id="invite-password"
            autoFocus={data.has_account}
            autoComplete={data.has_account ? "current-password" : "new-password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "invite-password-error" : "invite-password-hint"}
          />
        </FieldRow>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={saving}>
          Join {data.organization}
          {!saving && <ArrowRight />}
        </Button>
      </form>
    </div>
  );
}
