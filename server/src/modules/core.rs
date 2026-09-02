use crate::engine::schema::*;

/// Cross-cutting entities every module points at.
pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "core",
        label: "Organization",
        icon: "Settings",
        color: "neutral",
        description: "People, roles and workspace settings.",
    });

    r.add(EntityDef {
        key: "core.users",
        // A view over memberships + users, so it carries an org_id.
        table: "org_users",
        module: "core",
        label: "Member",
        label_plural: "Members",
        icon: "Users",
        title_field: "name",
        fields: vec![
            text("name", "Name").required().in_list(),
            email("email", "Email").in_list(),
            text("title", "Job title").in_list(),
            text("role_name", "Role").in_list(),
            select("status", "Status", vec![
                opt("active", "Active", "success"),
                opt("invited", "Invited", "warning"),
                opt("suspended", "Suspended", "danger"),
            ]).in_list(),
            boolean("is_owner", "Owner"),
            datetime("last_login_at", "Last seen").in_list(),
            url("avatar_url", "Avatar"),
        ],
        default_sort: ("name", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: true,
        read_only: true,
    });
}
