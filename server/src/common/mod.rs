/// What a business charges in until it says otherwise.
///
/// The clients carry the same constant in `packages/shared/src/constants.ts`,
/// and the two have to agree: a form offering rupees while the database writes
/// dollars is a wrong number on every invoice after it. This product is sold
/// in Nepal and India first, which is the whole of the reason it is not USD.
pub const DEFAULT_CURRENCY: &str = "NPR";

pub mod audit;
pub mod ids;
pub mod money;
pub mod pagination;
pub mod sequences;
