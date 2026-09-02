use crate::engine::schema::*;
use crate::modules::crm::lead_sources;

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "marketing",
        label: "Marketing",
        icon: "Megaphone",
        color: "warning",
        description: "Campaigns and their return.",
    });

    r.add(EntityDef {
        key: "marketing.campaigns",
        table: "campaigns",
        module: "marketing",
        label: "Campaign",
        label_plural: "Campaigns",
        icon: "Megaphone",
        title_field: "name",
        fields: vec![
            text("name", "Campaign").required().in_list(),
            select("campaign_type", "Type", vec![
                opt("email", "Email", "brand"),
                opt("webinar", "Webinar", "info"),
                opt("event", "Event", "purple"),
                opt("ads", "Paid ads", "warning"),
                opt("content", "Content", "success"),
                opt("referral", "Referral", "neutral"),
            ]).in_list(),
            select("status", "Status", vec![
                opt("planning", "Planning", "neutral"),
                opt("active", "Active", "brand"),
                opt("paused", "Paused", "warning"),
                opt("completed", "Completed", "success"),
                opt("cancelled", "Cancelled", "danger"),
            ]).required().with_default("planning").in_list(),
            date("start_date", "Starts").in_list(),
            date("end_date", "Ends").in_list(),
            money("budget", "Budget").in_list(),
            money("actual_cost", "Actual cost").in_list(),
            money("expected_revenue", "Expected revenue").in_list(),
            int("target_size", "Audience size"),
            int("responses", "Responses").in_list(),
            reference("owner_id", "Owner", "core.users").in_list(),
            long_text("description", "Description"),
        ],
        default_sort: ("start_date", SortDir::Desc),
        children: vec![],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    // Referenced so the shared source list stays in one place.
    let _ = lead_sources();
}
