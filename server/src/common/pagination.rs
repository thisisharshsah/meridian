use serde::{Deserialize, Serialize};

fn default_page() -> i64 { 1 }
fn default_per_page() -> i64 { 25 }

#[derive(Debug, Clone, Deserialize)]
pub struct PageParams {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_per_page")]
    pub per_page: i64,
}

impl Default for PageParams {
    fn default() -> Self {
        Self { page: default_page(), per_page: default_per_page() }
    }
}

impl PageParams {
    pub fn clamped(&self) -> (i64, i64) {
        let per_page = self.per_page.clamp(1, 200);
        // Bound the page too. Multiplying an unbounded request value by
        // per_page overflows i64 — a panic in debug, and silently page 1 in
        // release. No real result set is a million pages deep.
        let page = self.page.clamp(1, 1_000_000);
        (page, per_page)
    }
    pub fn offset(&self) -> i64 {
        let (page, per_page) = self.clamped();
        page.saturating_sub(1).saturating_mul(per_page)
    }
    pub fn limit(&self) -> i64 {
        self.clamped().1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absurd_page_number_cannot_overflow_the_offset() {
        let p = PageParams { page: i64::MAX, per_page: 200 };
        // Would panic in debug and wrap in release without the clamp.
        assert!(p.offset() >= 0);
        assert_eq!(p.clamped().0, 1_000_000);
    }

    #[test]
    fn page_and_per_page_are_clamped_to_something_servable() {
        assert_eq!(PageParams { page: 0, per_page: 0 }.clamped(), (1, 1));
        assert_eq!(PageParams { page: -5, per_page: 9999 }.clamped(), (1, 200));
    }

    #[test]
    fn total_pages_rounds_up() {
        let p = PageParams { page: 1, per_page: 25 };
        assert_eq!(Page::new(Vec::<i32>::new(), &p, 51).total_pages, 3);
        assert_eq!(Page::new(Vec::<i32>::new(), &p, 0).total_pages, 0);
    }
}

#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub data: Vec<T>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
    pub total_pages: i64,
}

impl<T> Page<T> {
    pub fn new(data: Vec<T>, params: &PageParams, total: i64) -> Self {
        let (page, per_page) = params.clamped();
        let total_pages = if per_page > 0 { (total + per_page - 1) / per_page } else { 0 };
        Self { data, page, per_page, total, total_pages }
    }
}
