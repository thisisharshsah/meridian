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
        let page = self.page.max(1);
        (page, per_page)
    }
    pub fn offset(&self) -> i64 {
        let (page, per_page) = self.clamped();
        (page - 1) * per_page
    }
    pub fn limit(&self) -> i64 {
        self.clamped().1
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
