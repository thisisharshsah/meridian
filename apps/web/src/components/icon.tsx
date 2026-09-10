import {
  ArrowLeftRight, Banknote, BedDouble, BookOpen, Boxes, Briefcase, Building2, CalendarCheck,
  CalendarClock, CalendarOff, CheckSquare, ClipboardList, Clock, Contact, CreditCard, DoorOpen,
  FileMinus, FileText, Flag, FolderKanban, IdCard, Landmark, Layers, LayoutDashboard, LayoutGrid,
  LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Pill, Receipt, ReceiptText, Repeat,
  Settings, ShoppingBag, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse, Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * The API names icons as strings in its metadata. Mapping them explicitly keeps
 * the bundle to the icons we actually ship.
 *
 * The fallback below is silent by design — a missing icon must never be a
 * blank screen — which means nothing on this side notices a name that was
 * never mapped. `scripts/icon-lint.mjs` reads the names out of the Rust and
 * checks them against this list, because ten of them had quietly been
 * rendering as a generic glyph.
 */
const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Banknote, BedDouble, BookOpen, Boxes, Briefcase, Building2, CalendarCheck,
  CalendarClock, CalendarOff, CheckSquare, ClipboardList, Clock, Contact, CreditCard, DoorOpen,
  FileMinus, FileText, Flag, FolderKanban, IdCard, Landmark, Layers, LayoutDashboard, LayoutGrid,
  LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Pill, Receipt, ReceiptText, Repeat,
  Settings, ShoppingBag, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse, Wrench,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = ICONS[name] ?? List;
  return <Cmp className={className} />;
}

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? List;
}
