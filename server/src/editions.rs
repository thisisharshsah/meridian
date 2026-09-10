//! What a customer bought.
//!
//! An edition is a package of modules sold as a product: "Aurovie Hotel",
//! "Aurovie Shop". It is deliberately a different thing from the two that
//! already exist, and the three compose in one direction only:
//!
//!   the deployment's edition   what this installation is allowed to run
//!     ∩ the workspace's edition  what this customer was sold
//!       ∩ the workspace's sections  what they chose to show themselves
//!
//! Each narrows the one before it. A workspace cannot show a module it was not
//! sold, and cannot be sold one this installation does not carry — so an owner
//! flipping their own switches can never reach a feature they have not paid
//! for, which is the whole reason the licence is separate from the preference.
//!
//! Enforcement differs by layer because the layers differ in kind. The
//! deployment's edition is a fact for the whole process, so it is applied once
//! at startup by not registering the entities at all: no routes, no metadata,
//! nothing to find. The workspace's edition varies per request, so it is
//! checked on every one, at the same choke point as permissions.
//!
//! # Compiling them apart
//!
//! This table is also the manifest a build-time split would read. Turning an
//! edition into its own binary means gating the `register()` calls in
//! `modules::registry` behind cargo features named for these keys and letting
//! the default feature set be `full`; the definitions here do not change, and
//! neither does anything downstream of them. Runtime filtering is what makes
//! that a later decision rather than a prerequisite.

/// A package of modules sold as one product.
#[derive(Debug)]
pub struct Edition {
    pub key: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Modules this edition carries. Empty means every module there is,
    /// including ones that ship after the edition was written.
    pub modules: &'static [&'static str],
}

/// Always present, never sold separately: the workspace itself — its people,
/// roles and settings. An edition without it would be an installation nobody
/// could sign in to.
pub const ALWAYS: &[&str] = &["core"];

pub const EDITIONS: &[Edition] = &[
    Edition {
        key: "full",
        name: "Aurovie Business",
        description: "Everything: the whole suite, and whatever is added to it later.",
        modules: &[],
    },
    Edition {
        key: "shop",
        name: "Aurovie Shop",
        description: "Serving people over a counter, with stock on the shelves.",
        modules: &["crm", "sales", "books", "inventory", "hr"],
    },
    Edition {
        key: "pharmacy",
        name: "Aurovie Pharmacy",
        description: "A counter and dated stock: batches, expiry and first-expired-first-out.",
        modules: &["crm", "sales", "books", "inventory", "hr"],
    },
    Edition {
        key: "hotel",
        name: "Aurovie Rooms",
        description: "Rooms let by the night, with bookings, arrivals and the board.",
        modules: &["hospitality", "crm", "sales", "books", "inventory", "hr"],
    },
    Edition {
        key: "services",
        name: "Aurovie Practice",
        description: "Billing for time and work: an agency, a practice, a firm.",
        modules: &["crm", "sales", "books", "projects", "hr", "desk"],
    },
    Edition {
        key: "trades",
        name: "Aurovie Field",
        description: "Jobs at a customer’s premises, with parts, a van and a schedule.",
        modules: &["crm", "sales", "books", "inventory", "projects", "hr"],
    },
];

pub fn find(key: &str) -> Option<&'static Edition> {
    EDITIONS.iter().find(|e| e.key == key)
}

impl Edition {
    /// Does this edition carry `module`?
    pub fn carries(&self, module: &str) -> bool {
        ALWAYS.contains(&module) || self.modules.is_empty() || self.modules.contains(&module)
    }

    /// Does it carry the module this entity belongs to? Entity keys are
    /// `module.entity`, and an entity whose key has no module is a mistake
    /// rather than something to let through.
    pub fn carries_entity(&self, entity: &str) -> bool {
        entity.split_once('.').map(|(m, _)| self.carries(m)).unwrap_or(false)
    }

    /// Can this edition be sold inside `ceiling`? An installation cannot sell
    /// what it does not carry, so a narrower edition is only offerable when
    /// every module it names is present in the wider one.
    pub fn fits_within(&self, ceiling: &Edition) -> bool {
        if ceiling.modules.is_empty() {
            return true;
        }
        if self.modules.is_empty() {
            // "Everything" only fits inside "everything".
            return false;
        }
        self.modules.iter().all(|m| ceiling.carries(m))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_carries_every_module_the_registry_has() {
        let full = find("full").expect("the full edition exists");
        for m in crate::modules::registry().modules() {
            assert!(full.carries(m.key), "full is missing {}", m.key);
        }
    }

    #[test]
    fn every_edition_names_modules_that_exist() {
        let registry = crate::modules::registry();
        for e in EDITIONS {
            for m in e.modules {
                assert!(
                    registry.modules().iter().any(|r| r.key == *m),
                    "edition `{}` names `{m}`, which is not a module",
                    e.key
                );
            }
            assert!(e.carries("core"), "`{}` must carry the workspace itself", e.key);
        }
    }

    #[test]
    fn a_narrower_edition_fits_inside_a_wider_one() {
        let (full, hotel, shop) = (find("full").unwrap(), find("hotel").unwrap(), find("shop").unwrap());
        assert!(hotel.fits_within(full), "anything fits inside everything");
        assert!(shop.fits_within(hotel), "a hotel installation can sell the shop package");
        assert!(!hotel.fits_within(shop), "a shop installation cannot sell rooms it does not carry");
        assert!(!full.fits_within(shop), "nor can it sell everything");
    }
}
