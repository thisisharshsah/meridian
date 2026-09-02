"use client";

import * as React from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { useAppMeta, useSession } from "@/lib/queries";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: meta, isLoading } = useAppMeta();
  const { data: session } = useSession();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar modules={meta?.modules ?? []} loading={isLoading} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session} onSearch={() => setPaletteOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
