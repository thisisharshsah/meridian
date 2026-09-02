use crate::engine::schema::*;
use crate::modules::shared::{currency_field, document_totals, line_item_fields};

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "sales",
        label: "Sales",
        icon: "FileText",
        color: "purple",
        description: "Quotes and sales orders on the way to an invoice.",
    });

    let mut quote_fields = vec![
        text("number", "Quote #").readonly().in_list(),
        text("subject", "Subject").required().in_list(),
        reference("account_id", "Customer", "crm.accounts").in_list(),
        reference("contact_id", "Contact", "crm.contacts"),
        reference("deal_id", "Deal", "crm.deals"),
        select("status", "Status", vec![
            opt("draft", "Draft", "neutral"),
            opt("sent", "Sent", "info"),
            opt("accepted", "Accepted", "success"),
            opt("declined", "Declined", "danger"),
            opt("expired", "Expired", "warning"),
        ]).required().with_default("draft").in_list(),
        date("quote_date", "Date").required().in_list(),
        date("valid_until", "Valid until").in_list(),
        currency_field(),
    ];
    quote_fields.extend(document_totals());
    quote_fields.extend([
        reference("owner_id", "Owner", "core.users").in_list(),
        long_text("terms", "Terms"),
        long_text("notes", "Notes"),
    ]);

    r.add(EntityDef {
        key: "sales.quotes",
        table: "quotes",
        module: "sales",
        label: "Quote",
        label_plural: "Quotes",
        icon: "FileText",
        title_field: "subject",
        fields: quote_fields,
        default_sort: ("created_at", SortDir::Desc),
        children: vec![ChildDef {
            entity: "sales.quote_items",
            foreign_key: "quote_id",
            label: "Line items",
            inline: true,
        }],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "sales.quote_items",
        table: "quote_items",
        module: "sales",
        label: "Quote line",
        label_plural: "Quote lines",
        icon: "List",
        title_field: "description",
        fields: line_item_fields("quote_id", "Quote", "sales.quotes"),
        default_sort: ("sort_order", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });

    let mut order_fields = vec![
        text("number", "Order #").readonly().in_list(),
        text("subject", "Subject").required().in_list(),
        reference("account_id", "Customer", "crm.accounts").in_list(),
        reference("contact_id", "Contact", "crm.contacts"),
        reference("quote_id", "From quote", "sales.quotes"),
        select("status", "Status", vec![
            opt("open", "Open", "info"),
            opt("confirmed", "Confirmed", "brand"),
            opt("fulfilled", "Fulfilled", "success"),
            opt("invoiced", "Invoiced", "purple"),
            opt("cancelled", "Cancelled", "neutral"),
        ]).required().with_default("open").in_list(),
        date("order_date", "Order date").required().in_list(),
        date("delivery_date", "Delivery date").in_list(),
        currency_field(),
    ];
    order_fields.extend(document_totals());
    order_fields.extend([
        reference("owner_id", "Owner", "core.users").in_list(),
        text("shipping_street", "Shipping street"),
        text("shipping_city", "Shipping city"),
        text("shipping_country", "Shipping country"),
        long_text("notes", "Notes"),
    ]);

    r.add(EntityDef {
        key: "sales.orders",
        table: "sales_orders",
        module: "sales",
        label: "Sales order",
        label_plural: "Sales orders",
        icon: "ClipboardList",
        title_field: "subject",
        fields: order_fields,
        default_sort: ("created_at", SortDir::Desc),
        children: vec![ChildDef {
            entity: "sales.order_items",
            foreign_key: "sales_order_id",
            label: "Line items",
            inline: true,
        }],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "sales.order_items",
        table: "sales_order_items",
        module: "sales",
        label: "Order line",
        label_plural: "Order lines",
        icon: "List",
        title_field: "description",
        fields: line_item_fields("sales_order_id", "Sales order", "sales.orders"),
        default_sort: ("sort_order", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });
}
