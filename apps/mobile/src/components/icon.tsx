import {
  ArrowLeftRight, Banknote, BedDouble, BookOpen, Boxes, Briefcase, Building2, CalendarCheck,
  CalendarClock, CalendarOff, CheckSquare, ClipboardList, Clock, Contact, CreditCard, DoorOpen,
  FileMinus, FileText, Flag, FolderKanban, IdCard, Landmark, Layers, LayoutDashboard, LayoutGrid,
  LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Pill, Receipt, ReceiptText, Repeat,
  Settings, ShoppingBag, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse, Wrench,
  type LucideIcon,
} from "lucide-react-native";

/**
 * The same names the API sends and the same list the web draws, so a module
 * looks like itself on both. `scripts/icon-lint.mjs` checks this file against
 * the names in the Rust: the fallback is silent, so nothing here would notice
 * a name that was never mapped.
 */
const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Banknote, BedDouble, BookOpen, Boxes, Briefcase, Building2, CalendarCheck,
  CalendarClock, CalendarOff, CheckSquare, ClipboardList, Clock, Contact, CreditCard, DoorOpen,
  FileMinus, FileText, Flag, FolderKanban, IdCard, Landmark, Layers, LayoutDashboard, LayoutGrid,
  LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Pill, Receipt, ReceiptText, Repeat,
  Settings, ShoppingBag, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse, Wrench,
};

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  const Cmp = ICONS[name] ?? List;
  return <Cmp size={size} color={color} />;
}
