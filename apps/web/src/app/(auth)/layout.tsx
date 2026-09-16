import { EntryShell } from "@/components/brand/entry-shell";
import { t } from "@suite/shared/i18n";
import { productName } from "@/lib/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const product = await productName(t("app.name"));
  return <EntryShell product={product}>{children}</EntryShell>;
}
