use crate::engine::schema::*;

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "desk",
        label: "Support",
        icon: "LifeBuoy",
        color: "danger",
        description: "Customer tickets and the knowledge base.",
    });

    r.add(EntityDef {
        key: "desk.tickets",
        table: "tickets",
        module: "desk",
        label: "Ticket",
        label_plural: "Tickets",
        icon: "Ticket",
        title_field: "subject",
        fields: vec![
            text("number", "Ticket #").readonly().in_list(),
            text("subject", "Subject").required().in_list(),
            reference("account_id", "Account", "crm.accounts").in_list(),
            reference("contact_id", "Contact", "crm.contacts").in_list(),
            select("status", "Status", ticket_statuses()).required().with_default("open").in_list(),
            select("priority", "Priority", vec![
                opt("low", "Low", "neutral"),
                opt("normal", "Normal", "info"),
                opt("high", "High", "warning"),
                opt("urgent", "Urgent", "danger"),
            ]).required().with_default("normal").in_list(),
            select("channel", "Channel", vec![
                opt("email", "Email", "brand"),
                opt("phone", "Phone", "info"),
                opt("web", "Web form", "purple"),
                opt("chat", "Chat", "success"),
            ]).required().with_default("email"),
            text("category", "Category").in_list().suggests(),
            reference("assignee_id", "Assignee", "core.users").in_list(),
            datetime("due_at", "Due by").in_list(),
            datetime("first_response_at", "First response").readonly(),
            datetime("resolved_at", "Resolved at").readonly(),
            select("satisfaction", "Satisfaction", vec![
                opt("good", "Good", "success"),
                opt("neutral", "Neutral", "warning"),
                opt("bad", "Bad", "danger"),
            ]),
            long_text("description", "Description"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![ChildDef {
            entity: "desk.comments",
            foreign_key: "ticket_id",
            label: "Conversation",
            inline: true,
        }],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "desk.comments",
        table: "ticket_comments",
        module: "desk",
        label: "Reply",
        label_plural: "Replies",
        icon: "MessageSquare",
        title_field: "body",
        fields: vec![
            reference("ticket_id", "Ticket", "desk.tickets").required(),
            long_text("body", "Message").required().in_list(),
            boolean("is_public", "Visible to customer").in_list(),
            reference("author_id", "Author", "core.users").in_list(),
        ],
        default_sort: ("created_at", SortDir::Asc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: false,
        embedded: true,
        read_only: false,
    });

    r.add(EntityDef {
        key: "desk.articles",
        table: "kb_articles",
        module: "desk",
        label: "Article",
        label_plural: "Knowledge base",
        icon: "BookOpen",
        title_field: "title",
        fields: vec![
            text("title", "Title").required().in_list(),
            text("category", "Category").in_list().suggests(),
            select("status", "Status", vec![
                opt("draft", "Draft", "neutral"),
                opt("published", "Published", "success"),
                opt("archived", "Archived", "warning"),
            ]).required().with_default("draft").in_list(),
            long_text("body", "Content"),
            int("views", "Views").in_list(),
            int("helpful_count", "Marked helpful"),
            reference("author_id", "Author", "core.users").in_list(),
            datetime("published_at", "Published at"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![],
        has_activities: false,
        has_notes: false,
        global_search: true,
        embedded: false,
        read_only: false,
    });
}

pub fn ticket_statuses() -> Vec<SelectOption> {
    vec![
        opt("open", "Open", "info"),
        opt("in_progress", "In progress", "brand"),
        opt("on_hold", "On hold", "warning"),
        opt("resolved", "Resolved", "success"),
        opt("closed", "Closed", "neutral"),
    ]
}
