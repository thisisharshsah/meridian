pub mod actions;
pub mod approvals;
pub mod automations;
pub mod books;
pub mod core;
pub mod crm;
pub mod desk;
pub mod hooks;
pub mod hospitality;
pub mod hr;
pub mod inventory;
pub mod invitations;
pub mod marketing;
pub mod projects;
pub mod recruit;
pub mod recurring;
pub mod reports;
pub mod sales;
pub mod webhooks;
pub mod settings;
pub mod shared;

use crate::engine::schema::Registry;

/// Document-number sequences seeded for every new organization.
/// Numbers are allocated transactionally, so no two documents share one.
pub const SEQUENCE_SEEDS: &[(&str, &str)] = &[
    ("sales.quotes", "QT-"),
    ("sales.orders", "SO-"),
    ("books.invoices", "INV-"),
    ("books.bills", "BILL-"),
    ("books.payments", "PMT-"),
    ("books.expenses", "EXP-"),
    ("inventory.purchase_orders", "PO-"),
    ("sales.counter_sales", "RC-"),
    ("desk.tickets", "TKT-"),
    ("hospitality.reservations", "RES-"),
    ("recruit.candidates", "CND-"),
];

/// The kinds of business the setup question offers, and what each one starts
/// with switched on.
///
/// Presets, not permissions: a choice here is a starting point somebody can
/// change in settings five minutes later. They are kept on the server so that
/// every client, and the seeder, agree on what "a shop" means — and so that
/// adding a trade is one entry here rather than a hunt through the web app.
///
/// `general` deliberately holds every module: it is what an existing
/// workspace is, and what someone who skips the question gets.
/// The workspace itself: people, roles, settings. Always present, never a
/// choice, and never stored in `org_modules`.
pub const CORE: &str = "core";

pub struct BusinessType {
    pub key: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub icon: &'static str,
    /// Empty means every module, now and whenever a new one ships.
    pub modules: &'static [&'static str],
}

pub const BUSINESS_TYPES: &[BusinessType] = &[
    BusinessType {
        key: "general",
        label: "A bit of everything",
        description: "Show me all of it and I will decide as I go.",
        icon: "LayoutGrid",
        modules: &[],
    },
    BusinessType {
        key: "shop",
        label: "Shop or café",
        description: "Serving people over a counter, with stock on the shelves.",
        icon: "ShoppingBag",
        modules: &["crm", "sales", "books", "inventory", "hr"],
    },
    BusinessType {
        key: "pharmacy",
        label: "Pharmacy or anything dated",
        description: "Stock with an expiry date on it, sold over a counter.",
        icon: "Pill",
        modules: &["crm", "sales", "books", "inventory", "hr"],
    },
    BusinessType {
        key: "hospitality",
        label: "Hotel or guest house",
        description: "Rooms let by the night, with bookings and arrivals.",
        icon: "BedDouble",
        modules: &["hospitality", "crm", "sales", "books", "inventory", "hr"],
    },
    BusinessType {
        key: "services",
        label: "Professional services",
        description: "Billing for time and work: an agency, a practice, a firm.",
        icon: "Briefcase",
        modules: &["crm", "sales", "books", "projects", "hr", "desk"],
    },
    BusinessType {
        key: "trades",
        label: "On-site work",
        description: "Jobs at a customer’s premises, with parts and a van.",
        icon: "Wrench",
        modules: &["crm", "sales", "books", "inventory", "projects", "hr"],
    },
];

/// The modules a business type starts with, or `None` for all of them.
pub fn modules_for(business_type: &str) -> Option<&'static [&'static str]> {
    let preset = BUSINESS_TYPES.iter().find(|b| b.key == business_type)?;
    if preset.modules.is_empty() {
        None
    } else {
        Some(preset.modules)
    }
}

/// Assembles the entity registry the whole server runs on.
///
/// Order matters twice: modules appear in the sidebar in this order, and
/// `Registry::validate` runs afterwards to reject any reference to an entity
/// that was never registered.
pub fn registry() -> Registry {
    let mut r = Registry::new();
    core::register(&mut r);
    crm::register(&mut r);
    sales::register(&mut r);
    books::register(&mut r);
    inventory::register(&mut r);
    projects::register(&mut r);
    hr::register(&mut r);
    desk::register(&mut r);
    hospitality::register(&mut r);
    marketing::register(&mut r);
    recruit::register(&mut r);
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_is_internally_consistent() {
        let r = registry();
        r.validate().expect("registry should validate");
        assert!(r.entities().count() >= 25, "expected the full suite to be registered");
    }

    #[test]
    fn every_entity_has_a_listable_column() {
        for e in registry().entities() {
            assert!(
                e.fields.iter().any(|f| f.in_list),
                "{} has no columns for its list view",
                e.key
            );
        }
    }

    /// A field's declared default must equal its column's SQL DEFAULT.
    /// If they drift, creating a record through the API and creating one
    /// straight in SQL produce different rows — and nobody notices for months.
    #[test]
    fn declared_defaults_match_the_column_defaults() {
        const MIGRATIONS: &[&str] = &[
            include_str!("../../migrations/0001_core.sql"),
            include_str!("../../migrations/0002_crm_sales.sql"),
            include_str!("../../migrations/0003_inventory.sql"),
            include_str!("../../migrations/0004_documents.sql"),
            include_str!("../../migrations/0005_delivery.sql"),
        ];
        let sql = MIGRATIONS.join("\n");
        let tables = parse_tables(&sql);

        let mut checked = 0;
        for e in registry().entities() {
            let Some(columns) = tables.get(e.table) else { continue };
            for f in &e.fields {
                let Some(declared) = f.default else { continue };
                let column_default = columns.get(f.name).and_then(|d| d.as_deref());
                assert_eq!(
                    Some(declared),
                    column_default,
                    "{}.{}: registry default `{}` but column default {:?}",
                    e.key, f.name, declared, column_default
                );
                checked += 1;
            }
        }
        assert!(checked >= 25, "expected the defaults to actually be checked, saw {checked}");
    }

    /// Minimal CREATE TABLE reader: column name -> its DEFAULT literal, if any.
    fn parse_tables(sql: &str) -> std::collections::HashMap<String, std::collections::HashMap<String, Option<String>>> {
        let mut out = std::collections::HashMap::new();
        let mut table: Option<String> = None;
        let mut columns: std::collections::HashMap<String, Option<String>> = Default::default();

        for raw in sql.lines() {
            let line = raw.trim();
            if line.starts_with("--") || line.is_empty() {
                continue;
            }
            if let Some(rest) = line.strip_prefix("CREATE TABLE ") {
                if let Some(prev) = table.take() {
                    out.insert(prev, std::mem::take(&mut columns));
                }
                table = Some(rest.trim_end_matches(" (").trim().to_string());
                continue;
            }
            if table.is_some() && line.starts_with(')') {
                if let Some(prev) = table.take() {
                    out.insert(prev, std::mem::take(&mut columns));
                }
                continue;
            }
            if table.is_none() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let Some(name) = parts.next() else { continue };
            if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                continue;
            }
            let default = line.find("DEFAULT ").map(|i| {
                let tail = &line[i + "DEFAULT ".len()..];
                let token: String = if let Some(stripped) = tail.strip_prefix('\'') {
                    stripped.chars().take_while(|c| *c != '\'').collect()
                } else {
                    tail.chars().take_while(|c| !c.is_whitespace() && *c != ',').collect()
                };
                token
            });
            columns.insert(name.to_string(), default);
        }
        if let Some(prev) = table {
            out.insert(prev, columns);
        }
        out
    }

    /// Every permission string in a seeded role must name something real.
    /// An unmatched grant is silently ignored at request time, which is exactly
    /// how a role ends up quietly granting less than its description claims.
    #[test]
    fn seeded_role_grants_all_name_real_entities() {
        let r = registry();
        for role in crate::auth::roles::DEFAULT_ROLES {
            for grant in role.permissions {
                if *grant == "*" {
                    continue;
                }
                let target = grant.trim_end_matches(".view").trim_end_matches(".*");
                let matches_entity = r.get(target).is_some();
                let matches_module = r.modules().iter().any(|m| m.key == target);
                assert!(
                    matches_entity || matches_module,
                    "role `{}` grants `{grant}`, but `{target}` is neither an entity nor a module",
                    role.key
                );
            }
        }
    }

    #[test]
    fn document_numbers_have_a_sequence() {
        let r = registry();
        for (key, _) in SEQUENCE_SEEDS {
            assert!(r.get(key).is_some(), "sequence `{key}` has no entity");
        }
    }
}
