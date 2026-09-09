# Meridian

A self-hosted business management suite — the Zoho One idea, built as one small
platform instead of fifty separate apps. Sales, finance, inventory, delivery,
people, support, marketing and hiring share one customer record, one permission
model, one audit trail and one set of numbers.

**Next.js 16 + React 19** on the front, **Rust (axum)** on the back, **SQLite**
on disk. No cloud services, no Docker, no database server to install.

```bash
./seed.sh     # fill a demo business to click around
./dev.sh      # run the API and the web app together
```

Then open <http://localhost:7010> and sign in as `demo@meridian.test` /
`demo12345`.

---

## What is in it

| Module | Entities |
|---|---|
| **CRM** | Leads, Accounts, Contacts, Deals, Activities |
| **Sales** | Quotes, Sales orders (with line items) |
| **Finance** | Invoices, Payments, Bills, Expenses, Recurring invoices |
| **Inventory** | Items, Vendors, Warehouses, Stock movements, Purchase orders |
| **Projects** | Projects, Milestones, Tasks, Time logs |
| **People** | Departments, Employees, Leave |
| **Support** | Tickets, Replies, Knowledge base |
| **Marketing** | Campaigns |
| **Recruit** | Job openings, Candidates |
| **Workspace** | Members, Roles, Invitations, Automation rules, Webhooks, Approvals |
| **Reports** | Receivables ageing, revenue, pipeline, conversion, stock, support load |

Every one of them gets, for free: a searchable, filterable, sortable list; a
board view where the entity has a stage; a record page with related lists and a
change history; a validated create/edit form; and permission checks.

And they join up. The chain runs end to end:

```
lead ──convert──▶ account + contact + deal
                            │
                            ▼
                          quote ──accept──▶ sales order ──invoice──▶ invoice
                                                                        │
                                                                    payment
                                                                        ▼
                                                              partial → paid
```

Conversions copy line items across, preserve totals to the cent, record lineage
on both documents, and refuse to run twice.

## Approvals

An approval rule says: on this entity, when a record matches these conditions,
someone holding this role has to decide. Approving or rejecting writes a value
back **onto the record** — an expense claim over a threshold sits at `submitted`
until Finance approves it, at which point its status becomes `approved`. That
write-back is what makes it an approval rather than a note.

Conditions reuse the automation evaluator, so both features agree about what
"amount is at least 1000" means. Both outcomes are checked against the target
field when the *rule* is saved: a rule that would write a value the field cannot
hold is refused up front, rather than failing at the moment somebody clicks
approve. A record already awaiting a decision cannot queue a second request, a
decided request cannot be decided twice, and deleting a rule cancels whatever it
left outstanding.

The decision writes directly rather than going back through the engine's update
path — otherwise approving a record would re-evaluate the rules and immediately
raise a fresh request for the record just decided.

## Webhooks

Any record change can POST a signed payload to another system. Delivery rides
the job queue, so a slow endpoint never slows a save and a failure retries with
backoff; an endpoint failing repeatedly is switched off rather than retried
forever. Each request carries `X-Meridian-Signature`, an HMAC-SHA256 over the
timestamp **and** the exact body — the timestamp is inside the signed material,
so a captured request cannot be replayed, and a separator between them stops a
body being shifted into the timestamp. The secret is shown once and never
returned by a read.

A webhook URL is an outbound request the server makes on a user's say-so, which
is a server-side request forgery primitive: `http://169.254.169.254/…` would
have the server read a cloud metadata endpoint and post it onward. Private and
loopback addresses are refused unless the operator sets
`WEBHOOKS_ALLOW_PRIVATE=1`, because posting to a LAN service is also a
legitimate thing to want from self-hosted software. The check is hostname-based
and so a guard rather than a guarantee — closing it fully means resolving first
and pinning the socket to the resolved address.

## Reports

Ten cross-module reports, each a named query returning `{columns, rows, totals}`
where every column carries a type. The browser renders all of them with one
table component and formats a money column as money because the column *says*
it is money — there is no per-report frontend code, and adding a report is
adding a query.

They are hand-written SQL rather than generic aggregates, because the reports
worth having are the ones the generic `/stats` endpoint cannot express: ageing
buckets, two measures side by side, joins across modules.

Receivables ageing measures against the **due date**, not the invoice date — an
invoice on 60-day terms is not 30 days late at day 30, and reporting it that way
would misstate collections. Drafts and settled invoices are not receivables at
all. Each report is gated by the entity it reads, so a support user sees the
four reports they have the records for and gets a 403 on the rest; and like
every other query, a report is tenant-scoped. All four of those properties have
tests.

## Recurring billing

A recurring profile is a line-item template plus a schedule. A sweep asks "which
profiles are due?" and queues one job each; the job renders an invoice, advances
the profile, and queues the next period if that one is due too — so a profile
created with a start date months in the past bills every period it owes, one job
at a time, bounded by its end date or occurrence cap.

The scheduling detail worth stating: **the next date is computed from the
profile's start date, not from the invoice just written.** Month arithmetic has
to clamp — the 31st does not exist in April — but clamping the previous date and
advancing from *that* loses the anchor for good, and a month-end schedule drifts
a day earlier the first time it meets a short month. Anchoring gives
`31 Jan → 28 Feb → 31 Mar → 30 Apr → 31 May`, which is what a customer expects.
There is a test for exactly that sequence.

Generation is idempotent per billing date: a retried job, a double sweep, or the
**Generate now** button cannot bill the same period twice.

## Automation

Because the registry already describes every entity, field and permission, a
workflow builder needs no per-module code. A rule reads:

> On **Deals**, when a record is **updated**, if **Stage changed to Closed won**,
> then **set Probability to 100** and **create a task** "Send contract for
> {{name}}" due in 2 days, assigned to the record's owner.

Conditions cover `is / is not / >, >=, <, <= / contains / is empty / changed /
changed to`; actions set a field or open a task, with `{{field}}` templating.
Everything a rule names is checked against the registry **when the rule is
saved** — a condition on a field that does not exist, an action setting a
server-computed value, or a comparison against an option a select does not have
are all refused up front, because a rule that silently never matches is worse
than one that will not save.

An action can also be **scheduled**: "three days after a deal is won, chase the
signature". Delayed work goes into a durable job table rather than an in-memory
timer, so a restart does not lose it, and when it comes due the rule's
conditions are **re-checked against the record as it is then** — a deal that
stopped being won is not chased, and a rule switched off in the meantime stops
its pending work too. A dedupe key means re-saving a record does not stack up
duplicate follow-ups. Failures back off exponentially and retire after five
attempts; a job whose worker died is returned to the queue.

Rules run once, on the write that triggered them, *after* the server's own
derivations — so a rule sees the totals a write produced, and a field it sets
still gets its derived values recomputed (setting Probability updates Expected
revenue). A field a rule writes does **not** re-fire rules. That rules out loops
by construction rather than by a depth counter, and there is a test that builds
two deliberately circular rules and asserts the write terminates after one hop.

## The idea: one engine, many modules

Fifty CRUD stacks is fifty places for bugs. Instead every business object is
**described once** as an `EntityDef` in [`server/src/modules/`](server/src/modules/):

```rust
r.add(EntityDef {
    key: "crm.deals",
    table: "deals",
    label: "Deal",
    title_field: "name",
    fields: vec![
        text("name", "Deal name").required().in_list(),
        reference("account_id", "Account", "crm.accounts").in_list(),
        select("stage", "Stage", deal_stages()).required().in_list(),
        money("amount", "Amount").in_list(),
        percent("probability", "Probability").in_list(),
        money("expected_revenue", "Expected revenue").readonly().in_list(),
        // …
    ],
    children: vec![/* quotes */],
    ..
});
```

From that single description the server derives the SQL for list/get/create/
update/delete, the filter and sort grammar, the validation rules, the search
index, the reference lookups, and the permission keys. The browser fetches the
same description from `/api/meta/crm.deals` and renders the table columns, the
form inputs, the badges and the detail layout from it.

Adding a module is adding data, not another stack. The pieces:

| File | Role |
|---|---|
| [`engine/schema.rs`](server/src/engine/schema.rs) | What an entity *is* — fields, kinds, relations |
| [`engine/value.rs`](server/src/engine/value.rs) | Coercing and validating JSON against a field kind |
| [`engine/repo.rs`](server/src/engine/repo.rs) | The one implementation of CRUD, filtering and aggregates |
| [`engine/routes.rs`](server/src/engine/routes.rs) | The HTTP surface every entity shares |
| [`modules/hooks.rs`](server/src/modules/hooks.rs) | The business rules the engine cannot infer |
| [`modules/actions.rs`](server/src/modules/actions.rs) | Conversions: lead → customer, quote → order → invoice |
| [`modules/settings.rs`](server/src/modules/settings.rs) | Organization, roles and members (explicit, not generic) |
| [`modules/automations.rs`](server/src/modules/automations.rs) | The rule engine: conditions, actions, validation |
| [`modules/invitations.rs`](server/src/modules/invitations.rs) | Single-use invitation links |
| [`modules/recurring.rs`](server/src/modules/recurring.rs) | Recurring billing schedules and generation |
| [`modules/reports.rs`](server/src/modules/reports.rs) | Cross-module reporting queries |
| [`modules/approvals.rs`](server/src/modules/approvals.rs) | Approval rules, queue and decisions |
| [`modules/webhooks.rs`](server/src/modules/webhooks.rs) | Signed outbound webhooks |
| [`engine/search.rs`](server/src/engine/search.rs) | FTS5 index, maintained on write |
| [`jobs.rs`](server/src/jobs.rs) | Durable queue + worker for scheduled work |
| [`maintenance.rs`](server/src/maintenance.rs) | Time-driven derivations (the overdue sweep) |

### What the engine does *not* decide

Shape is generic; meaning is not. [`modules/hooks.rs`](server/src/modules/hooks.rs)
holds the rules that make it a business system rather than a spreadsheet:

- **Document totals** — a line's amount is quantity × price, discounted, then
  taxed on the discounted amount; the document's totals are summed from its
  lines. Client-supplied totals are discarded.
- **Invoice state** — payments roll up to `amount_paid` / `balance_due`, and the
  status moves `sent → partial → paid`, or to `overdue` once the due date
  passes. `draft` and `void` are decisions, so they are left alone.
- **Stock** — `items.stock_on_hand` is the sum of the `stock_moves` ledger, so
  any level can be explained by the rows behind it.
- **Deals** — expected revenue is amount × probability, recomputed on write.
- **Projects** — progress is the share of tasks done.
- **Overdue** — an invoice going past due is the one state change nobody
  triggers, so a sweep runs at boot and every 30 minutes
  ([`maintenance.rs`](server/src/maintenance.rs)). Only `sent` moves; a
  part-paid invoice keeps `partial`, because that says more than `overdue`.
- **Document numbers** — `INV-00001` is allocated from a per-tenant sequence in
  the *same transaction* as the insert, so two concurrent invoices can never
  take one number and a failed insert never burns one.

## Decisions worth knowing

**Money is never a float.** Amounts are `INTEGER` minor units, quantities are
scaled by 1 000 and percentages by 10 000. `"1.005"` into a money field is
*rejected*, not silently truncated. See [`common/money.rs`](server/src/common/money.rs).

**Tenancy lives in the data layer.** Every business table has `org_id`, and every
statement in [`repo.rs`](server/src/engine/repo.rs) is scoped by it — a handler
cannot forget. Deletes are soft; reads filter `deleted_at IS NULL`.

**Search is a real index.** One FTS5 table covers every searchable record,
maintained on write — creating or renaming a record moves it, deleting one
removes it, with no reindex job. User input is never parsed as query syntax:
`blue-harbor` and `o'brien` are FTS5 syntax errors raw, so every word is quoted
and only the last gets a prefix `*`. An index is a second copy of the data, so
it is a second place isolation can leak; every query filters `org_id` and drops
entities the caller cannot view, and there are tests for both.

**No SQL injection surface.** Identifiers reaching SQL only ever come from
`&'static str` metadata; a filter naming an unknown column is dropped rather
than interpolated. Values are always bound. There are tests for this.

**Tokens never reach page scripts.** The browser talks to a Next.js proxy at
`/api/*` which holds the access and refresh tokens in httpOnly cookies and
attaches them server-side ([`app/api/[...path]/route.ts`](apps/web/src/app/api/%5B...path%5D/route.ts)).
Expired access tokens are refreshed and the request replayed, transparently.
Refresh tokens rotate on use and are stored as SHA-256 digests, so a database
dump is not a set of live sessions.

**Inviting someone** produces a link rather than an email, since there is no
mail server: an owner creates it, copies it, and passes it on. The token is
shown exactly once — only its SHA-256 digest is stored — works a single time,
expires in 14 days, and can be revoked. If the address already has an account,
accepting requires that account's password, so an invitation admits someone to a
workspace without ever being a way to take over their login.

**Permissions are read per request**, not baked into the token, so revoking a
role takes effect immediately. Grants are strings — `*`, `crm.*`, `crm.*.view`,
`crm.deals.edit` — and the API filters the navigation to what you may actually
open. Seven roles ship by default (Administrator, Sales, Finance, Operations,
People, Support, Viewer), and you can author your own: **Settings → Roles** is a
matrix of every entity against view / create / edit / delete.

That matrix is not a hand-maintained list. The API derives the permission
catalogue from the entity registry, so it offers exactly the grants the checker
understands and a new module appears in the editor on its own. A grant naming
something that does not exist is refused at save time — an unmatched permission
is silently ignored at request time, which is how a role quietly grants less
than its screen claims. Built-in roles are immutable (duplicate to start from
one), and a role somebody still holds cannot be deleted.

That is asserted, not assumed. The tests put a real user on a real role and
check that a Viewer can read everything and write nothing, that a People-role
user gets HR and Recruit only — in the navigation, in the API *and* in global
search — and that a non-owner admin cannot rename the workspace.

**Charts encode magnitude with one hue.** The status palette (red/amber/green)
fails colour-blind separation when it has to carry identity alone — red and
green sit at ΔE ≈ 4 for deuteranopia. So bars are single-hue and scaled by
length, and status colour appears only as a badge *beside a word*.

## Layout

```
apps/web/            Next.js 16 App Router, React 19, Tailwind v4
  src/app/(auth)/      sign in / create workspace
  src/app/(app)/       the shell, dashboard, and [module]/[entity] routes
  src/app/api/         proxy to the Rust API + session cookie routes
  src/components/      UI primitives, metadata-driven record components
  src/lib/             API client, formatting, query hooks, metadata types
server/              Rust API
  src/auth/            registration, login, refresh, RBAC context
  src/engine/          the metadata-driven CRUD engine
  src/modules/         entity definitions + business hooks
  src/common/          ids, money, pagination, audit, sequences
  migrations/          SQL, applied automatically on boot
data/suite.db        the database (git-ignored)
```

## Running it

Requirements: Rust 1.9x, Node 20+, pnpm. Nothing else.

```bash
pnpm install --dir apps/web   # once
./seed.sh                     # demo data (optional but recommended)
./dev.sh                      # API on :7011, web on :7010
```

Other commands:

```bash
./scripts/check.sh  # everything: fmt, build, tests, types, web build
pnpm test        # cargo test — unit and end-to-end HTTP tests
pnpm typecheck   # tsc --noEmit
pnpm build       # release build of both halves
./reset.sh       # delete the local database (asks first)
```

Configuration lives in [`server/.env.example`](server/.env.example). Set a real
`JWT_SECRET` before running this anywhere but your own machine.

## Running in production

`business.aurovie.com`, behind a dedicated Cloudflare tunnel. Three launchd
agents, each supervised independently so one can restart without the others:

| Agent | What it runs | Port |
|---|---|---|
| `com.meridian.api` | [`ops/run-api.sh`](ops/run-api.sh) → the release binary | `127.0.0.1:7011` |
| `com.meridian.web` | [`ops/run-web.sh`](ops/run-web.sh) → `next start` | `127.0.0.1:7010` |
| `com.meridian.tunnel` | `cloudflared --config ~/.cloudflared/business.yml` | — |

Both processes bind **loopback only**: the tunnel is the sole route in, and the
API is not routed through it at all. Next reverse-proxies `/api/*` to the API
in-process and attaches the session cookie server-side, so an exposed API would
be a surface that expects its caller to have already been authenticated.

7000 itself is unusable on macOS — ControlCenter's AirPlay receiver holds it.

The tunnel is deliberately its own, not an ingress rule on an existing one: a
config error in a shared tunnel takes down everything else it serves.

Secrets live in `server/.env.production` at mode 0600 and are read by the runner
scripts rather than passed through plist `EnvironmentVariables`, which would put
them in any backup of `~/Library/LaunchAgents`. That file is gitignored.

```bash
launchctl list | grep meridian                 # status
tail -f ~/Library/Logs/meridian/{api,web}.log  # logs
launchctl kickstart -k gui/$(id -u)/com.meridian.api   # restart one
```

## Moving to Postgres

The schema was written to port. IDs are UUIDv7 text, timestamps are RFC3339
text that sorts correctly, money is `BIGINT`-safe, and nothing depends on
SQLite-only syntax beyond `INSERT … ON CONFLICT DO NOTHING` and partial indexes,
both of which Postgres has. The work is swapping the sqlx driver and the pool
setup in [`db.rs`](server/src/db.rs), plus the `org_users` view's `COALESCE`.

## What is deliberately not here

Email sending, file attachments, PDF rendering, payment gateways, and the deeper
accounting layer (a general ledger with journal entries, multi-currency
revaluation, tax filing). The finance module tracks invoices, payments, bills and
expenses accurately — it is not a book of account.

Inviting a teammate is half-built: you can change anyone's role and status under
Settings, but creating the account still means registering it, because there is
nowhere to send an invitation without email.

Automation stops at the derived-value hooks and the conversions above. A
user-facing workflow builder is the natural next module — the engine already
knows every entity, field and permission it would need to offer.
