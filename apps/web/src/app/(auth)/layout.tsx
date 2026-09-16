import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { t } from "@suite/shared/i18n";
import { productName } from "@/lib/session";

/**
 * The shell every way in shares: sign in, sign up, accept an invitation.
 *
 * One composition at every width — the mark and the product's name, then a
 * card — rather than a marketing panel that existed only above `lg`. On a
 * phone that panel was simply absent, so the first screen a customer ever saw
 * carried no name at all, which for an installation sold as Aurovie Rooms is
 * the one place the name has to be.
 *
 * The ground is `brand-subtle`, which is a pale tint in light and a deep one
 * in dark, so the same rule gives a branded field in both themes instead of a
 * bright slab burning beside a near-black form.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const product = await productName(t("app.name"));
  return (
    <div className="relative min-h-dvh overflow-hidden bg-brand-subtle">
      {/* A texture, not a picture: it reads as a surface at any size and costs
          nothing to load. `currentColor` keeps it in the brand ink of whichever
          theme is active. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-brand opacity-[0.12]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* `my-auto` rather than `justify-center`: it centres while the block
          fits and collapses to nothing when it does not, so a tall form on a
          short window scrolls from its top instead of having its head cut off. */}
      <div className="relative flex min-h-dvh flex-col px-4">
      <div className="my-auto flex flex-col items-center py-10 sm:py-14">
        <Link href="/" className="flex items-center gap-2.5 text-brand-subtle-foreground">
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-tight">{product}</span>
        </Link>
        <p className="mt-2 max-w-sm text-center text-sm text-brand-subtle-foreground/80">
          {t("auth.pitch")}
        </p>

        <div className="mt-7 w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
          {children}
        </div>

        <p className="mt-6 text-xs text-brand-subtle-foreground/70">{t("auth.selfHosted")}</p>
      </div>
      </div>
    </div>
  );
}
