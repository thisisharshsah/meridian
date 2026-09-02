//! Default roles created with every new organization.
//!
//! Permissions are strings matched by `Ctx::can`: `*` grants everything,
//! `crm.*` grants a whole module, `crm.leads.view` grants one action.

pub struct RoleSeed {
    pub key: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub permissions: &'static [&'static str],
}

pub const VIEW_EVERYTHING: &[&str] = &[
    "crm.*.view",
    "sales.*.view",
    "books.*.view",
    "inventory.*.view",
    "projects.*.view",
    "hr.*.view",
    "desk.*.view",
    "marketing.*.view",
    "recruit.*.view",
];

pub const DEFAULT_ROLES: &[RoleSeed] = &[
    RoleSeed {
        key: "admin",
        name: "Administrator",
        description: "Full access to every module and to organization settings.",
        permissions: &["*"],
    },
    RoleSeed {
        key: "sales",
        name: "Sales",
        description: "Works leads, deals, quotes and orders; can see invoices but not edit books.",
        permissions: &[
            "crm.*",
            "sales.*",
            "inventory.items.view",
            "books.invoices.view",
            "crm.accounts.*",
            "projects.projects.view",
        ],
    },
    RoleSeed {
        key: "finance",
        name: "Finance",
        description: "Owns invoicing, payments, bills and expenses.",
        permissions: &[
            "books.*",
            "sales.*",
            "inventory.*",
            "crm.accounts.view",
            "crm.contacts.view",
            "projects.projects.view",
            "projects.timesheets.view",
        ],
    },
    RoleSeed {
        key: "operations",
        name: "Operations",
        description: "Runs projects, inventory and fulfilment.",
        permissions: &[
            "projects.*",
            "inventory.*",
            "sales.orders.*",
            "crm.accounts.view",
            "crm.contacts.view",
            "desk.tickets.*",
        ],
    },
    RoleSeed {
        key: "people",
        name: "People",
        description: "Manages employees, leave and hiring.",
        permissions: &["hr.*", "recruit.*"],
    },
    RoleSeed {
        key: "support",
        name: "Support",
        description: "Handles the support desk and the knowledge base.",
        permissions: &["desk.*", "crm.contacts.view", "crm.accounts.view", "books.invoices.view"],
    },
    RoleSeed {
        key: "viewer",
        name: "Viewer",
        description: "Read-only access across the suite.",
        permissions: VIEW_EVERYTHING,
    },
];
