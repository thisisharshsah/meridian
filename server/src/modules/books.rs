use crate::engine::schema::*;
use crate::modules::shared::{currency_field, document_totals, line_item_fields};

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "books",
        label: "Finance",
        icon: "Receipt",
        color: "success",
        description: "Invoices, payments, bills and expenses.",
    });

    let mut invoice_fields = vec![
        text("number", "Invoice #").readonly().in_list(),
        text("subject", "Subject"),
        reference("account_id", "Customer", "crm.accounts").required().in_list(),
        reference("contact_id", "Contact", "crm.contacts"),
        reference("sales_order_id", "From order", "sales.orders"),
        reference("recurring_profile_id", "From recurring", "books.recurring").readonly(),
        select("status", "Status", invoice_statuses()).required().with_default("draft").in_list(),
        date("invoice_date", "Invoice date").required().in_list(),
        date("due_date", "Due date").required().in_list(),
        currency_field(),
    ];
    invoice_fields.extend(document_totals());
    invoice_fields.extend([
        money("amount_paid", "Paid").readonly().in_list(),
        money("balance_due", "Balance").readonly().in_list(),
        reference("owner_id", "Owner", "core.users"),
        long_text("terms", "Terms"),
        long_text("notes", "Notes"),
        datetime("sent_at", "Sent at").readonly(),
        datetime("paid_at", "Paid at").readonly(),
    ]);

    r.add(EntityDef {
        key: "books.invoices",
        table: "invoices",
        module: "books",
        label: "Invoice",
        label_plural: "Invoices",
        icon: "Receipt",
        title_field: "number",
        fields: invoice_fields,
        default_sort: ("invoice_date", SortDir::Desc),
        children: vec![
            ChildDef { entity: "books.invoice_items", foreign_key: "invoice_id", label: "Line items", inline: true },
            ChildDef { entity: "books.payments", foreign_key: "invoice_id", label: "Payments", inline: false },
        ],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "books.invoice_items",
        table: "invoice_items",
        module: "books",
        label: "Invoice line",
        label_plural: "Invoice lines",
        icon: "List",
        title_field: "description",
        fields: line_item_fields("invoice_id", "Invoice", "books.invoices"),
        default_sort: ("sort_order", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });

    r.add(EntityDef {
        key: "books.payments",
        table: "payments",
        module: "books",
        label: "Payment",
        label_plural: "Payments",
        icon: "Banknote",
        title_field: "number",
        fields: vec![
            text("number", "Payment #").readonly().in_list(),
            reference("invoice_id", "Invoice", "books.invoices").in_list(),
            reference("account_id", "Customer", "crm.accounts").in_list(),
            money("amount", "Amount").required().in_list(),
            currency_field(),
            date("payment_date", "Date").required().in_list(),
            select("method", "Method", vec![
                opt("bank_transfer", "Bank transfer", "brand"),
                opt("card", "Card", "info"),
                opt("cash", "Cash", "success"),
                opt("cheque", "Cheque", "warning"),
                opt("other", "Other", "neutral"),
            ]).required().with_default("bank_transfer").in_list(),
            text("reference", "Reference"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("payment_date", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "books.bills",
        table: "bills",
        module: "books",
        label: "Bill",
        label_plural: "Bills",
        icon: "FileMinus",
        title_field: "number",
        fields: vec![
            text("number", "Bill #").readonly().in_list(),
            reference("vendor_id", "Vendor", "inventory.vendors").required().in_list(),
            reference("purchase_order_id", "From PO", "inventory.purchase_orders"),
            select("status", "Status", vec![
                opt("open", "Open", "info"),
                opt("partial", "Partially paid", "warning"),
                opt("paid", "Paid", "success"),
                opt("overdue", "Overdue", "danger"),
                opt("void", "Void", "neutral"),
            ]).required().with_default("open").in_list(),
            date("bill_date", "Bill date").required().in_list(),
            date("due_date", "Due date").required().in_list(),
            currency_field(),
            money("subtotal", "Subtotal").in_list(),
            money("tax_total", "Tax"),
            money("total", "Total").in_list(),
            money("amount_paid", "Paid").in_list(),
            money("balance_due", "Balance").readonly().in_list(),
            text("reference", "Reference"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("bill_date", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "books.expenses",
        table: "expenses",
        module: "books",
        label: "Expense",
        label_plural: "Expenses",
        icon: "CreditCard",
        title_field: "description",
        fields: vec![
            text("number", "Expense #").readonly().in_list(),
            text("description", "Description").required().in_list(),
            select("category", "Category", vec![
                opt("general", "General", "neutral"),
                opt("travel", "Travel", "info"),
                opt("meals", "Meals", "warning"),
                opt("software", "Software", "brand"),
                opt("hardware", "Hardware", "purple"),
                opt("marketing", "Marketing", "danger"),
                opt("office", "Office", "success"),
            ]).required().with_default("general").in_list(),
            money("amount", "Amount").required().in_list(),
            money("tax_amount", "Tax"),
            currency_field(),
            date("expense_date", "Date").required().in_list(),
            select("status", "Status", vec![
                opt("draft", "Draft", "neutral"),
                opt("submitted", "Submitted", "info"),
                opt("approved", "Approved", "success"),
                opt("rejected", "Rejected", "danger"),
                opt("reimbursed", "Reimbursed", "purple"),
            ]).required().with_default("draft").in_list(),
            reference("vendor_id", "Vendor", "inventory.vendors"),
            reference("account_id", "Bill to customer", "crm.accounts"),
            reference("project_id", "Project", "projects.projects"),
            reference("employee_id", "Employee", "hr.employees"),
            boolean("billable", "Billable").in_list(),
            text("reference", "Reference"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("expense_date", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });
    let mut profile_fields = vec![
        text("name", "Description").required().in_list(),
        reference("account_id", "Customer", "crm.accounts").required().in_list(),
        reference("contact_id", "Contact", "crm.contacts"),
        select("status", "Status", vec![
            opt("active", "Active", "success"),
            opt("paused", "Paused", "warning"),
            opt("ended", "Ended", "neutral"),
        ]).required().with_default("active").in_list(),
        select("frequency", "Repeats", vec![
            opt("weekly", "Weekly", "info"),
            opt("monthly", "Monthly", "brand"),
            opt("quarterly", "Quarterly", "purple"),
            opt("yearly", "Yearly", "success"),
        ]).required().with_default("monthly").in_list(),
        int("every_n", "Every"),
        date("start_date", "Starts").required().in_list(),
        date("end_date", "Ends"),
        // Server-advanced after each run, so a client cannot skip a period.
        date("next_run_date", "Next invoice").readonly().in_list(),
        int("payment_terms_days", "Payment terms (days)"),
        currency_field(),
        boolean("auto_issue", "Issue automatically").in_list(),
        int("max_occurrences", "Stop after"),
        int("occurrences", "Generated").readonly().in_list(),
    ];
    profile_fields.extend(document_totals());
    profile_fields.extend([
        reference("last_invoice_id", "Last invoice", "books.invoices").readonly(),
        datetime("last_run_at", "Last generated").readonly(),
        reference("owner_id", "Owner", "core.users"),
        long_text("notes", "Notes"),
    ]);

    r.add(EntityDef {
        key: "books.recurring",
        table: "recurring_profiles",
        module: "books",
        label: "Recurring invoice",
        label_plural: "Recurring invoices",
        icon: "Repeat",
        title_field: "name",
        fields: profile_fields,
        default_sort: ("next_run_date", SortDir::Asc),
        children: vec![
            ChildDef { entity: "books.recurring_items", foreign_key: "recurring_profile_id", label: "Line items", inline: true },
        ],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "books.recurring_items",
        table: "recurring_profile_items",
        module: "books",
        label: "Recurring line",
        label_plural: "Recurring lines",
        icon: "List",
        title_field: "description",
        fields: line_item_fields("recurring_profile_id", "Recurring invoice", "books.recurring"),
        default_sort: ("sort_order", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });
}

pub fn invoice_statuses() -> Vec<SelectOption> {
    vec![
        opt("draft", "Draft", "neutral"),
        opt("sent", "Sent", "info"),
        opt("partial", "Partially paid", "warning"),
        opt("paid", "Paid", "success"),
        opt("overdue", "Overdue", "danger"),
        opt("void", "Void", "neutral"),
    ]
}
