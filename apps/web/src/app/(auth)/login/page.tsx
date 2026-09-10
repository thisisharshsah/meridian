"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { FieldRow, FormError } from "@/components/form/field";
import { submitSession } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type Values = z.infer<typeof schema>;

/**
 * `useSearchParams` opts a component out of static prerendering, so the form
 * lives behind a Suspense boundary and the page's shell still renders at build
 * time. Without this the production build fails outright — dev never
 * prerenders, so it only shows up at `next build`.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginShell() {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{t("auth.signIn")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("auth.welcome")}</p>
      <div className="mt-7 space-y-4">
        <div className="h-14 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-14 animate-pulse rounded-md bg-surface-muted" />
        <div className="h-10 animate-pulse rounded-md bg-surface-muted" />
      </div>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await submitSession("login", values);
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fields)) {
        form.setError(field as keyof Values, { message });
      }
      if (!Object.keys(result.fields).length) setFormError(result.message);
      return;
    }
    router.replace(params.get("next") || "/");
    router.refresh();
  });

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{t("auth.signIn")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("auth.welcome")}</p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />

        <FieldRow label={t("auth.email")} error={form.formState.errors.email?.message} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            aria-invalid={!!form.formState.errors.email}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
        </FieldRow>

        <FieldRow label={t("auth.password")} error={form.formState.errors.password?.message} htmlFor="password">
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
            aria-describedby={form.formState.errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
        </FieldRow>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          Sign in
          {!form.formState.isSubmitting && <ArrowRight />}
        </Button>
      </form>

      {/* A self-hosted copy opens here with no accounts in it at all, so the
          way OUT of this screen matters as much as the way through it. A grey
          sentence asks a first-time owner to spot a link; a button does not. */}
      <div className="mt-6 border-t border-border pt-5 text-center">
        <p className="text-sm text-muted-foreground">{t("auth.firstTime")}</p>
        <Button variant="secondary" size="lg" className="mt-2 w-full" asChild>
          <Link href="/register">{t("auth.createWorkspace")}</Link>
        </Button>
      </div>
    </div>
  );
}
