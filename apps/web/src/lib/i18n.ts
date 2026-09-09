/**
 * Every word the product says, in one place.
 *
 * Two jobs at once. Translation: nothing here is written into a component, so
 * adding a language is adding a catalogue rather than hunting through JSX. And
 * plain English: the server's schema speaks in the vocabulary of the trade it
 * was modelled on -- "account", "lead", "ticket" -- and this is where those
 * become the words a shopkeeper already uses. The server keeps its own names,
 * which the API and every integration still depend on; only what a person
 * reads is changed.
 *
 * Server labels are overridden by key, so a term is renamed once and every
 * screen that renders it follows: list headers, form fields, empty states,
 * search results, the sidebar.
 */

import type { AppMeta, EntityMeta, FieldDef, ModuleMeta } from "@/lib/meta";

export type Locale = "en";

export const LOCALES: { code: Locale; name: string }[] = [{ code: "en", name: "English" }];

type Messages = Record<string, string>;

/**
 * Keys are structural, not sentences: `entity.<key>.one`, `field.<entity>.<name>`,
 * `help.<entity>.<name>`, `module.<key>`, and a flat namespace for chrome.
 * A translator sees where each string appears from the key alone.
 */
const en: Messages = {
  // ---- app chrome ----
  "app.name": "Aurovie Business",
  "nav.home": "Home",
  "nav.till": "Till",
  "nav.approvals": "Approvals",
  "nav.reports": "Reports",
  "nav.settings": "Settings",
  "nav.search": "Search",
  "nav.more": "More",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",
  "nav.collapse": "Collapse sidebar",
  "nav.collapseShort": "Collapse",
  "nav.expand": "Expand sidebar",

  "action.save": "Save changes",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.clear": "Clear",
  "action.open": "Open",
  "action.edit": "Edit",

  "action.signOut": "Sign out",
  "value.yes": "Yes",
  "value.no": "No",

  // ---- workspaces ----
  "workspace.switch": "Switch business",
  "workspace.switchFailed": "Could not switch business. Nothing has changed — try again.",
  "workspace.current": "Current business",
  "workspace.create": "Start another business",
  "workspace.createLede": "You already have an account, so this only needs a name. Roles, numbering and ownership are set up for you.",
  "workspace.name": "Business name",
  "workspace.currency": "Currency",
  "workspace.currencyHint": "What this business charges in. Each one keeps its own.",
  "workspace.nameRequired": "Give the business a name",
  "workspace.created": "{name} is ready",
  "workspace.failed": "Could not create that business. Nothing was changed — try again.",

  "invite.waiting": "Invitations",
  "invite.join": "Join {name}",
  "invite.accepted": "You have joined {name}",
  "invite.failed": "Could not accept that invitation. It may have been withdrawn.",

  "choose.title": "Welcome, {name}",
  "choose.titleReturning": "Welcome back, {name}",
  "choose.ledeReturning": "Choose which business you are working in.",
  "choose.yours": "Your businesses",
  "choose.yoursLede": "Pick one to open it. You can switch at any time from the account menu.",
  "choose.enterFailed": "Could not open that business. Try again in a moment.",
  "choose.lede": "Your account is ready. Now pick where you are working.",
  "choose.invited": "You have been invited",
  "choose.invitedLede": "Sent to {email}.",
  "choose.accept": "Join",
  "choose.start": "Start your own",
  "choose.startLede": "Set up a business you run. You can be part of others at the same time.",
  "choose.noneWaiting": "No invitations are waiting for {email}. If you expected one, ask whoever invited you to send it to this address.",

  "palette.label": "Search",
  "palette.close": "Close search",
  "palette.placeholder": "Search records, or jump to a screen…",
  "palette.goTo": "Go to",
  "palette.nothing": "Nothing found.",
  "palette.hint": "Type to search your records.",

  // ---- first run ----
  "setup.title": "Your first week",
  "setup.lede": "Put in what the business already knows. Each step uses the one before it, and this page fills itself in as you go.",
  "setup.product.title": "Add what you sell",
  "setup.product.why": "Goods or services. They go on quotes, invoices and the till, and stock is counted from here.",
  "setup.product.cta": "Add a product",
  "setup.after": "After this week: invoices go out and payments come in daily, staff clock in, payroll runs monthly — and the year\u2019s figures build themselves from all of it.",
  "setup.progress": "{done} of {total} done",
  "setup.hide": "I know my way around — hide this",
  "setup.customer.title": "Add a customer",
  "setup.customer.why": "Someone you sell to. Deals and invoices both attach to one, so this comes first.",
  "setup.deal.title": "Add a deal you are chasing",
  "setup.deal.why": "Work you hope to win. Deals are what fill the pipeline figure below.",
  "setup.invoice.title": "Send your first invoice",
  "setup.invoice.why": "Bill a customer for work done. Unpaid invoices become the receivable figure.",
  "setup.team.title": "Invite your team",
  "setup.team.why": "Give the people who work with you their own sign-in, with only the access they need.",
  "launcher.title": "Where things live",
  "launcher.lede": "Tap an area to open it. Everything else is under More.",

  // ---- clocking ----
  "clock.notIn": "Not clocked in",
  "clock.startWhenReady": "Start your day when you are ready.",
  "clock.workingSince": "Working since {time}",
  "clock.soFar": "{duration} so far",
  "clock.doneToday": "Done for today — {duration}",
  "clock.in": "Clock in",
  "clock.out": "Clock out",
  "clock.todaysShift": "Today’s shift",
  "clock.noShift": "none scheduled",
  "clock.thisWeek": "This week",

  // ---- till ----
  "till.searchPlaceholder": "Scan a barcode or search…",
  "till.thisSale": "This sale",
  "till.tapToStart": "Tap a product to start.",
  "till.total": "Total",
  "till.cashGiven": "Cash given",
  "till.change": "Change",
  "till.notEnough": "Not enough",
  "till.takePayment": "Take payment",
  "till.takenToday": "Taken today",
  "till.noProducts": "No products yet",
  "till.noProductsWhy": "Add what you sell under Inventory and it will appear here.",
  "till.method.cash": "Cash",
  "till.method.card": "Card",
  "till.method.transfer": "Transfer",

  // ---- approvals and reports ----
  "approvals.title": "Approvals",
  "approvals.lede": "Records held until somebody signs them off.",
  "approvals.waitingOnYou": "Waiting on you",
  "approvals.youAskedFor": "You asked for",
  "approvals.decided": "Decided",
  "approvals.approve": "Approve",
  "approvals.reject": "Reject",
  "approvals.comment": "Comment (optional)",
  "reports.title": "Reports",
  "reports.lede": "Read-only views across the whole workspace.",
  "reports.from": "From",
  "reports.thisYear": "This financial year",
  "reports.lastYear": "Last financial year",
  "reports.reorder": "Reorder",
  "reports.outOfStock": "Out of stock",
  "reports.noneTitle": "No reports available",
  "reports.noneBody": "Reports appear here once your role can view the underlying records.",
  "reports.emptyTitle": "Nothing to show",
  "reports.emptyBody": "No records fall inside this date range.",

  // ---- settings and invitations ----
  "settings.title": "Workspace settings",
  "settings.lede": "Your organization, the people in it, and what each role can reach.",
  "settings.tab.organization": "Organization",
  "settings.tab.members": "Members",
  "settings.tab.roles": "Roles",
  "settings.tab.automation": "Automation",
  "settings.tab.integrations": "Integrations",
  "settings.ownerOnly": "Only an owner can change these settings.",
  "settings.atAGlance": "At a glance",
  "settings.col.person": "Person",
  "settings.col.role": "Role",
  "settings.col.status": "Status",
  "settings.col.lastSeen": "Last seen",
  "settings.col.joined": "Joined",
  "settings.status.owner": "Owner",
  "settings.status.active": "Active",
  "settings.status.invited": "Invited",
  "settings.status.suspended": "Suspended",
  "settings.currencyHint": "Every stored amount is in this currency.",
  "settings.noRole": "No role",
  "invite.pending": "Pending invitations",
  "invite.someone": "Invite someone",
  "invite.ready": "Invitation ready",
  "invite.done": "Done",
  "invite.createLink": "Create link",
  "invite.noneOutstanding": "No invitations outstanding",
  "invite.revoke": "Revoke",
  "invite.emailPlaceholder": "colleague@company.com",
  "invite.rolePlaceholder": "Choose a role",
  "invite.optional": "Optional.",
  "invite.titlePlaceholder": "Account Executive",

  // ---- modules: plainer than the trade's own shorthand ----
  "module.crm": "Customers",
  "module.sales": "Sales",
  "module.books": "Finance",
  "module.inventory": "Inventory",
  "module.projects": "Projects",
  "module.hr": "People",
  "module.desk": "Support",
  "module.marketing": "Marketing",
  "module.recruit": "Hiring",

  // ---- entities ----
  // "Account" is bookkeeping vocabulary for what everyone else calls a company,
  // and this list holds customers, suppliers and competitors alike.
  "entity.crm.accounts.one": "Company",
  "entity.crm.accounts.many": "Companies",
  // A lead is someone who got in touch and has not been qualified yet.
  "entity.crm.leads.one": "Enquiry",
  "entity.crm.leads.many": "Enquiries",
  "entity.crm.activities.one": "Contact log",
  "entity.crm.activities.many": "Contact log",
  "entity.desk.tickets.one": "Support request",
  "entity.desk.tickets.many": "Support requests",
  "entity.desk.articles.one": "Help article",
  "entity.desk.articles.many": "Help articles",
  "entity.inventory.stock_moves.one": "Stock change",
  "entity.inventory.stock_moves.many": "Stock changes",
  "entity.inventory.items.one": "Product",
  "entity.inventory.items.many": "Products",
  "entity.inventory.vendors.one": "Supplier",
  "entity.inventory.vendors.many": "Suppliers",
  "entity.projects.timesheets.one": "Time log",
  "entity.projects.timesheets.many": "Time logs",
  "entity.recruit.candidates.one": "Applicant",
  "entity.recruit.candidates.many": "Applicants",
  "entity.recruit.openings.one": "Job opening",
  "entity.recruit.openings.many": "Job openings",

  // ---- fields ----
  "field.crm.accounts.name": "Company name",
  "field.crm.accounts.account_type": "Relationship",
  "field.inventory.items.sku": "Your product code",
  "field.inventory.items.barcode": "Barcode",
  "field.books.invoices.number": "Invoice number",
  "field.sales.counter_sales.number": "Receipt",
  "field.hr.attendance.worked_minutes": "Minutes worked",

  // ---- help: the rules a first-timer would otherwise guess wrong ----
  "help.crm.deals.probability": "How likely is this to close? A number from 0 to 100.",
  "help.crm.deals.amount": "What the work is worth, before tax.",
  "help.crm.accounts.account_type": "Whether you sell to them, buy from them, or neither yet.",
  "help.inventory.items.sku": "Your own code for this product. Leave blank if you don’t use one.",
  "help.inventory.items.barcode": "The number printed on the packet. Scanning at the till finds it by this.",
  "help.inventory.items.item_type": "Goods sit on a shelf and are counted. A service is time or labour and is not.",
  "help.inventory.items.sell_price": "What the customer pays, before tax.",
  "help.inventory.items.cost_price": "What it costs you. Used to work out profit, never shown to customers.",
  "help.books.invoices.due_date": "The date you expect to be paid by.",
  "help.books.invoices.account_id": "Who is being billed.",
  "help.hr.employees.annual_salary": "Full year’s pay before deductions, even for part-time staff.",
  "help.hr.attendance.work_date": "The day being recorded. A night shift belongs to the day it started.",
  "help.hr.shifts.starts_at": "When they are due in. Clocking in later than this marks the day late.",
  "help.hr.pay_runs.period_start": "First day this run pays for.",
  "help.hr.payslips.gross": "Pay before anything is taken off.",
  "help.hr.payslips.deductions": "Tax, pension and anything else withheld.",
  "help.sales.counter_sales.amount_tendered": "What the customer handed over. Change is worked out for you.",
  "help.sales.counter_sales.account_id": "Only if they want it on account. Leave blank for a passing customer.",
};

const CATALOGUES: Record<Locale, Messages> = { en };

let active: Locale = "en";

/** Swap catalogues. Kept deliberately simple: the caller reloads afterwards. */
export function setLocale(next: Locale) {
  if (CATALOGUES[next]) active = next;
}

export function getLocale(): Locale {
  return active;
}

/** Look up a message. Unknown keys fall back rather than rendering the key. */
export function t(key: string, fallback?: string, vars?: Record<string, string | number>): string {
  const raw = CATALOGUES[active]?.[key] ?? CATALOGUES.en[key] ?? fallback ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m));
}

function pick(key: string, serverValue: string): string {
  const raw = CATALOGUES[active]?.[key] ?? CATALOGUES.en[key];
  return raw ?? serverValue;
}

function localizeField(entity: string, f: FieldDef): FieldDef {
  const label = pick(`field.${entity}.${f.name}`, f.label);
  const help = CATALOGUES[active]?.[`help.${entity}.${f.name}`]
    ?? CATALOGUES.en[`help.${entity}.${f.name}`]
    ?? f.help;
  return label === f.label && help === f.help ? f : { ...f, label, help };
}

/**
 * Applied where the metadata arrives rather than where it is rendered, so every
 * screen built from the registry -- lists, forms, detail pages, search, the
 * sidebar -- speaks the same vocabulary without any of them knowing about it.
 */
export function localizeEntityMeta(meta: EntityMeta): EntityMeta {
  return {
    ...meta,
    label: pick(`entity.${meta.key}.one`, meta.label),
    label_plural: pick(`entity.${meta.key}.many`, meta.label_plural),
    fields: meta.fields.map((f) => localizeField(meta.key, f)),
  };
}

export function localizeModule(m: ModuleMeta): ModuleMeta {
  return {
    ...m,
    label: pick(`module.${m.key}`, m.label),
    entities: m.entities.map((e) => ({
      ...e,
      label: pick(`entity.${e.key}.one`, e.label),
      label_plural: pick(`entity.${e.key}.many`, e.label_plural),
    })),
  };
}

export function localizeAppMeta(meta: AppMeta): AppMeta {
  return { ...meta, modules: meta.modules.map(localizeModule) };
}
