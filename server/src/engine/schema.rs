//! Entity metadata.
//!
//! Every business object in the suite is described once, here, as an
//! `EntityDef`. The generic repository turns those definitions into SQL, the
//! `/meta` endpoints ship them to the browser, and the Next.js app renders its
//! list and detail screens from them. Adding a module means adding data, not
//! another hand-written CRUD stack.

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FieldKind {
    Text,
    LongText,
    Email,
    Phone,
    Url,
    /// Plain whole number.
    Int,
    /// Signed minor units (cents). Paired with the record's currency.
    Money,
    /// Percentage scaled by 10_000, so 18.5% is stored as 185_000.
    Percent,
    /// Quantity scaled by 1_000, so 2.5 units is stored as 2_500.
    Quantity,
    Bool,
    /// ISO date, `YYYY-MM-DD`.
    Date,
    /// RFC3339 UTC timestamp.
    DateTime,
    Select {
        options: Vec<SelectOption>,
    },
    /// Foreign key to another entity, stored as that entity's TEXT id.
    Ref {
        entity: &'static str,
    },
    /// Free-form JSON, stored as TEXT.
    Json,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SelectOption {
    pub value: &'static str,
    pub label: &'static str,
    /// Tailwind-ish semantic tone the UI maps to a badge colour.
    pub tone: &'static str,
}

pub fn opt(value: &'static str, label: &'static str, tone: &'static str) -> SelectOption {
    SelectOption { value, label, tone }
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldDef {
    pub name: &'static str,
    pub label: &'static str,
    pub kind: FieldKind,
    pub required: bool,
    /// Shown as a column in the default list view.
    pub in_list: bool,
    /// Included in the entity's free-text search.
    pub searchable: bool,
    pub sortable: bool,
    /// Server-computed: accepted from the client is ignored on write.
    pub readonly: bool,
    /// Value used when a create omits this field. Mirrors the column's own
    /// DEFAULT, so `required` can mean "must end up with a value" without
    /// forcing every client to restate the obvious one.
    pub default: Option<&'static str>,
    pub help: Option<&'static str>,
    /// A free-text field whose values form a small vocabulary the user invents
    /// and then reuses -- category, city, industry. The client offers whatever
    /// is already in use as suggestions so the same thing is not filed under
    /// "Hardware", "hardware" and "HW", while still accepting a new value.
    pub suggest: bool,
}

impl FieldDef {
    pub fn new(name: &'static str, label: &'static str, kind: FieldKind) -> Self {
        let sortable = !matches!(kind, FieldKind::Json | FieldKind::LongText);
        let searchable = matches!(
            kind,
            FieldKind::Text | FieldKind::Email | FieldKind::Phone | FieldKind::Url
        );
        Self {
            name,
            label,
            kind,
            required: false,
            in_list: false,
            searchable,
            sortable,
            readonly: false,
            default: None,
            help: None,
            suggest: false,
        }
    }
    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }
    pub fn in_list(mut self) -> Self {
        self.in_list = true;
        self
    }
    pub fn searchable(mut self) -> Self {
        self.searchable = true;
        self
    }
    pub fn not_searchable(mut self) -> Self {
        self.searchable = false;
        self
    }
    pub fn readonly(mut self) -> Self {
        self.readonly = true;
        self
    }
    /// Must match the column's SQL DEFAULT, or a create that omits the field
    /// and one that sends the default would disagree.
    pub fn with_default(mut self, value: &'static str) -> Self {
        self.default = Some(value);
        self
    }
    pub fn help(mut self, h: &'static str) -> Self {
        self.help = Some(h);
        self
    }
    pub fn suggests(mut self) -> Self {
        self.suggest = true;
        self
    }
}

// Field constructors, kept terse because entity definitions are long.
pub fn text(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Text) }
pub fn long_text(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::LongText) }
pub fn email(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Email) }
pub fn phone(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Phone) }
pub fn url(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Url) }
pub fn int(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Int) }
pub fn money(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Money) }
pub fn percent(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Percent) }
pub fn quantity(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Quantity) }
pub fn boolean(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Bool) }
pub fn date(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Date) }
pub fn datetime(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::DateTime) }
pub fn json(n: &'static str, l: &'static str) -> FieldDef { FieldDef::new(n, l, FieldKind::Json) }
pub fn select(n: &'static str, l: &'static str, options: Vec<SelectOption>) -> FieldDef {
    FieldDef::new(n, l, FieldKind::Select { options })
}
pub fn reference(n: &'static str, l: &'static str, entity: &'static str) -> FieldDef {
    FieldDef::new(n, l, FieldKind::Ref { entity })
}

/// A child collection rendered on the parent's detail page (invoice lines,
/// project tasks, ticket replies...).
#[derive(Debug, Clone, Serialize)]
pub struct ChildDef {
    /// Entity key of the child.
    pub entity: &'static str,
    /// Column on the child that points back at this record.
    pub foreign_key: &'static str,
    pub label: &'static str,
    /// Child rows are part of the parent document (invoice lines) rather than
    /// independent records (an account's contacts).
    pub inline: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EntityDef {
    /// Stable API key, `module.plural`, e.g. `crm.leads`.
    pub key: &'static str,
    pub table: &'static str,
    pub module: &'static str,
    pub label: &'static str,
    pub label_plural: &'static str,
    /// lucide-react icon name.
    pub icon: &'static str,
    /// Field used as the human-readable title of a record.
    pub title_field: &'static str,
    pub fields: Vec<FieldDef>,
    pub default_sort: (&'static str, SortDir),
    pub children: Vec<ChildDef>,
    /// Timeline of notes, calls, meetings and tasks on the record.
    pub has_activities: bool,
    /// Free-form notes.
    pub has_notes: bool,
    /// Exposed in the app's global search.
    pub global_search: bool,
    /// Hidden from the sidebar: reached only through its parent.
    pub embedded: bool,
    /// Backed by a view or otherwise managed elsewhere: the generic engine
    /// serves reads but refuses writes.
    pub read_only: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortDir {
    pub fn sql(self) -> &'static str {
        match self {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        }
    }
}

impl EntityDef {
    pub fn field(&self, name: &str) -> Option<&FieldDef> {
        self.fields.iter().find(|f| f.name == name)
    }

    /// Columns this entity owns, system columns included, in a fixed order.
    pub fn selectable_columns(&self) -> Vec<&'static str> {
        let mut cols = vec!["id"];
        cols.extend(self.fields.iter().map(|f| f.name));
        cols.extend_from_slice(&["created_at", "updated_at", "created_by", "updated_by"]);
        cols
    }

    /// Columns a client is allowed to write.
    pub fn writable_fields(&self) -> impl Iterator<Item = &FieldDef> {
        self.fields.iter().filter(|f| !f.readonly)
    }

    pub fn searchable_fields(&self) -> Vec<&FieldDef> {
        self.fields.iter().filter(|f| f.searchable).collect()
    }
}

/// A module is a group of entities that shows up as one app in the sidebar.
#[derive(Debug, Clone, Serialize)]
pub struct ModuleDef {
    pub key: &'static str,
    pub label: &'static str,
    pub icon: &'static str,
    pub color: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Default)]
pub struct Registry {
    entities: BTreeMap<&'static str, EntityDef>,
    modules: Vec<ModuleDef>,
    order: Vec<&'static str>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_module(&mut self, m: ModuleDef) -> &mut Self {
        self.modules.push(m);
        self
    }

    pub fn add(&mut self, e: EntityDef) -> &mut Self {
        self.order.push(e.key);
        self.entities.insert(e.key, e);
        self
    }

    pub fn get(&self, key: &str) -> Option<&EntityDef> {
        self.entities.get(key)
    }

    pub fn entities(&self) -> impl Iterator<Item = &EntityDef> {
        self.order.iter().filter_map(move |k| self.entities.get(k))
    }

    pub fn modules(&self) -> &[ModuleDef] {
        &self.modules
    }

    pub fn entities_in(&self, module: &str) -> Vec<&EntityDef> {
        self.entities().filter(|e| e.module == module).collect()
    }

    /// Fails fast at boot if a definition references something that does not
    /// exist - a typo in an entity key should never reach a request.
    pub fn validate(&self) -> Result<(), String> {
        for e in self.entities() {
            if e.field(e.title_field).is_none() && e.title_field != "id" {
                return Err(format!("{}: title_field `{}` is not a field", e.key, e.title_field));
            }
            if e.field(e.default_sort.0).is_none()
                && !["created_at", "updated_at", "id"].contains(&e.default_sort.0)
            {
                return Err(format!("{}: default_sort `{}` is not a field", e.key, e.default_sort.0));
            }
            if !self.modules.iter().any(|m| m.key == e.module) {
                return Err(format!("{}: unknown module `{}`", e.key, e.module));
            }
            for f in &e.fields {
                if let FieldKind::Ref { entity } = &f.kind {
                    if self.get(entity).is_none() {
                        return Err(format!(
                            "{}.{}: references unknown entity `{}`",
                            e.key, f.name, entity
                        ));
                    }
                }
            }
            for c in &e.children {
                let child = self
                    .get(c.entity)
                    .ok_or_else(|| format!("{}: unknown child entity `{}`", e.key, c.entity))?;
                if child.field(c.foreign_key).is_none() {
                    return Err(format!(
                        "{}: child `{}` has no field `{}`",
                        e.key, c.entity, c.foreign_key
                    ));
                }
            }
        }
        Ok(())
    }
}
