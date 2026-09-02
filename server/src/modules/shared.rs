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

pub fn currency_field() -> FieldDef {
    text("currency", "Currency")
}

pub fn document_totals() -> Vec<FieldDef> {
    vec![
        money("subtotal", "Subtotal").readonly().in_list(),
        money("discount_total", "Discount").readonly(),
        money("tax_total", "Tax").readonly(),
        money("total", "Total").readonly().in_list(),
    ]
}
