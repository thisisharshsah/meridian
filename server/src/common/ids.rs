use uuid::Uuid;

/// Time-ordered identifier. UUIDv7 keeps primary keys sortable by creation time,
/// which keeps SQLite b-tree inserts append-mostly and makes `ORDER BY id` a
/// sane tiebreaker for pagination.
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}

pub fn is_valid_id(s: &str) -> bool {
    Uuid::parse_str(s).is_ok()
}
