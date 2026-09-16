import { ModuleScreen } from "@/components/module-screen";

/** Bar slot 3: whichever module the registry returns 2 places in. */
export default function ModuleSlot() {
  return <ModuleScreen slot={2} />;
}
