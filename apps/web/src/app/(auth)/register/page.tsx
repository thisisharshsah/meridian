"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldRow, FormError } from "@/components/form/field";
import { submitSession } from "@/lib/auth-client";
import { CURRENCIES } from "@/lib/constants";

const schema = z.object({
  name: z.string().min(1, "Your name is required"),
  organization: z.string().min(1, "Organization name is required"),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
  currency: z.string().min(3),
});

type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", organization: "", email: "", password: "", currency: "USD" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const result = await submitSession("register", values);
    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fields)) {
        form.setError(field as keyof Values, { message });
      }
      if (!Object.keys(result.fields).length) setFormError(result.message);
      return;
    }
    router.replace("/");
    router.refresh();
  });

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight">Create your workspace</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You will be the owner, with full access to every module.
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />

        <FieldRow label="Your name" error={form.formState.errors.name?.message} htmlFor="name" required>
          <Input id="name" autoFocus placeholder="Ada Lovelace" aria-invalid={!!form.formState.errors.name}
            aria-describedby={form.formState.errors.name ? "name-error" : undefined} {...form.register("name")} />
        </FieldRow>

        <FieldRow
          label="Organization"
          error={form.formState.errors.organization?.message}
          htmlFor="organization"
          required
        >
          <Input
            id="organization"
            placeholder="Acme Industries"
            aria-invalid={!!form.formState.errors.organization}
            aria-describedby={form.formState.errors.organization ? "organization-error" : undefined}
            {...form.register("organization")}
          />
        </FieldRow>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <FieldRow label="Work email" error={form.formState.errors.email?.message} htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={!!form.formState.errors.email}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
              {...form.register("email")}
            />
          </FieldRow>

          <FieldRow label="Currency" htmlFor="currency">
            <Select
              value={form.watch("currency")}
              onValueChange={(v) => form.setValue("currency", v, { shouldDirty: true })}
            >
              <SelectTrigger id="currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        </div>

        <FieldRow
          label="Password"
          error={form.formState.errors.password?.message}
          htmlFor="password"
          hint="At least 8 characters."
          required
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
            aria-describedby={form.formState.errors.password ? "password-error" : "password-hint"}
            {...form.register("password")}
          />
        </FieldRow>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Create workspace
          {!form.formState.isSubmitting && <ArrowRight />}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
