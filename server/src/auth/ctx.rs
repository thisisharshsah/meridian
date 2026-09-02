use std::collections::HashSet;

use crate::error::{AppError, AppResult};

/// Everything a handler needs to know about *who* is asking. Every repository
/// call takes a `&Ctx`, and every query is scoped by `ctx.org_id` - tenant
/// isolation is a property of the data-access layer, not of individual handlers.
#[derive(Debug, Clone)]
pub struct Ctx {
    pub user_id: String,
    pub org_id: String,
    pub email: String,
    pub name: String,
    pub role_key: String,
    pub is_owner: bool,
    /// Permission strings: `*`, `crm.*`, `crm.leads.view`, ...
    pub permissions: HashSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    View,
    Create,
    Edit,
    Delete,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Action::View => "view",
            Action::Create => "create",
            Action::Edit => "edit",
            Action::Delete => "delete",
        }
    }
}

impl Ctx {
    /// Does this context allow `action` on `entity`? Owners bypass checks so an
    /// organization can never lock itself out of its own data.
    pub fn can(&self, entity: &str, action: Action) -> bool {
        if self.is_owner || self.permissions.contains("*") {
            return true;
        }
        let exact = format!("{entity}.{}", action.as_str());
        if self.permissions.contains(&exact) {
            return true;
        }
        if self.permissions.contains(&format!("{entity}.*")) {
            return true;
        }
        // Module-level grants: `crm.*` covers every action on every CRM entity,
        // and `crm.*.view` covers just the read action across the module.
        if let Some((module, _)) = entity.split_once('.') {
            if self.permissions.contains(&format!("{module}.*")) {
                return true;
            }
            if self.permissions.contains(&format!("{module}.*.{}", action.as_str())) {
                return true;
            }
        }
        false
    }

    pub fn require(&self, entity: &str, action: Action) -> AppResult<()> {
        if self.can(entity, action) {
            Ok(())
        } else {
            Err(AppError::forbidden(format!(
                "You do not have permission to {} {entity}",
                action.as_str()
            )))
        }
    }

    pub fn require_owner(&self) -> AppResult<()> {
        if self.is_owner {
            Ok(())
        } else {
            Err(AppError::forbidden("Only an organization owner can do this"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(perms: &[&str], owner: bool) -> Ctx {
        Ctx {
            user_id: "u".into(),
            org_id: "o".into(),
            email: "e".into(),
            name: "n".into(),
            role_key: "r".into(),
            is_owner: owner,
            permissions: perms.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn owner_can_do_anything() {
        assert!(ctx(&[], true).can("crm.leads", Action::Delete));
    }

    #[test]
    fn exact_grant_is_scoped_to_that_action() {
        let c = ctx(&["crm.leads.view"], false);
        assert!(c.can("crm.leads", Action::View));
        assert!(!c.can("crm.leads", Action::Delete));
        assert!(!c.can("crm.deals", Action::View));
    }

    #[test]
    fn module_action_wildcard_grants_one_action_across_a_module() {
        let c = ctx(&["crm.*.view"], false);
        assert!(c.can("crm.deals", Action::View));
        assert!(c.can("crm.leads", Action::View));
        assert!(!c.can("crm.deals", Action::Edit));
        assert!(!c.can("books.invoices", Action::View));
    }

    #[test]
    fn module_wildcard_covers_its_entities() {
        let c = ctx(&["crm.*"], false);
        assert!(c.can("crm.deals", Action::Edit));
        assert!(!c.can("books.invoices", Action::Edit));
    }
}
