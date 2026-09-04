use crate::engine::schema::*;

/// Line-item fields are identical across quotes, orders, invoices and POs.
/// `line_total` is server-computed, so a client cannot post its own arithmetic.
pub fn line_item_fields(parent_field: &'static str, parent_label: &'static str, parent_entity: &'static str) -> Vec<FieldDef> {
    vec![
        reference(parent_field, parent_label, parent_entity).required(),
        reference("item_id", "Item", "inventory.items"),
        text("description", "Description").required().in_list(),
        quantity("quantity", "Qty").required().in_list(),
        money("unit_price", "Unit price").required().in_list(),
        percent("discount_percent", "Discount").in_list(),
        percent("tax_rate", "Tax").in_list(),
        money("line_total", "Amount").readonly().in_list(),
        int("sort_order", "Order"),
    ]
}

/// The same nine currencies the sign-up and settings screens offer. As free
/// text this accepted "Euro", "euros" and "$" alongside "EUR", and every amount
/// on the record was then formatted against a code that means nothing -- the
/// kind of mistake that is invisible until an invoice goes out wrong. The
/// engine validates a Select against its own options, so a typo is now
/// impossible rather than merely discouraged.
///
/// Left optional: an empty currency means "whatever the organisation uses",
/// which is what the reader already falls back to.
pub fn currency_field() -> FieldDef {
    select(
        "currency",
        "Currency",
        vec![
            opt("USD", "USD — US Dollar", "neutral"),
            opt("EUR", "EUR — Euro", "neutral"),
            opt("GBP", "GBP — British Pound", "neutral"),
            opt("INR", "INR — Indian Rupee", "neutral"),
            opt("AUD", "AUD — Australian Dollar", "neutral"),
            opt("CAD", "CAD — Canadian Dollar", "neutral"),
            opt("SGD", "SGD — Singapore Dollar", "neutral"),
            opt("AED", "AED — UAE Dirham", "neutral"),
            opt("JPY", "JPY — Japanese Yen", "neutral"),
        ],
    )
    .help("Leave blank to use your organisation's currency.")
}

pub fn document_totals() -> Vec<FieldDef> {
    vec![
        money("subtotal", "Subtotal").readonly().in_list(),
        money("discount_total", "Discount").readonly(),
        money("tax_total", "Tax").readonly(),
        money("total", "Total").readonly().in_list(),
    ]
}
