use crate::engine::schema::*;

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "projects",
        label: "Projects",
        icon: "FolderKanban",
        color: "info",
        description: "Delivery work, milestones, tasks and time.",
    });

    r.add(EntityDef {
        key: "projects.projects",
        table: "projects",
        module: "projects",
        label: "Project",
        label_plural: "Projects",
        icon: "FolderKanban",
        title_field: "name",
        fields: vec![
            text("name", "Project name").required().in_list(),
            text("code", "Code").in_list(),
            reference("account_id", "Customer", "crm.accounts").in_list(),
            select("status", "Status", vec![
                opt("planning", "Planning", "neutral"),
                opt("active", "Active", "brand"),
                opt("on_hold", "On hold", "warning"),
                opt("completed", "Completed", "success"),
                opt("cancelled", "Cancelled", "danger"),
            ]).required().with_default("active").in_list(),
            select("billing_type", "Billing", vec![
                opt("fixed", "Fixed fee", "brand"),
                opt("hourly", "Hourly", "info"),
                opt("non_billable", "Non-billable", "neutral"),
            ]).required().with_default("fixed").in_list(),
            money("budget", "Budget").in_list(),
            money("hourly_rate", "Hourly rate"),
            date("start_date", "Start date").in_list(),
            date("end_date", "End date").in_list(),
            percent("progress", "Progress").in_list(),
            reference("owner_id", "Lead", "core.users").in_list(),
            long_text("description", "Description"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![
            ChildDef { entity: "projects.milestones", foreign_key: "project_id", label: "Milestones", inline: false },
            ChildDef { entity: "projects.tasks", foreign_key: "project_id", label: "Tasks", inline: false },
            ChildDef { entity: "projects.timesheets", foreign_key: "project_id", label: "Time logs", inline: false },
        ],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "projects.milestones",
        table: "milestones",
        module: "projects",
        label: "Milestone",
        label_plural: "Milestones",
        icon: "Flag",
        title_field: "name",
        fields: vec![
            text("name", "Milestone").required().in_list(),
            reference("project_id", "Project", "projects.projects").required().in_list(),
            select("status", "Status", vec![
                opt("open", "Open", "info"),
                opt("completed", "Completed", "success"),
            ]).required().with_default("open").in_list(),
            date("due_date", "Due date").in_list(),
            reference("owner_id", "Owner", "core.users").in_list(),
            long_text("description", "Description"),
        ],
        default_sort: ("due_date", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "projects.tasks",
        table: "project_tasks",
        module: "projects",
        label: "Task",
        label_plural: "Tasks",
        icon: "CheckSquare",
        title_field: "name",
        fields: vec![
            text("name", "Task").required().in_list(),
            reference("project_id", "Project", "projects.projects").required().in_list(),
            reference("milestone_id", "Milestone", "projects.milestones"),
            select("status", "Status", task_statuses()).required().with_default("todo").in_list(),
            select("priority", "Priority", vec![
                opt("low", "Low", "neutral"),
                opt("normal", "Normal", "info"),
                opt("high", "High", "warning"),
                opt("urgent", "Urgent", "danger"),
            ]).in_list(),
            reference("assignee_id", "Assignee", "core.users").in_list(),
            date("start_date", "Start"),
            date("due_date", "Due").in_list(),
            quantity("estimated_hours", "Estimated hrs").in_list(),
            quantity("logged_hours", "Logged hrs").readonly().in_list(),
            int("sort_order", "Order"),
            long_text("description", "Description"),
            datetime("completed_at", "Completed at").readonly(),
        ],
        default_sort: ("due_date", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "projects.timesheets",
        table: "timesheets",
        module: "projects",
        label: "Time log",
        label_plural: "Time logs",
        icon: "Clock",
        title_field: "notes",
        fields: vec![
            reference("project_id", "Project", "projects.projects").required().in_list(),
            reference("task_id", "Task", "projects.tasks").in_list(),
            reference("user_id", "Member", "core.users").required().in_list(),
            date("work_date", "Date").required().in_list(),
            quantity("hours", "Hours").required().in_list(),
            boolean("billable", "Billable").in_list(),
            boolean("billed", "Billed"),
            text("notes", "Notes").in_list(),
        ],
        default_sort: ("work_date", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: false,
        read_only: false,
    });
}

pub fn task_statuses() -> Vec<SelectOption> {
    vec![
        opt("todo", "To do", "neutral"),
        opt("in_progress", "In progress", "brand"),
        opt("review", "In review", "warning"),
        opt("done", "Done", "success"),
        opt("blocked", "Blocked", "danger"),
    ]
}
