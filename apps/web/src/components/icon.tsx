import {
  ArrowLeftRight, Banknote, BookOpen, Boxes, Briefcase, Building2, CalendarCheck, CalendarOff,
  CheckSquare, ClipboardList, Clock, Contact, CreditCard, FileMinus, FileText, Flag, FolderKanban,
  IdCard, LayoutDashboard, LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Receipt,
  Repeat, Settings, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * The API names icons as strings in its metadata. Mapping them explicitly keeps
 * the bundle to the icons we actually ship and makes a typo obvious instead of
 * rendering nothing.
 */
const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Banknote, BookOpen, Boxes, Briefcase, Building2, CalendarCheck, CalendarOff,
  CheckSquare, ClipboardList, Clock, Contact, CreditCard, FileMinus, FileText, Flag, FolderKanban,
  IdCard, LayoutDashboard, LifeBuoy, List, Megaphone, MessageSquare, Network, Package, Receipt,
  Repeat, Settings, ShoppingCart, Target, Ticket, Truck, UserCog, UserPlus, UserSearch, Users,
  Warehouse,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = ICONS[name] ?? List;
  return <Cmp className={className} />;
}

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? List;
}
