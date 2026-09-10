//! `suite-server seed` — fills a workspace with a coherent demo business.
//!
//! Everything is written through the same engine + hooks the HTTP API uses, so
//! totals, balances, stock levels and audit rows come out exactly as they would
//! from real use. Nothing here bypasses validation.

use std::collections::HashMap;

use chrono::{Duration, Utc};
use serde_json::{json, Map, Value};

use crate::auth::ctx::Ctx;
use crate::auth::password::hash_password;
use crate::auth::roles::DEFAULT_ROLES;
use crate::common::ids::new_id;
use crate::engine::repo;
use crate::modules::hooks;
use crate::state::AppState;

pub const DEMO_EMAIL: &str = "demo@meridian.test";
pub const DEMO_PASSWORD: &str = "demo12345";

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn day(offset: i64) -> String {
    (Utc::now() + Duration::days(offset)).format("%Y-%m-%d").to_string()
}

/// Create one record through the full write path: validate, allocate a document
/// number if the entity has one, insert, then run the business hooks.
async fn make(state: &AppState, ctx: &Ctx, entity: &str, body: Value) -> anyhow::Result<String> {
    let def = state
        .registry
        .get(entity)
        .ok_or_else(|| anyhow::anyhow!("unknown entity `{entity}`"))?;

    let mut map: Map<String, Value> = body
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("seed body for `{entity}` must be an object"))?;

    for f in &def.fields {
        if f.readonly {
            map.remove(f.name);
        }
    }

    // The third place that creates records, and it has to run the same two
    // steps as the other two: drop what the caller does not own, then let the
    // hooks fill in what the columns require. Missing this broke the seeder
    // outright the moment a hook started composing a NOT NULL column.
    hooks::before_create(def.key, &mut map);

    let id = if hooks::needs_number(def.key).is_some() {
        let mut tx = state.pool.begin().await?;
        hooks::assign_number(&mut tx, ctx, def.key, &mut map).await?;
        let id = repo::create_on(&mut *tx, def, ctx, &map).await?;
        tx.commit().await?;
        id
    } else {
        repo::create_on(&state.pool, def, ctx, &map).await?
    };

    hooks::after_write(&state.pool, ctx, def.key, &id).await?;
    Ok(id)
}

pub async fn run(state: &AppState) -> anyhow::Result<()> {
    let existing = sqlx::query("SELECT id FROM users WHERE lower(email) = ?")
        .bind(DEMO_EMAIL)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        println!("Demo workspace already exists — sign in as {DEMO_EMAIL} / {DEMO_PASSWORD}");
        return Ok(());
    }

    let ts = now();
    let org_id = new_id();
    let user_id = new_id();

    let mut tx = state.pool.begin().await?;

    sqlx::query(
        "INSERT INTO organizations (id, name, slug, currency, country, timezone, fiscal_year_start_month, created_at, updated_at)
         VALUES (?, 'Northwind Supply Co.', 'northwind-supply', 'USD', 'US', 'UTC', 1, ?, ?)",
    )
    .bind(&org_id).bind(&ts).bind(&ts)
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
         VALUES (?, ?, 'Dana Reyes', ?, ?, ?)",
    )
    .bind(&user_id).bind(DEMO_EMAIL).bind(hash_password(DEMO_PASSWORD)?).bind(&ts).bind(&ts)
    .execute(&mut *tx).await?;

    let mut admin_role = String::new();
    for seed in DEFAULT_ROLES {
        let id = new_id();
        if seed.key == "admin" {
            admin_role = id.clone();
        }
        sqlx::query(
            "INSERT INTO roles (id, org_id, key, name, description, permissions, is_system, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&id).bind(&org_id).bind(seed.key).bind(seed.name).bind(seed.description)
        .bind(serde_json::to_string(seed.permissions)?)
        .bind(&ts).bind(&ts)
        .execute(&mut *tx).await?;
    }

    sqlx::query(
        "INSERT INTO memberships (id, org_id, user_id, role_id, is_owner, status, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'active', 'Operations Director', ?, ?)",
    )
    .bind(new_id()).bind(&org_id).bind(&user_id).bind(&admin_role).bind(&ts).bind(&ts)
    .execute(&mut *tx).await?;

    // A few colleagues, so owner columns and assignment are not all one person.
    let mut teammates: Vec<String> = vec![user_id.clone()];
    for (name, email, title) in [
        ("Marcus Webb", "marcus@meridian.test", "Account Executive"),
        ("Priya Nair", "priya@meridian.test", "Finance Lead"),
        ("Tom Okafor", "tom@meridian.test", "Support Engineer"),
    ] {
        let uid = new_id();
        sqlx::query(
            "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&uid).bind(email).bind(name).bind(hash_password(DEMO_PASSWORD)?).bind(&ts).bind(&ts)
        .execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO memberships (id, org_id, user_id, role_id, is_owner, status, title, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 'active', ?, ?, ?)",
        )
        .bind(new_id()).bind(&org_id).bind(&uid).bind(&admin_role).bind(title).bind(&ts).bind(&ts)
        .execute(&mut *tx).await?;
        teammates.push(uid);
    }

    for (key, prefix) in crate::modules::SEQUENCE_SEEDS {
        sqlx::query(
            "INSERT INTO number_sequences (org_id, key, prefix, padding, next_value)
             VALUES (?, ?, ?, 5, 1) ON CONFLICT (org_id, key) DO NOTHING",
        )
        .bind(&org_id).bind(*key).bind(*prefix)
        .execute(&mut *tx).await?;
    }

    tx.commit().await?;

    let ctx = Ctx {
        user_id: user_id.clone(),
        org_id: org_id.clone(),
        email: DEMO_EMAIL.into(),
        name: "Dana Reyes".into(),
        role_key: "admin".into(),
        is_owner: true,
        permissions: Default::default(),
    };

    let owner = |i: usize| teammates[i % teammates.len()].clone();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    let mut bump = |k: &'static str| *counts.entry(k).or_insert(0) += 1;

    // ---------------------------------------------------------------- CRM ---
    let mut accounts = Vec::new();
    for (i, (name, industry, kind, city, revenue)) in [
        ("Blue Harbor Logistics", "Transportation", "customer", "Rotterdam", "18400000.00"),
        ("Meridian Health Group", "Healthcare", "customer", "Boston", "92000000.00"),
        ("Corvus Manufacturing", "Manufacturing", "customer", "Stuttgart", "45500000.00"),
        ("Lumen Retail", "Retail", "prospect", "Austin", "7300000.00"),
        ("Ashford Consulting", "Professional services", "customer", "London", "3100000.00"),
        ("Vertex Robotics", "Technology", "prospect", "Seoul", "12800000.00"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "crm.accounts", json!({
            "name": name, "industry": industry, "account_type": kind,
            "billing_city": city, "billing_country": "—", "annual_revenue": revenue,
            "website": format!("https://{}.example.com", name.to_lowercase().replace(' ', "-")),
            "phone": format!("+1 555 01{:02}", i + 10),
            "owner_id": owner(i),
            "description": format!("{industry} account managed out of {city}."),
        })).await?;
        accounts.push(id);
        bump("accounts");
    }

    let mut contacts = Vec::new();
    for (i, (first, last, title, acct)) in [
        ("Elena", "Fischer", "Head of Operations", 0usize),
        ("Raj", "Menon", "Procurement Manager", 0),
        ("Sofia", "Alvarez", "CFO", 1),
        ("Daniel", "Kim", "IT Director", 1),
        ("Hannah", "Brecht", "Plant Manager", 2),
        ("Owen", "Price", "Buyer", 3),
        ("Yuki", "Tanaka", "Managing Partner", 4),
        ("Noor", "Haddad", "VP Engineering", 5),
    ].iter().enumerate() {
        let id = make(state, &ctx, "crm.contacts", json!({
            "first_name": first, "last_name": last,
            "full_name": format!("{first} {last}"),
            "title": title,
            "account_id": accounts[*acct],
            "email": format!("{}.{}@example.com", first.to_lowercase(), last.to_lowercase()),
            "phone": format!("+1 555 02{:02}", i + 10),
            "lead_source": "referral",
            "owner_id": owner(i),
        })).await?;
        contacts.push(id);
        bump("contacts");
    }

    for (i, (first, last, company, status, rating, source, score)) in [
        ("Greta", "Lindqvist", "Nordic Freight AB", "qualified", "hot", "website", 82),
        ("Malik", "Osei", "Sunrise Foods", "contacted", "warm", "campaign", 54),
        ("Chen", "Wei", "Pacific Components", "new", "cold", "event", 21),
        ("Alice", "Moreau", "Atlas Interiors", "qualified", "hot", "referral", 76),
        ("Ben", "Carter", "Redwood Systems", "unqualified", "cold", "cold_call", 12),
        ("Ines", "Rocha", "Vela Energy", "contacted", "warm", "partner", 48),
    ].iter().enumerate() {
        make(state, &ctx, "crm.leads", json!({
            "first_name": first, "last_name": last,
            "full_name": format!("{first} {last}"),
            "company": company, "status": status, "rating": rating,
            "lead_source": source, "score": score,
            "email": format!("{}@{}.example.com", first.to_lowercase(), company.split(' ').next().unwrap().to_lowercase()),
            "phone": format!("+1 555 03{:02}", i + 10),
            "owner_id": owner(i),
            "title": "Operations Lead",
        })).await?;
        bump("leads");
    }

    let mut deals = Vec::new();
    for (i, (name, acct, stage, amount, prob, close, kind)) in [
        ("Fleet telemetry rollout", 0usize, "negotiation", "128000.00", "70", 21i64, "new_business"),
        ("Annual supply renewal", 1, "closed_won", "245000.00", "100", -12, "renewal"),
        ("Line automation phase 2", 2, "proposal", "310000.00", "45", 40, "existing_business"),
        ("Store fit-out pilot", 3, "qualification", "64000.00", "15", 60, "new_business"),
        ("Advisory retainer", 4, "closed_won", "48000.00", "100", -30, "renewal"),
        ("Robotics integration", 5, "needs_analysis", "195000.00", "30", 75, "new_business"),
        ("Warehouse expansion", 0, "proposal", "88000.00", "50", 33, "existing_business"),
        ("Legacy migration", 2, "closed_lost", "72000.00", "0", -5, "new_business"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "crm.deals", json!({
            "name": name, "account_id": accounts[*acct], "stage": stage,
            "amount": amount, "probability": prob, "closing_date": day(*close),
            "deal_type": kind, "lead_source": "referral", "owner_id": owner(i),
            "next_step": "Confirm scope with the sponsor",
        })).await?;
        deals.push(id);
        bump("deals");
    }

    for (i, (subject, kind, status, prio, due)) in [
        ("Follow up on telemetry pricing", "call", "open", "high", 1i64),
        ("Send revised proposal", "task", "in_progress", "high", 2),
        ("Quarterly business review", "meeting", "open", "normal", 9),
        ("Check contract renewal date", "task", "completed", "low", -4),
        ("Site visit — Stuttgart plant", "meeting", "open", "normal", 14),
        ("Chase overdue invoice", "call", "open", "high", 0),
    ].iter().enumerate() {
        make(state, &ctx, "crm.activities", json!({
            "subject": subject, "kind": kind, "status": status, "priority": prio,
            "due_date": day(*due), "owner_id": owner(i),
            "account_id": accounts[i % accounts.len()],
            "contact_id": contacts[i % contacts.len()],
            "deal_id": deals[i % deals.len()],
        })).await?;
        bump("activities");
    }

    // ---------------------------------------------------------- Inventory ---
    let mut vendors = Vec::new();
    for (name, contact, terms) in [
        ("Kestrel Components", "Ana Duarte", 30),
        ("Ironwood Materials", "Peter Vogt", 45),
        ("Northlight Packaging", "Sara Cohen", 14),
    ] {
        let id = make(state, &ctx, "inventory.vendors", json!({
            "name": name, "contact_name": contact, "payment_terms": terms,
            "email": format!("orders@{}.example.com", name.to_lowercase().replace(' ', "")),
            "phone": "+1 555 0400", "country": "US",
        })).await?;
        vendors.push(id);
        bump("vendors");
    }

    let warehouse = make(state, &ctx, "inventory.warehouses", json!({
        "name": "Main Distribution Center", "code": "MDC-1",
        "city": "Columbus", "country": "US", "is_primary": true,
    })).await?;
    make(state, &ctx, "inventory.warehouses", json!({
        "name": "West Coast Hub", "code": "WCH-2", "city": "Reno", "country": "US",
    })).await?;
    bump("warehouses");
    bump("warehouses");

    let mut items = Vec::new();
    for (i, (name, sku, kind, cat, sell, cost, reorder)) in [
        ("Telemetry Gateway TG-200", "TG-200", "goods", "Hardware", "1450.00", "870.00", "25"),
        ("Sensor Array SA-40", "SA-40", "goods", "Hardware", "320.00", "184.00", "120"),
        ("Industrial Cable 10m", "CBL-10", "goods", "Components", "48.00", "19.50", "400"),
        ("Mounting Kit MK-3", "MK-3", "goods", "Components", "75.00", "31.00", "150"),
        ("Calibration Fluid 1L", "CAL-1L", "goods", "Consumables", "62.00", "24.00", "60"),
        ("Backup Battery Pack", "BAT-12", "goods", "Components", "138.00", "71.00", "40"),
        ("Installation Service", "SVC-INST", "service", "Services", "1200.00", "0", "0"),
        ("Annual Support Plan", "SVC-SUP", "service", "Services", "4800.00", "0", "0"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "inventory.items", json!({
            "name": name, "sku": sku, "item_type": kind, "category": cat,
            "sell_price": sell, "cost_price": cost, "tax_rate": "8.5",
            "reorder_level": reorder, "unit": if *kind == "service" { "hour" } else { "unit" },
            "vendor_id": vendors[i % vendors.len()],
            "track_inventory": *kind == "goods",
            // Consumables and cells have a date on them; a mounting kit does not.
            "track_batches": matches!(*sku, "CAL-1L" | "BAT-12"),
            "is_active": true,
        })).await?;
        items.push(id);
        bump("items");
    }

    // Dated stock arrives in batches: one already out of date, one close to
    // it, one with a year to run. Enough for the expiry report to have
    // something to say and for a sale to prove it takes the oldest first.
    for (sku, batch_no, expires, received, qty, cost) in [
        ("CAL-1L", "CF-2409", -14i64, -160i64, "18", "24.00"),
        ("CAL-1L", "CF-2501", 24, -70, "90", "24.00"),
        ("CAL-1L", "CF-2508", 300, -20, "120", "25.50"),
        ("BAT-12", "BP-771", 45, -95, "60", "71.00"),
        ("BAT-12", "BP-802", 420, -30, "140", "69.00"),
    ] {
        let idx = match sku {
            "CAL-1L" => 4,
            _ => 5,
        };
        make(state, &ctx, "inventory.item_batches", json!({
            "item_id": items[idx], "batch_no": batch_no, "expiry_date": day(expires),
            "received_on": day(received), "quantity_received": qty, "unit_cost": cost,
            "vendor_id": vendors[0], "warehouse_id": warehouse,
        })).await?;
        bump("batches");
    }

    // Stock arrives, then sells — the ledger explains every level on the item.
    for (i, qty) in [("140", 0usize), ("620", 1), ("1800", 2), ("300", 3)].iter().enumerate() {
        make(state, &ctx, "inventory.stock_moves", json!({
            "item_id": items[qty.1], "warehouse_id": warehouse, "move_type": "purchase",
            "quantity": qty.0, "moved_on": day(-40 + i as i64), "notes": "Opening stock",
        })).await?;
        bump("stock moves");
    }
    for (i, (item, qty)) in [(0usize, "-18"), (1, "-95"), (2, "-260"), (3, "-40")].iter().enumerate() {
        make(state, &ctx, "inventory.stock_moves", json!({
            "item_id": items[*item], "warehouse_id": warehouse, "move_type": "sale",
            "quantity": qty, "moved_on": day(-12 + i as i64), "notes": "Fulfilled against sales orders",
        })).await?;
        bump("stock moves");
    }

    let po = make(state, &ctx, "inventory.purchase_orders", json!({
        "subject": "Q4 hardware restock", "vendor_id": vendors[0], "warehouse_id": warehouse,
        "status": "issued", "order_date": day(-6), "expected_date": day(12), "currency": "USD",
        "owner_id": owner(1),
    })).await?;
    bump("purchase orders");
    for (item, qty, price) in [(0usize, "60", "870.00"), (1, "250", "184.00")] {
        make(state, &ctx, "inventory.purchase_order_items", json!({
            "purchase_order_id": po, "item_id": items[item],
            "description": "Restock", "quantity": qty, "unit_price": price, "tax_rate": "8.5",
        })).await?;
    }

    // -------------------------------------------------------------- Sales ---
    let quote = make(state, &ctx, "sales.quotes", json!({
        "subject": "Fleet telemetry — 40 vehicles", "account_id": accounts[0],
        "contact_id": contacts[0], "deal_id": deals[0], "status": "sent",
        "quote_date": day(-9), "valid_until": day(21), "currency": "USD",
        "owner_id": owner(1), "terms": "50% on order, 50% on delivery.",
    })).await?;
    bump("quotes");
    for (item, qty, price, disc) in [(0usize, "40", "1450.00", "5"), (1, "160", "320.00", "0"), (4, "3", "1200.00", "0")] {
        make(state, &ctx, "sales.quote_items", json!({
            "quote_id": quote, "item_id": items[item], "description": "Quoted line",
            "quantity": qty, "unit_price": price, "discount_percent": disc, "tax_rate": "8.5",
        })).await?;
    }

    let order = make(state, &ctx, "sales.orders", json!({
        "subject": "Annual supply renewal 2026", "account_id": accounts[1],
        "contact_id": contacts[2], "quote_id": quote, "status": "confirmed",
        "order_date": day(-20), "delivery_date": day(4), "currency": "USD",
        "owner_id": owner(0), "shipping_city": "Boston", "shipping_country": "US",
    })).await?;
    bump("sales orders");
    for (item, qty, price) in [(1usize, "400", "320.00"), (2, "900", "48.00"), (5, "1", "4800.00")] {
        make(state, &ctx, "sales.order_items", json!({
            "sales_order_id": order, "item_id": items[item], "description": "Ordered line",
            "quantity": qty, "unit_price": price, "tax_rate": "8.5",
        })).await?;
    }

    // ------------------------------------------------------------ Finance ---
    // A spread of paid, part-paid and overdue, so every dashboard tile has data.
    let invoice_plan: [(usize, usize, &str, i64, i64, &[(usize, &str, &str)], Option<&str>); 5] = [
        (1, 2, "sent", -18, 12, &[(1, "400", "320.00"), (5, "1", "4800.00")], Some("60000.00")),
        (0, 0, "sent", -40, -10, &[(0, "12", "1450.00"), (4, "2", "1200.00")], None),
        (2, 4, "sent", -55, -25, &[(3, "80", "75.00"), (2, "300", "48.00")], Some("4000.00")),
        (4, 6, "sent", -12, 18, &[(5, "1", "4800.00")], Some("5208.00")),
        (1, 3, "draft", -2, 28, &[(0, "6", "1450.00")], None),
    ];
    for (acct, contact, status, issued, due, lines, payment) in invoice_plan {
        let inv = make(state, &ctx, "books.invoices", json!({
            "account_id": accounts[acct], "contact_id": contacts[contact],
            "status": status, "invoice_date": day(issued), "due_date": day(due),
            "currency": "USD", "owner_id": owner(2),
            "subject": "Services and hardware",
            "terms": "Net 30. Late payments accrue 1.5% monthly.",
        })).await?;
        bump("invoices");
        for (item, qty, price) in lines {
            make(state, &ctx, "books.invoice_items", json!({
                "invoice_id": inv, "item_id": items[*item], "description": "Billed line",
                "quantity": qty, "unit_price": price, "tax_rate": "8.5",
            })).await?;
        }
        if let Some(amount) = payment {
            make(state, &ctx, "books.payments", json!({
                "invoice_id": inv, "account_id": accounts[acct], "amount": amount,
                "payment_date": day(due - 6), "method": "bank_transfer",
                "reference": "Wire receipt",
            })).await?;
            bump("payments");
        }
    }

    for (i, (vendor, total, tax, status, issued, due)) in [
        (0usize, "52200.00", "4437.00", "open", -14i64, 16i64),
        (1, "18750.00", "1593.75", "paid", -45, -15),
        (2, "3400.00", "289.00", "overdue", -60, -30),
    ].iter().enumerate() {
        make(state, &ctx, "books.bills", json!({
            "vendor_id": vendors[*vendor], "status": status,
            "bill_date": day(*issued), "due_date": day(*due),
            "subtotal": total, "tax_total": tax, "total": total,
            "amount_paid": if *status == "paid" { *total } else { "0" },
            "reference": format!("VINV-{:04}", 2100 + i),
        })).await?;
        bump("bills");
    }

    // `amount` is the net; the tax beside it is what the return can reclaim.
    // Flights carry none, as passenger transport usually does not.
    for (i, (desc, cat, amount, tax, status, when, billable)) in [
        ("Flights — Stuttgart site visit", "travel", "1284.40", "0", "approved", -9i64, true),
        ("Team offsite catering", "meals", "612.00", "122.40", "submitted", -4, false),
        ("Design tooling licences", "software", "2400.00", "480.00", "reimbursed", -22, false),
        ("Trade show booth", "marketing", "8600.00", "1720.00", "approved", -31, false),
        ("Replacement laptop", "hardware", "2150.00", "430.00", "draft", -1, false),
    ].iter().enumerate() {
        make(state, &ctx, "books.expenses", json!({
            "description": desc, "category": cat, "amount": amount,
            "tax_amount": tax, "expense_date": day(*when), "status": status,
            "billable": billable, "vendor_id": vendors[i % vendors.len()],
            "account_id": accounts[i % accounts.len()],
        })).await?;
        bump("expenses");
    }

    // ----------------------------------------------------------- Delivery ---
    let mut projects = Vec::new();
    for (i, (name, code, acct, status, billing, budget, rate, start, end)) in [
        ("Telemetry rollout — phase 1", "TEL-1", 0usize, "active", "fixed", "180000.00", "0", -30i64, 45i64),
        ("Supply portal integration", "SPI-2", 1, "active", "hourly", "0", "185.00", -12, 60),
        ("Plant automation study", "PAS-3", 2, "planning", "fixed", "95000.00", "0", 7, 90),
    ].iter().enumerate() {
        let id = make(state, &ctx, "projects.projects", json!({
            "name": name, "code": code, "account_id": accounts[*acct],
            "status": status, "billing_type": billing,
            "budget": budget, "hourly_rate": rate,
            "start_date": day(*start), "end_date": day(*end),
            "owner_id": owner(i),
            "description": "Delivery engagement tracked end to end in Meridian.",
        })).await?;
        projects.push(id);
        bump("projects");
    }

    let milestone = make(state, &ctx, "projects.milestones", json!({
        "project_id": projects[0], "name": "Pilot fleet live", "status": "open",
        "due_date": day(18), "owner_id": owner(0),
    })).await?;
    bump("milestones");

    let mut tasks = Vec::new();
    for (i, (name, project, status, prio, due, est)) in [
        ("Site survey and asset list", 0usize, "done", "high", -18i64, "24"),
        ("Gateway provisioning", 0, "in_progress", "high", 5, "40"),
        ("Driver training material", 0, "todo", "normal", 16, "16"),
        ("Dashboard acceptance testing", 0, "review", "normal", 12, "20"),
        ("API contract sign-off", 1, "in_progress", "urgent", 3, "12"),
        ("Data migration dry run", 1, "todo", "high", 20, "32"),
        ("Feasibility report", 2, "todo", "normal", 40, "60"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "projects.tasks", json!({
            "name": name, "project_id": projects[*project],
            "milestone_id": if *project == 0 { json!(milestone) } else { Value::Null },
            "status": status, "priority": prio,
            "assignee_id": owner(i), "due_date": day(*due),
            "estimated_hours": est, "sort_order": i as i64,
        })).await?;
        tasks.push(id);
        bump("tasks");
    }

    for (i, (task, hours, when, billable)) in [
        (0usize, "7.5", -18i64, true), (0, "6", -17, true), (1, "8", -3, true),
        (1, "5.5", -2, true), (3, "4", -1, true), (4, "6.5", -4, true), (4, "3", -1, false),
    ].iter().enumerate() {
        make(state, &ctx, "projects.timesheets", json!({
            "project_id": projects[if *task >= 4 { 1 } else { 0 }],
            "task_id": tasks[*task], "user_id": owner(i),
            "work_date": day(*when), "hours": hours, "billable": billable,
            "notes": "Logged from the delivery board",
        })).await?;
        bump("time logs");
    }

    // -------------------------------------------------------------- People ---
    let mut departments = Vec::new();
    for (name, code) in [("Engineering", "ENG"), ("Sales", "SLS"), ("Operations", "OPS"), ("Finance", "FIN")] {
        let id = make(state, &ctx, "hr.departments", json!({ "name": name, "code": code })).await?;
        departments.push(id);
        bump("departments");
    }

    let mut employees = Vec::new();
    for (i, (name, dept, title, kind, status, joined, salary)) in [
        ("Dana Reyes", 2usize, "Operations Director", "full_time", "active", -1500i64, "165000.00"),
        ("Marcus Webb", 1, "Account Executive", "full_time", "active", -800, "118000.00"),
        ("Priya Nair", 3, "Finance Lead", "full_time", "active", -1100, "142000.00"),
        ("Tom Okafor", 0, "Support Engineer", "full_time", "active", -400, "96000.00"),
        ("Lena Fischer", 0, "Firmware Engineer", "full_time", "on_leave", -950, "128000.00"),
        ("Omar Aziz", 0, "QA Analyst", "contract", "active", -180, "84000.00"),
        ("Iris Chen", 1, "Sales Development Rep", "full_time", "active", -260, "72000.00"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "hr.employees", json!({
            "full_name": name, "employee_code": format!("EMP-{:03}", i + 1),
            "department_id": departments[*dept], "designation": title,
            "employment_type": kind, "status": status,
            "date_of_joining": day(*joined), "annual_salary": salary,
            "work_email": format!("{}@meridian.test", name.split(' ').next().unwrap().to_lowercase()),
            "location": "Columbus, OH",
            "manager_id": if i == 0 { Value::Null } else { json!(employees.first().cloned().unwrap_or_default()) },
            "user_id": if i < teammates.len() { json!(teammates[i]) } else { Value::Null },
        })).await?;
        employees.push(id);
        bump("employees");
    }

    for (i, (emp, kind, status, from, to, days, reason)) in [
        (4usize, "parental", "approved", -20i64, 60i64, "80", "Parental leave"),
        (1, "annual", "approved", 12, 19, "6", "Family holiday"),
        (3, "sick", "approved", -3, -2, "2", "Flu"),
        (6, "annual", "pending", 25, 29, "5", "Wedding"),
        (5, "unpaid", "rejected", 5, 15, "9", "Personal travel"),
    ].iter().enumerate() {
        make(state, &ctx, "hr.leave_requests", json!({
            "employee_id": employees[*emp], "leave_type": kind, "status": status,
            "start_date": day(*from), "end_date": day(*to), "days": days,
            "reason": reason, "approver_id": owner(i),
        })).await?;
        bump("leave requests");
    }

    // ------------------------------------------------------------ Support ---
    for (i, (subject, acct, contact, status, prio, channel, cat, due)) in [
        ("Gateway dropping offline overnight", 0usize, 0usize, "in_progress", "urgent", "email", "Hardware", 0i64),
        ("Invoice does not match order", 1, 2, "open", "high", "email", "Billing", 1),
        ("Request: bulk export of readings", 0, 1, "open", "normal", "web", "Feature request", 6),
        ("Sensor calibration guidance", 2, 4, "resolved", "normal", "phone", "How-to", -3),
        ("Portal login fails after reset", 4, 6, "on_hold", "high", "chat", "Access", 2),
        ("Shipment arrived damaged", 1, 3, "closed", "high", "email", "Logistics", -9),
    ].iter().enumerate() {
        let t = make(state, &ctx, "desk.tickets", json!({
            "subject": subject, "account_id": accounts[*acct], "contact_id": contacts[*contact],
            "status": status, "priority": prio, "channel": channel, "category": cat,
            "assignee_id": owner(i), "due_at": format!("{}T17:00:00Z", day(*due)),
            "description": "Reported by the customer and triaged by the support desk.",
        })).await?;
        bump("tickets");
        make(state, &ctx, "desk.comments", json!({
            "ticket_id": t, "body": "Thanks for the report — we are looking into this now.",
            "is_public": true, "author_id": owner(i),
        })).await?;
    }

    for (title, cat, status) in [
        ("Setting up your first telemetry gateway", "Getting started", "published"),
        ("Understanding invoice statuses", "Billing", "published"),
        ("Calibrating an SA-40 sensor array", "Hardware", "published"),
        ("Bulk data export (beta)", "Data", "draft"),
    ] {
        make(state, &ctx, "desk.articles", json!({
            "title": title, "category": cat, "status": status,
            "body": "Step-by-step guidance maintained by the support team.",
            "views": 120, "helpful_count": 18, "author_id": owner(3),
            "published_at": if status == "published" { json!(now()) } else { Value::Null },
        })).await?;
        bump("kb articles");
    }

    // ---------------------------------------------------- Marketing/Hiring ---
    for (i, (name, kind, status, start, end, budget, cost, expected, responses)) in [
        ("Q4 industrial telemetry webinar", "webinar", "active", -10i64, 20i64, "15000.00", "9200.00", "180000.00", 240),
        ("Logistics trade show", "event", "completed", -70, -60, "42000.00", "44800.00", "320000.00", 610),
        ("Retargeting — fleet managers", "ads", "active", -25, 15, "12000.00", "7350.00", "90000.00", 1450),
        ("Partner referral push", "referral", "planning", 14, 90, "8000.00", "0", "140000.00", 0),
    ].iter().enumerate() {
        make(state, &ctx, "marketing.campaigns", json!({
            "name": name, "campaign_type": kind, "status": status,
            "start_date": day(*start), "end_date": day(*end),
            "budget": budget, "actual_cost": cost, "expected_revenue": expected,
            "target_size": 5000, "responses": responses, "owner_id": owner(i),
        })).await?;
        bump("campaigns");
    }

    let mut jobs = Vec::new();
    for (i, (title, dept, status, kind, loc, openings, min, max)) in [
        ("Senior Firmware Engineer", 0usize, "open", "full_time", "Columbus, OH", 2, "130000.00", "165000.00"),
        ("Enterprise Account Executive", 1, "open", "full_time", "Remote — US", 1, "110000.00", "140000.00"),
        ("Support Engineer (EMEA)", 0, "on_hold", "full_time", "Berlin", 1, "70000.00", "88000.00"),
    ].iter().enumerate() {
        let id = make(state, &ctx, "recruit.job_openings", json!({
            "title": title, "department_id": departments[*dept], "status": status,
            "employment_type": kind, "location": loc, "openings": openings,
            "salary_min": min, "salary_max": max,
            "hiring_manager_id": owner(i), "target_date": day(45),
            "description": "Join a team building industrial telemetry end to end.",
        })).await?;
        jobs.push(id);
        bump("job openings");
    }

    for (i, (name, job, stage, source, company, years, expected, rating)) in [
        ("Aiden Brooks", 0usize, "interview", "Referral", "Vector Devices", 8, "152000.00", 4),
        ("Sana Iqbal", 0, "offer", "LinkedIn", "Helios Systems", 10, "160000.00", 5),
        ("Diego Ramos", 0, "screening", "Careers page", "Northbeam", 6, "138000.00", 3),
        ("Kate Mullen", 1, "applied", "LinkedIn", "Crestline", 12, "125000.00", 3),
        ("Femi Adeyemi", 1, "interview", "Referral", "Orbit Sales", 9, "132000.00", 4),
        ("Lars Nilsen", 2, "rejected", "Agency", "Baltic Support", 4, "76000.00", 2),
    ].iter().enumerate() {
        make(state, &ctx, "recruit.candidates", json!({
            "full_name": name, "job_opening_id": jobs[*job], "stage": stage,
            "source": source, "current_company": company, "experience_years": years,
            "expected_salary": expected, "rating": rating, "owner_id": owner(i),
            "email": format!("{}@example.com", name.to_lowercase().replace(' ', ".")),
            "phone": format!("+1 555 05{:02}", i + 10),
        })).await?;
        bump("candidates");
    }

    // A handful of rooms and stays. Northwind lets its two guest flats and a
    // meeting suite to visiting engineers, which is a real enough reason for a
    // supplier to hold a room list — and it gives the board something to show.
    let mut rooms = Vec::new();
    for (number, kind, floor, sleeps, rate, state_) in [
        ("101", "double", 1, 2, "145.00", "available"),
        ("102", "twin", 1, 2, "145.00", "available"),
        ("201", "suite", 2, 4, "295.00", "available"),
        ("202", "family", 2, 5, "225.00", "maintenance"),
    ] {
        let id = make(state, &ctx, "hospitality.rooms", json!({
            "number": number, "room_type": kind, "floor": floor, "capacity": sleeps,
            "nightly_rate": rate, "status": state_,
        })).await?;
        rooms.push(id);
        bump("rooms");
    }

    // One guest in now, one arriving, one already left. Dates are relative, so
    // the board is never a museum piece.
    for (room, guest, from, to, status, source) in [
        (0usize, "Priya Raman", -2i64, 3i64, "checked_in", "Direct"),
        (1, "Tomas Weber", 5, 9, "booked", "Phone"),
        (2, "Ines Duarte", -12, -8, "checked_out", "Direct"),
        (0, "Adaeze Nwosu", 14, 17, "booked", "Website"),
    ] {
        make(state, &ctx, "hospitality.reservations", json!({
            "room_id": rooms[room], "guest_name": guest,
            "check_in": day(from), "check_out": day(to),
            "status": status, "adults": 2, "source": source,
        })).await?;
        bump("bookings");
    }

    // The seeder writes through the repository rather than the HTTP layer, so
    // it has to ask for the index itself.
    let indexed = crate::engine::search::reindex_org(&state.pool, &state.registry, &ctx).await?;

    let mut summary: Vec<(&str, usize)> = counts.into_iter().collect();
    summary.sort_by_key(|(k, _)| *k);
    println!("\nSeeded the Northwind Supply Co. demo workspace:");
    for (what, n) in summary {
        println!("  {n:>4}  {what}");
    }
    println!("  {indexed:>4}  records indexed for search");
    println!("\n  Sign in at http://localhost:7010/login");
    println!("  Email    {DEMO_EMAIL}");
    println!("  Password {DEMO_PASSWORD}\n");

    Ok(())
}
