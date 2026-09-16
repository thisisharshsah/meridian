import { ModuleScreen } from "@/components/module-screen";

/** Bar slot 2: whichever module the registry returns 1 places in. */
export default function ModuleSlot() {
  return <ModuleScreen slot={1} />;
}
