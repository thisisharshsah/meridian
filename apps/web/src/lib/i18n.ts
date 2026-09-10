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
  // Next puts the page's own name where the %s is.
  "app.titleTemplate": "%s · {app}",
  "app.tagline": "One workspace for sales, finance, projects, people and support.",
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
  "action.add": "Add",
  "action.addLine": "Add line",
  "action.tryAgain": "Try again",
  "action.next": "Next",
  "action.previous": "Previous",
  "action.viewTable": "Table",
  "action.viewBoard": "Board",
  "action.moreDetails": "More details",
  "action.optionalCount": "(optional, {n})",
  "action.createOne": "Create {thing}",

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
  "setup.room.title": "List your rooms",
  "setup.room.why": "Number, type and nightly rate. Everything else — bookings, arrivals, the board — hangs off this.",
  "setup.room.cta": "Add a room",
  "setup.booking.title": "Take your first booking",
  "setup.booking.why": "A guest, a room and two dates. Nights and the total work themselves out, and the room cannot be double-booked.",
  "setup.booking.cta": "Add a booking",
  "setup.batch.title": "Record a delivery",
  "setup.batch.why": "Batch number and expiry. Sales then take the oldest first, and the expiry report tells you what to pull.",
  "setup.batch.cta": "Add a batch",
  "setup.sale.title": "Ring up a sale",
  "setup.sale.why": "Serve someone over the counter. Stock comes down and the day’s takings add up as you go.",
  "setup.sale.cta": "Open the till",
  "setup.project.title": "Open a job",
  "setup.project.why": "The work you are doing for a customer. Time logged against it becomes the invoice.",
  "setup.project.cta": "Add a job",
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
  "reports.pick": "Report",
  "reports.from": "From",
  "reports.to": "To",
  "reports.thisYear": "This financial year",
  "reports.lastYear": "Last financial year",
  "reports.reorder": "Reorder",
  "reports.expired": "Expired",
  "reports.expiring": "Expiring",
  "reports.occupied": "Occupied",
  "reports.booked": "Booked",
  "reports.free": "Free",
  "reports.cleaning": "Being cleaned",
  "reports.outOfService": "Out of service",
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

  "entity.inventory.item_batches.one": "Batch",
  "entity.inventory.item_batches.many": "Batches",
  "entity.hospitality.rooms.one": "Room",
  "entity.hospitality.rooms.many": "Rooms",
  "entity.hospitality.reservations.one": "Booking",
  "entity.hospitality.reservations.many": "Bookings",
  "module.hospitality": "Rooms",

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

  // ---- signing in and signing up ----
  "auth.signIn": "Sign in",
  "auth.welcome": "Welcome back to your workspace.",
  "auth.email": "Work email",
  "auth.password": "Password",
  "auth.firstTime": "First time here?",
  "auth.createWorkspace": "Create a new workspace",
  "auth.createAccount": "Create your account",
  "auth.intent": "What are you here to do?",
  "auth.yourName": "Your name",
  "auth.namePlaceholder": "Ada Lovelace",
  "auth.businessName": "Business name",
  "auth.businessPlaceholder": "Rivera Plumbing",
  "auth.currency": "Currency",
  "auth.inviteUnavailable": "Invitation unavailable",
  "auth.goToSignIn": "Go to sign in",
  "auth.linkStale": "Ask whoever invited you to send a fresh link.",
  "auth.invitedAs": "You have been invited as {role}.",
  "auth.pitch": "Run the whole business from one workspace.",
  "auth.haveAccount": "Already have an account?",

  // ---- home ----
  "dash.stale": "These figures are out of date",
  "dash.openPipeline": "Open pipeline",
  "dash.won": "Won",
  "dash.receivable": "Receivable",
  "dash.openTickets": "Open tickets",
  "dash.pipelineByStage": "Pipeline by stage",
  "dash.noDeals": "No open deals",
  "dash.noDealsWhy": "Add a deal to see your pipeline.",
  "dash.invoicesByStatus": "Invoices by status",
  "dash.noInvoices": "No invoices yet",
  "dash.noInvoicesWhy": "Bill a customer to see this chart.",
  "dash.nothingOverdue": "Nothing overdue",
  "dash.nothingOverdueWhy": "Every invoice is inside its terms.",
  "dash.latestDeals": "Latest deals",
  "dash.noDealsYet": "No deals yet",
  "dash.noDealsYetWhy": "Your newest deals will show up here.",
  "dash.loading": "Loading",
  "dash.progress": "Setup progress",
  "dash.allDeals": "All deals",
  "dash.allInvoices": "All invoices",
  "dash.dueOn": "Due {date}",
  "dash.daysLate.one": "{n} day late",
  "dash.daysLate.other": "{n} days late",
  "dash.overdueInvoices": "Overdue invoices",

  // ---- records ----
  "record.details": "Details",
  "record.history": "History",
  "record.totals": "Totals",
  "record.gone": "It may have been deleted, or you may not have access to it.",
  "record.deleteFailed": "Could not delete this record",
  "record.backHome": "Back to home",
  "record.select": "Select…",
  "record.searchPlaceholder": "Search…",
  "record.searching": "Searching…",
  "record.all": "All",
  "record.nothingYet": "Nothing yet",
  "record.nothingYetWhy": "Changes to this record will appear here.",
  "record.drag": "Drag",
  "record.noLines": "No lines yet",
  "record.noLinesWhy": "Add the products or services this document covers.",
  "record.item": "Item",
  "record.amount": "Amount",
  "record.removeLine": "Remove line",
  "record.convert": "Convert",
  "record.convertLead": "Convert lead",
  "record.leadConverted": "Lead converted",
  "record.dealName": "Deal name",
  "record.expectedClose": "Expected close",
  "record.createInvoice": "Create invoice",
  "record.generateNow": "Generate now",
  "record.issueInvoice": "Issue invoice",
  "record.alsoOpenDeal": "Also open a deal",
  "record.alsoOpenDealWhy": "Starts in Qualification so it shows on the pipeline board.",
  "record.cannotUndo": "This cannot be undone.",
  "record.close": "Close",

  // ---- clocking on ----
  "clock.inDone": "Clocked in",
  "clock.inFailed": "Could not clock you in. Try again in a moment.",
  "clock.outDone": "Clocked out",
  "clock.outFailed": "Could not clock you out. Try again in a moment.",

  // ---- workspace settings ----
  "settings.updated": "Workspace updated",
  "settings.memberUpdated": "Member updated",
  "settings.orgName": "Name",
  "settings.baseCurrency": "Base currency",
  "settings.country": "Country",
  "settings.workspaceUrl": "Workspace URL",
  "settings.members": "Members",
  "settings.roles": "Roles",
  "settings.timezone": "Time zone",
  "settings.created": "Created",

  // ---- invitations, the till, and the chrome ----
  "invite.revoked": "Invitation revoked",
  "invite.revokeFailed": "Could not revoke that invitation",
  "invite.handItOver": "Invite a colleague and hand them the link yourself — this workspace does not send email.",
  "invite.copyManually": "Select the link and copy it manually",
  "invite.email": "Email",
  "invite.role": "Role",
  "till.saleFailed": "The sale did not go through. Nothing was charged — try again.",
  "till.scanLabel": "Scan a barcode or search products",
  "nav.primary": "Primary",
  "nav.home.aria": "{app} home",
  "nav.toggleTheme": "Toggle theme",

// ---- approvals ----
  "approvals.approved": "Approved",
  "approvals.rejected": "Rejected",
  "approvals.decisionFailed": "Could not record that decision",
  "approvals.noneDecided": "Nothing decided yet",
  "approvals.rulesNote": "Approval rules are configured under Settings.",

  // ---- fallbacks and small words ----
  "value.untitled": "Untitled",
  "value.never": "Never",
  "value.none": "No account",
  "value.new": "New",
  "value.done": "Done",
  "value.owner": "Owner",
  "value.expired": "Expired",
  "value.thisWorkspace": "your workspace",
  "value.thisCompany": "this company",
  "value.thisPerson": "this person",
  "value.sale": "Sale",
  "value.copy": "Copy",
  "value.copied": "Copied",
  "value.noMatches": "No matches",

  "dash.openDealCount.one": "{n} open deal",
  "dash.openDealCount.other": "{n} open deals",
  "dash.wonWhy": "Closed won, all time",
  "dash.receivableWhy": "Outstanding on unpaid invoices",
  "dash.ticketsWhy": "Awaiting a response or fix",
  "dash.addDeal": "Add a deal",
  "dash.createInvoice": "Create an invoice",
  "dash.inviteSomeone": "Invite someone",
  "dash.noOpenDeals": "No open deals.",
  "dash.noInvoicesShort": "No invoices yet.",

  "auth.pitch.sell": "Sell",
  "auth.pitch.sellWhy": "Leads, deals and pipelines with a shared customer record.",
  "auth.pitch.bill": "Bill",
  "auth.pitch.billWhy": "Quotes to invoices to payments, with the ledger kept straight.",
  "auth.pitch.deliver": "Deliver",
  "auth.pitch.deliverWhy": "Projects, tasks, timesheets and stock in one place.",
  "auth.pitch.understand": "Understand",
  "auth.pitch.understandWhy": "Every module reporting into one set of numbers.",
  "auth.tagline": "One workspace for sales, finance, projects, people and support.",
  "auth.nameTheBusiness": "Give the business a name",
  "auth.ownerNote": "You will own this business, with full access to everything in it.",
  "auth.invitedNote": "Sign up, then accept the invitation waiting for your email address.",
  "auth.startingLabel": "I’m starting a business",
  "auth.startingHint": "Set it up now",
  "auth.invitedLabel": "I was invited",
  "auth.invitedHint": "Join someone else’s",
  "auth.passwordHint": "At least 8 characters.",
  "auth.yourPassword": "Your password",
  "auth.choosePassword": "Choose a password",
  "auth.linkInvalid": "This invitation link is not valid.",
  "auth.haveAccountAlready": "You already have an account with this address.",
  "auth.nameRequired": "Your name is required",
  "auth.emailRequired": "Email is required",
  "auth.emailInvalid": "Enter a valid email address",
  "auth.passwordShort": "Use at least 8 characters",
  "auth.passwordRequired": "Password is required",
  "auth.noServer": "Cannot reach the server. Is it running?",
  "settings.saveFailed": "Could not save those settings",
  "record.somethingWrong": "Something went wrong. Please try again.",
  "invite.createFailed": "Could not create that invitation",
  "role.saveFailed": "Could not save that role",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",

  "record.moveFailed": "Could not move that card",
  "record.gateTitle": "We couldn’t open this screen",
  "record.gateBody": "This screen may have been renamed or removed. Head back home and pick it from the menu.",
  "record.newLine": "New line",
  "record.addLineFailed": "Could not add a line",
  "record.saveLineFailed": "Could not save that change",
  "record.offline": "Nothing has been lost. Check your connection and try again in a moment.",
  "record.signInAgain": "Please sign in again",
  "record.invoiceIssued": "Invoice issued",
  "record.actionFailed": "That action could not be completed",
  "record.convertFailed": "Could not convert this lead",
  "record.updateDetails": "Update the details below.",
  "record.memberFailed": "Could not update that member",

  "role.deleteFailed": "Could not delete that role",
  "role.updated": "Role updated",
  "role.created": "Role created",
  "role.edit": "Edit role",
  "role.save": "Save role",
  "role.create": "Create role",
  "role.duplicateOf": "Duplicate {name}",
  "role.clearModule": "Clear module",
  "role.grantEverything": "Grant everything",

  // ---- what this business uses ----
  "shape.tab": "Sections",
  "shape.promptTitle": "What kind of business is this?",
  "shape.promptLede": "Pick the closest one and the menu is trimmed to match. Nothing is deleted, and nothing is locked — this only decides what you see.",
  "shape.changeable": "You can change this any time under Settings.",
  "shape.showAll": "Show me everything",
  "shape.title": "What this business uses",
  "shape.lede": "Switch off the parts you do not need and they leave the menu. Records already saved stay where they are, and a link to one still opens.",
  "shape.note": "Hiding a section changes nobody’s access.",
  "shape.needOne": "Keep at least one section switched on.",
  "shape.onPackage": "This workspace is on {product}.",
  "shape.notIncluded": "Not in your package",
  "shape.notIncludedWhy": "These exist in the product but are not part of {product}. Talk to whoever sold you this to add them.",
  "shape.saved": "Menu updated",
  "shape.failed": "Could not change that. Nothing has moved — try again.",
  "shape.deniedTitle": "Only an owner can change this",
  "shape.deniedBody": "Ask an owner of this workspace to switch sections on or off.",

  // ---- roles ----
  "role.title": "Roles",
  "role.new": "New role",
  "role.records": "Records",
  "role.builtIn": "Built in",
  "role.duplicate": "Duplicate",
  "role.deleted": "Role deleted",
  "role.name": "Role name",
  "role.namePlaceholder": "Billing Clerk",
  "role.description": "Description",
  "role.descriptionPlaceholder": "What this role is for",

  // ---- webhooks ----
  "hook.title": "Webhooks",
  "hook.new": "New webhook",
  "hook.emptyTitle": "No webhooks yet",
  "hook.emptyBody": "Send a signed POST to another system whenever a record changes.",
  "hook.deniedTitle": "Only an owner can manage integrations",
  "hook.deniedBody": "Ask an owner of this workspace to set up webhooks.",
  "hook.deliveredCount.one": "{n} delivered",
  "hook.deliveredCount.other": "{n} delivered",
  "hook.deliveredLast": "{delivered}, last {when}",
  "hook.streak": " ({n} in a row)",
  "hook.sendTest": "Send a test",
  "hook.sendTestTitle": "Send a test delivery",
  "hook.testQueued": "Test delivery queued",
  "hook.testFailed": "Could not send a test",
  "hook.toggleOn": "Turn {name} on",
  "hook.toggleOff": "Turn {name} off",
  "hook.toggleFailed": "Could not change that webhook",
  "hook.deleted": "Webhook deleted",
  "hook.deleteFailed": "Could not delete that webhook",
  "hook.createFailed": "Could not create that webhook",
  "hook.signatureNote": "Every request carries {header}, an HMAC-SHA256 of the timestamp and body under the webhook’s secret — verify it before trusting a payload.",
  "hook.privateAllowed": "Private network addresses are permitted on this server.",
  "hook.privateRefused": "Private and loopback addresses are refused; set WEBHOOKS_ALLOW_PRIVATE=1 to permit them.",

  "hook.createdTitle": "Webhook created",
  "hook.createdLede": "This signing secret is shown once and is not stored anywhere you can read it back. The receiving system needs it to verify signatures.",
  "hook.copy": "Copy",
  "hook.copied": "Copied",
  "hook.copyManually": "Select the secret and copy it manually",
  "hook.done": "Done",
  "hook.dialogTitle": "New webhook",
  "hook.dialogLede": "Post a signed payload to another system when these records change.",
  "hook.name": "Name",
  "hook.namePlaceholder": "Deal notifier",
  "hook.url": "Endpoint URL",
  "hook.events": "Events",
  "hook.eventCount.one": "{n} event",
  "hook.eventCount.other": "{n} events",
  "hook.create": "Create webhook",

  "hook.deliveriesLede": "The last 50 delivery attempts.",
  "hook.nothingDelivered": "Nothing delivered yet",
  "hook.attempt": " · attempt {n}",
  "hook.close": "Close",

  // ---- automation rules ----
  "auto.title": "Automation rules",
  "auto.new": "New rule",
  "auto.emptyTitle": "No rules yet",
  "auto.emptyBody": "Set a field, or open a task, whenever a record meets conditions you choose.",
  "auto.deniedTitle": "Only an owner can manage automation",
  "auto.deniedBody": "Ask an owner of this workspace to set up rules.",
  "auto.summary": "On {entity} · when {trigger}",
  "auto.actionCount.one": "{n} action",
  "auto.actionCount.other": "{n} actions",
  "auto.followUp": "{days}-day follow-up",
  "auto.neverFired": "Not fired yet",
  "auto.firedCount.one": "Fired once",
  "auto.firedCount.other": "Fired {n} times",
  "auto.firedLast": "{fired}, last {when}",
  "auto.on": "On",
  "auto.off": "Off",
  "auto.toggleOn": "Turn {name} on",
  "auto.toggleOff": "Turn {name} off",
  "auto.deleteRule": "Delete rule",
  "auto.deleted": "Rule deleted",
  "auto.deleteFailed": "Could not delete that rule",
  "auto.toggleFailed": "Could not change that rule",
  "auto.saveFailed": "Could not save that rule",
  "auto.created": "Rule created",
  "auto.updated": "Rule updated",
  "auto.note": "Rules run once, on the write that triggered them. A field a rule sets does not fire further rules, which is what keeps two rules from triggering each other forever.",

  "auto.dialogNew": "New automation rule",
  "auto.dialogEdit": "Edit rule",
  "auto.dialogLede": "When something happens to a record and your conditions hold, run these actions.",
  "auto.name": "Rule name",
  "auto.namePlaceholder": "Won deal handover",
  "auto.entity": "Record type",
  "auto.trigger": "Run when",
  "auto.create": "Create rule",
  "auto.saveRule": "Save rule",
  "auto.choose": "Choose",

  "auto.trigger.on_create": "a record is created",
  "auto.trigger.on_update": "a record is updated",
  "auto.trigger.on_create_or_update": "a record is created or updated",

  "auto.conditions": "Conditions",
  "auto.matchAll": "match all",
  "auto.matchAny": "match any",
  "auto.noConditions": "No conditions — the rule runs on every matching write.",
  "auto.addCondition": "Add condition",
  "auto.removeCondition": "Remove condition",
  "auto.field": "Field",
  "auto.value": "Value",

  "auto.op.eq": "is",
  "auto.op.ne": "is not",
  "auto.op.gt": "is greater than",
  "auto.op.gte": "is at least",
  "auto.op.lt": "is less than",
  "auto.op.lte": "is at most",
  "auto.op.contains": "contains",
  "auto.op.is_empty": "is empty",
  "auto.op.is_not_empty": "is not empty",
  "auto.op.changed": "changed",
  "auto.op.changed_to": "changed to",

  "auto.then": "Then",
  "auto.addAction": "Add action",
  "auto.removeAction": "Remove action",
  "auto.act.set_field": "Set a field",
  "auto.act.create_task": "Create a task",
  "auto.subjectPlaceholder": "Task subject — use {{name}} to include the record",
  "auto.waitDays": "Wait days",
  "auto.waitDaysHelp": "Wait this many days before creating the task. The rule’s conditions are re-checked then.",
  "auto.dueInDays": "Due in days",
  "auto.assignTo": "Assign to",
  "auto.priority": "Priority",
  "auto.assignOwner": "The record owner",
  "auto.assignActor": "Whoever made the change",
  "auto.priority.low": "Low",
  "auto.priority.normal": "Normal",
  "auto.priority.high": "High",

  "jobs.title": "Scheduled work",
  "jobs.counts": "{waiting} waiting · {done} completed",
  "jobs.failed": " · {n} failed",
  "jobs.followUp": "Follow-up action",
  "jobs.runs": "runs {when}",
  "jobs.attempt": "attempt {n}",

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

/**
 * A count and the noun that agrees with it.
 *
 * English has two forms, so `n === 1 ? "" : "s"` is written all over most
 * codebases -- and it is the single hardest thing to unpick when a second
 * language arrives. Polish has three forms and Arabic six, and which one
 * applies is a property of the language, not of the sentence. `Intl.PluralRules`
 * knows them all, so a catalogue supplies whichever of
 * `<key>.zero|one|two|few|many|other` its language uses and this picks between
 * them. `other` is the one every language has, so it is the fallback.
 *
 * The count is passed to the message as `{n}`, already grouped for the locale.
 */
export function plural(key: string, n: number, vars?: Record<string, string | number>): string {
  const form = new Intl.PluralRules(active).select(n);
  const raw =
    CATALOGUES[active]?.[`${key}.${form}`]
    ?? CATALOGUES[active]?.[`${key}.other`]
    ?? CATALOGUES.en[`${key}.${form}`]
    ?? CATALOGUES.en[`${key}.other`]
    ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    name === "n" ? new Intl.NumberFormat(active).format(n) : String(vars?.[name] ?? m),
  );
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
