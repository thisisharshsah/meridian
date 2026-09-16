import { ModuleScreen } from "@/components/module-screen";

/** Bar slot 1: whichever module the registry returns 0 places in. */
export default function ModuleSlot() {
  return <ModuleScreen slot={0} />;
}
