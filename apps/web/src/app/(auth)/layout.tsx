import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { BarChart3, Boxes, Receipt, Users } from "lucide-react";

const PILLARS = [
  { icon: Users, title: "Sell", body: "Leads, deals and pipelines with a shared customer record." },
  { icon: Receipt, title: "Bill", body: "Quotes to invoices to payments, with the ledger kept straight." },
  { icon: Boxes, title: "Deliver", body: "Projects, tasks, timesheets and stock in one place." },
  { icon: BarChart3, title: "Understand", body: "Every module reporting into one set of numbers." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Story panel: hidden on small screens where the form is all that matters. */}
      <div className="relative hidden overflow-hidden bg-brand p-10 text-brand-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <Link href="/" className="relative flex items-center gap-2.5">
          <Logo size={30} className="[&>rect]:fill-white/15" />
          <span className="text-lg font-semibold tracking-tight">Aurovie Business</span>
        </Link>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Run the whole business from one workspace.
          </h1>
          <p className="mt-3 text-sm/relaxed opacity-80">
            Sales, finance, inventory, projects, people and support — sharing one customer
            record, one permission model and one source of numbers.
          </p>

          <dl className="mt-9 grid gap-5 sm:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <dt className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 opacity-80" />
                  {title}
                </dt>
                <dd className="mt-1 text-xs/relaxed opacity-70">{body}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-xs opacity-60">
          Self-hosted · Your data stays on your machine
        </p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
