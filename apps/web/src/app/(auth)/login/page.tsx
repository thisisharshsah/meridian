"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldRow, FormError } from "@/components/form/field";
import { submitSession } from "@/lib/auth-client";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type Values = z.infer<typeof schema>;

export default function LoginPage() {
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
      <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back to your workspace.</p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <FormError message={formError} />

        <FieldRow label="Work email" error={form.formState.errors.email?.message} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
        </FieldRow>

        <FieldRow label="Password" error={form.formState.errors.password?.message} htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!!form.formState.errors.password}
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

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No workspace yet?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
