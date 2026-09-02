use crate::engine::schema::*;

fn user_ref(name: &'static str, label: &'static str) -> FieldDef {
    reference(name, label, "core.users")
}

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "crm",
        label: "CRM",
        icon: "Users",
        color: "brand",
        description: "Leads, contacts, accounts and the deal pipeline.",
    });

    r.add(EntityDef {
        key: "crm.leads",
        table: "leads",
        module: "crm",
        label: "Lead",
        label_plural: "Leads",
        icon: "UserPlus",
        title_field: "full_name",
        fields: vec![
            text("full_name", "Name").required().in_list(),
            text("first_name", "First name"),
            text("last_name", "Last name").required(),
            text("company", "Company").required().in_list(),
            text("title", "Job title"),
            email("email", "Email").in_list(),
            phone("phone", "Phone"),
            phone("mobile", "Mobile"),
            url("website", "Website"),
            select("status", "Status", vec![
                opt("new", "New", "info"),
                opt("contacted", "Contacted", "brand"),
                opt("qualified", "Qualified", "success"),
                opt("unqualified", "Unqualified", "neutral"),
                opt("converted", "Converted", "purple"),
            ]).required().with_default("new").in_list(),
            select("rating", "Rating", vec![
                opt("hot", "Hot", "danger"),
                opt("warm", "Warm", "warning"),
                opt("cold", "Cold", "info"),
            ]).in_list(),
            select("lead_source", "Source", lead_sources()),
            text("industry", "Industry"),
            int("score", "Score").in_list(),
            money("annual_revenue", "Annual revenue"),
            int("employees", "Employees"),
            user_ref("owner_id", "Owner").in_list(),
            text("street", "Street"),
            text("city", "City"),
            text("country", "Country"),
            long_text("description", "Description"),
            datetime("converted_at", "Converted on").readonly(),
            reference("converted_contact_id", "Contact created", "crm.contacts").readonly(),
            reference("converted_account_id", "Account created", "crm.accounts").readonly(),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "crm.accounts",
        table: "accounts",
        module: "crm",
        label: "Account",
        label_plural: "Accounts",
        icon: "Building2",
        title_field: "name",
        fields: vec![
            text("name", "Account name").required().in_list(),
            select("account_type", "Type", vec![
                opt("customer", "Customer", "success"),
                opt("prospect", "Prospect", "info"),
                opt("partner", "Partner", "purple"),
                opt("vendor", "Vendor", "warning"),
                opt("competitor", "Competitor", "danger"),
            ]).in_list(),
            text("industry", "Industry").in_list(),
            url("website", "Website"),
            phone("phone", "Phone"),
            email("email", "Email"),
            int("employees", "Employees"),
            money("annual_revenue", "Annual revenue").in_list(),
            user_ref("owner_id", "Owner").in_list(),
            text("billing_street", "Billing street"),
            text("billing_city", "Billing city"),
            text("billing_state", "Billing state"),
            text("billing_postal_code", "Postal code"),
            text("billing_country", "Billing country"),
            long_text("description", "Description"),
        ],
        default_sort: ("name", SortDir::Asc),
        children: vec![
            ChildDef { entity: "crm.contacts", foreign_key: "account_id", label: "Contacts", inline: false },
            ChildDef { entity: "crm.deals", foreign_key: "account_id", label: "Deals", inline: false },
            ChildDef { entity: "books.invoices", foreign_key: "account_id", label: "Invoices", inline: false },
        ],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "crm.contacts",
        table: "contacts",
        module: "crm",
        label: "Contact",
        label_plural: "Contacts",
        icon: "Contact",
        title_field: "full_name",
        fields: vec![
            text("full_name", "Name").required().in_list(),
            text("first_name", "First name"),
            text("last_name", "Last name").required(),
            reference("account_id", "Account", "crm.accounts").in_list(),
            text("title", "Job title").in_list(),
            text("department", "Department"),
            email("email", "Email").in_list(),
            phone("phone", "Phone"),
            phone("mobile", "Mobile").in_list(),
            select("lead_source", "Source", lead_sources()),
            user_ref("owner_id", "Owner").in_list(),
            text("mailing_street", "Street"),
            text("mailing_city", "City"),
            text("mailing_country", "Country"),
            long_text("description", "Description"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![
            ChildDef { entity: "crm.deals", foreign_key: "contact_id", label: "Deals", inline: false },
        ],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "crm.deals",
        table: "deals",
        module: "crm",
        label: "Deal",
        label_plural: "Deals",
        icon: "Target",
        title_field: "name",
        fields: vec![
            text("name", "Deal name").required().in_list(),
            reference("account_id", "Account", "crm.accounts").in_list(),
            reference("contact_id", "Contact", "crm.contacts"),
            select("stage", "Stage", deal_stages()).required().with_default("qualification").in_list(),
            money("amount", "Amount").in_list(),
            text("currency", "Currency"),
            percent("probability", "Probability").in_list(),
            // Recomputed from amount x probability on every write.
            money("expected_revenue", "Expected revenue").readonly().in_list(),
            date("closing_date", "Closing date").in_list(),
            select("deal_type", "Type", vec![
                opt("new_business", "New business", "success"),
                opt("existing_business", "Existing business", "info"),
                opt("renewal", "Renewal", "purple"),
            ]),
            select("lead_source", "Source", lead_sources()),
            user_ref("owner_id", "Owner").in_list(),
            text("next_step", "Next step"),
            long_text("description", "Description"),
            datetime("closed_at", "Closed on").readonly(),
        ],
        default_sort: ("closing_date", SortDir::Asc),
        children: vec![
            ChildDef { entity: "sales.quotes", foreign_key: "deal_id", label: "Quotes", inline: false },
        ],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "crm.activities",
        table: "activities",
        module: "crm",
        label: "Activity",
        label_plural: "Activities",
        icon: "CalendarCheck",
        title_field: "subject",
        fields: vec![
            text("subject", "Subject").required().in_list(),
            select("kind", "Type", vec![
                opt("task", "Task", "brand"),
                opt("call", "Call", "info"),
                opt("meeting", "Meeting", "purple"),
                opt("note", "Note", "neutral"),
            ]).required().with_default("task").in_list(),
            select("status", "Status", vec![
                opt("open", "Open", "info"),
                opt("in_progress", "In progress", "warning"),
                opt("completed", "Completed", "success"),
                opt("cancelled", "Cancelled", "neutral"),
            ]).required().with_default("open").in_list(),
            select("priority", "Priority", vec![
                opt("low", "Low", "neutral"),
                opt("normal", "Normal", "info"),
                opt("high", "High", "danger"),
            ]).in_list(),
            date("due_date", "Due date").in_list(),
            datetime("start_at", "Starts at"),
            int("duration_mins", "Duration (mins)"),
            user_ref("owner_id", "Owner").in_list(),
            reference("contact_id", "Contact", "crm.contacts"),
            reference("account_id", "Account", "crm.accounts"),
            reference("deal_id", "Deal", "crm.deals"),
            text("related_entity", "Related to"),
            text("related_id", "Related id").not_searchable(),
            text("outcome", "Outcome"),
            long_text("description", "Notes"),
            datetime("completed_at", "Completed at").readonly(),
        ],
        default_sort: ("due_date", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });
}

pub fn lead_sources() -> Vec<SelectOption> {
    vec![
        opt("website", "Website", "info"),
        opt("referral", "Referral", "success"),
        opt("cold_call", "Cold call", "neutral"),
        opt("campaign", "Campaign", "purple"),
        opt("partner", "Partner", "brand"),
        opt("event", "Event", "warning"),
        opt("other", "Other", "neutral"),
    ]
}

/// Stage list doubles as the pipeline order on the deals board.
pub fn deal_stages() -> Vec<SelectOption> {
    vec![
        opt("qualification", "Qualification", "neutral"),
        opt("needs_analysis", "Needs analysis", "info"),
        opt("proposal", "Proposal", "brand"),
        opt("negotiation", "Negotiation", "warning"),
        opt("closed_won", "Closed won", "success"),
        opt("closed_lost", "Closed lost", "danger"),
    ]
}
