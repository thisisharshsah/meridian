use crate::engine::schema::*;
use crate::modules::shared::{currency_field, document_totals, line_item_fields};

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "inventory",
        label: "Inventory",
        icon: "Boxes",
        color: "warning",
        description: "Products, vendors, stock levels and purchasing.",
    });

    r.add(EntityDef {
        key: "inventory.items",
        table: "items",
        module: "inventory",
        label: "Item",
        label_plural: "Items",
        icon: "Package",
        title_field: "name",
        fields: vec![
            text("name", "Item name").required().in_list(),
            text("sku", "SKU").in_list(),
            text("barcode", "Barcode").in_list(),
            select("item_type", "Type", vec![
                opt("goods", "Goods", "brand"),
                opt("service", "Service", "purple"),
            ]).required().with_default("goods").in_list(),
            text("category", "Category").in_list().suggests(),
            text("unit", "Unit").suggests(),
            money("sell_price", "Selling price").in_list(),
            money("cost_price", "Cost price"),
            percent("tax_rate", "Tax rate"),
            quantity("stock_on_hand", "In stock").readonly().in_list(),
            quantity("reorder_level", "Reorder at"),
            reference("vendor_id", "Preferred vendor", "inventory.vendors"),
            boolean("track_inventory", "Track stock"),
            boolean("track_batches", "Track batches and expiry")
                .help("For anything with a date on it. Sales take the batch that expires first."),
            boolean("is_active", "Active").in_list(),
            long_text("description", "Description"),
        ],
        default_sort: ("name", SortDir::Asc),
        children: vec![
            ChildDef {
                entity: "inventory.item_batches",
                foreign_key: "item_id",
                label: "Batches",
                inline: false,
            },
            ChildDef {
                entity: "inventory.stock_moves",
                foreign_key: "item_id",
                label: "Stock movements",
                inline: false,
            },
        ],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "inventory.vendors",
        table: "vendors",
        module: "inventory",
        label: "Vendor",
        label_plural: "Vendors",
        icon: "Truck",
        title_field: "name",
        fields: vec![
            text("name", "Vendor name").required().in_list(),
            text("contact_name", "Contact").in_list(),
            email("email", "Email").in_list(),
            phone("phone", "Phone").in_list(),
            url("website", "Website"),
            int("payment_terms", "Payment terms (days)"),
            text("tax_number", "Tax number"),
            text("street", "Street"),
            text("city", "City").suggests(),
            text("country", "Country").suggests(),
            reference("owner_id", "Owner", "core.users"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("name", SortDir::Asc),
        children: vec![ChildDef {
            entity: "inventory.purchase_orders",
            foreign_key: "vendor_id",
            label: "Purchase orders",
            inline: false,
        }],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "inventory.warehouses",
        table: "warehouses",
        module: "inventory",
        label: "Warehouse",
        label_plural: "Warehouses",
        icon: "Warehouse",
        title_field: "name",
        fields: vec![
            text("name", "Name").required().in_list(),
            text("code", "Code").in_list(),
            text("city", "City").in_list().suggests(),
            text("country", "Country").in_list().suggests(),
            boolean("is_primary", "Primary").in_list(),
            long_text("address", "Address"),
        ],
        default_sort: ("name", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "inventory.item_batches",
        table: "item_batches",
        module: "inventory",
        label: "Batch",
        label_plural: "Batches",
        icon: "Layers",
        title_field: "batch_no",
        fields: vec![
            reference("item_id", "Item", "inventory.items").required().in_list(),
            text("batch_no", "Batch number").required().in_list(),
            date("expiry_date", "Expires")
                .in_list()
                .help("Leave blank for stock that does not expire."),
            date("received_on", "Received").required().in_list(),
            quantity("quantity_received", "Received quantity")
                .required()
                .help("What arrived. Change it and the stock movement follows."),
            // Received less everything sold or written off against this batch.
            quantity("quantity_left", "Left").readonly().in_list(),
            money("unit_cost", "Unit cost"),
            reference("vendor_id", "Supplier", "inventory.vendors").in_list(),
            reference("warehouse_id", "Warehouse", "inventory.warehouses"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("expiry_date", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "inventory.stock_moves",
        table: "stock_moves",
        module: "inventory",
        label: "Stock movement",
        label_plural: "Stock movements",
        icon: "ArrowLeftRight",
        title_field: "move_type",
        fields: vec![
            reference("item_id", "Item", "inventory.items").required().in_list(),
            reference("warehouse_id", "Warehouse", "inventory.warehouses").in_list(),
            select("move_type", "Type", vec![
                opt("purchase", "Purchase", "success"),
                opt("sale", "Sale", "info"),
                opt("adjustment", "Adjustment", "warning"),
                opt("transfer", "Transfer", "purple"),
                opt("return", "Return", "neutral"),
            ]).required().in_list(),
            // Signed: negative removes stock.
            quantity("quantity", "Quantity").required().in_list(),
            money("unit_cost", "Unit cost"),
            date("moved_on", "Date").required().in_list(),
            reference("batch_id", "Batch", "inventory.item_batches").in_list(),
            text("reference_entity", "Source"),
            text("reference_id", "Source id").not_searchable(),
            long_text("notes", "Notes"),
        ],
        default_sort: ("moved_on", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: false,
        read_only: false,
    });

    let mut po_fields = vec![
        text("number", "PO #").readonly().in_list(),
        text("subject", "Subject").required().in_list(),
        reference("vendor_id", "Vendor", "inventory.vendors").required().in_list(),
        reference("warehouse_id", "Deliver to", "inventory.warehouses"),
        select("status", "Status", vec![
            opt("draft", "Draft", "neutral"),
            opt("issued", "Issued", "info"),
            opt("received", "Received", "success"),
            opt("billed", "Billed", "purple"),
            opt("cancelled", "Cancelled", "neutral"),
        ]).required().with_default("draft").in_list(),
        date("order_date", "Order date").required().in_list(),
        date("expected_date", "Expected").in_list(),
        currency_field(),
    ];
    po_fields.extend(document_totals());
    po_fields.extend([
        reference("owner_id", "Owner", "core.users"),
        long_text("notes", "Notes"),
        datetime("received_at", "Received at").readonly(),
    ]);

    r.add(EntityDef {
        key: "inventory.purchase_orders",
        table: "purchase_orders",
        module: "inventory",
        label: "Purchase order",
        label_plural: "Purchase orders",
        icon: "ShoppingCart",
        title_field: "subject",
        fields: po_fields,
        default_sort: ("created_at", SortDir::Desc),
        children: vec![ChildDef {
            entity: "inventory.purchase_order_items",
            foreign_key: "purchase_order_id",
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
        key: "inventory.purchase_order_items",
        table: "purchase_order_items",
        module: "inventory",
        label: "PO line",
        label_plural: "PO lines",
        icon: "List",
        title_field: "description",
        fields: line_item_fields("purchase_order_id", "Purchase order", "inventory.purchase_orders"),
        default_sort: ("sort_order", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });
}
