use crate::engine::schema::*;

pub fn register(r: &mut Registry) {
    r.add_module(ModuleDef {
        key: "recruit",
        label: "Recruit",
        icon: "UserSearch",
        color: "info",
        description: "Open roles and the candidate pipeline.",
    });

    r.add(EntityDef {
        key: "recruit.job_openings",
        table: "job_openings",
        module: "recruit",
        label: "Job opening",
        label_plural: "Job openings",
        icon: "Briefcase",
        title_field: "title",
        fields: vec![
            text("title", "Role").required().in_list(),
            reference("department_id", "Department", "hr.departments").in_list(),
            select("status", "Status", vec![
                opt("draft", "Draft", "neutral"),
                opt("open", "Open", "success"),
                opt("on_hold", "On hold", "warning"),
                opt("filled", "Filled", "brand"),
                opt("closed", "Closed", "neutral"),
            ]).required().with_default("open").in_list(),
            select("employment_type", "Employment", vec![
                opt("full_time", "Full time", "brand"),
                opt("part_time", "Part time", "info"),
                opt("contract", "Contract", "warning"),
                opt("intern", "Intern", "purple"),
            ]).required().with_default("full_time").in_list(),
            text("location", "Location").in_list().suggests(),
            int("openings", "Positions").in_list(),
            money("salary_min", "Salary from"),
            money("salary_max", "Salary to"),
            reference("hiring_manager_id", "Hiring manager", "core.users").in_list(),
            date("target_date", "Target date").in_list(),
            long_text("description", "Description"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![ChildDef {
            entity: "recruit.candidates",
            foreign_key: "job_opening_id",
            label: "Candidates",
            inline: false,
        }],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });

    r.add(EntityDef {
        key: "recruit.candidates",
        table: "candidates",
        module: "recruit",
        label: "Candidate",
        label_plural: "Candidates",
        icon: "UserSearch",
        title_field: "full_name",
        fields: vec![
            text("number", "Candidate #").readonly().in_list(),
            text("full_name", "Name").required().in_list(),
            email("email", "Email").in_list(),
            phone("phone", "Phone"),
            reference("job_opening_id", "Applied for", "recruit.job_openings").in_list(),
            select("stage", "Stage", candidate_stages()).required().with_default("applied").in_list(),
            text("source", "Source").in_list().suggests(),
            text("current_company", "Current company").in_list(),
            int("experience_years", "Experience (yrs)").in_list(),
            money("expected_salary", "Expected salary"),
            int("rating", "Rating").in_list(),
            reference("owner_id", "Recruiter", "core.users").in_list(),
            url("resume_url", "Resume"),
            long_text("notes", "Notes"),
        ],
        default_sort: ("created_at", SortDir::Desc),
        children: vec![],
        has_activities: true,
        has_notes: true,
        global_search: true,
        embedded: false,
        read_only: false,
    });
}

pub fn candidate_stages() -> Vec<SelectOption> {
    vec![
        opt("applied", "Applied", "neutral"),
        opt("screening", "Screening", "info"),
        opt("interview", "Interview", "brand"),
        opt("offer", "Offer", "warning"),
        opt("hired", "Hired", "success"),
        opt("rejected", "Rejected", "danger"),
    ]
}
