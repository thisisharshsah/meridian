//! Money is stored as a signed integer count of minor units (cents, paise...)
//! alongside an ISO-4217 currency code. Never floats: `0.1 + 0.2 != 0.3` is not
//! an acceptable property for an invoice total.

use serde::{Deserialize, Serialize};

pub const SCALE: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Minor(pub i64);

impl Minor {
    pub fn zero() -> Self {
        Minor(0)
    }
    pub fn as_f64(self) -> f64 {
        self.0 as f64 / SCALE as f64
    }
}

/// The largest magnitude any single scaled value may hold.
///
/// Well inside `i64` (about 9.2e18) with six orders of magnitude to spare, so a
/// document can sum a great many lines without the total going anywhere near
/// the edge. In minor units this is roughly 92 billion of the major unit —
/// past any real invoice, and short of where the arithmetic stops being exact.
pub const MAX_SCALED: i64 = 9_223_372_036_854;

/// Round-half-up on a rational amount expressed in minor units.
///
/// Saturates rather than wrapping: `as i64` on an out-of-range `i128` silently
/// produces a number of the wrong sign, which on a money path means an invoice
/// that reads as a credit.
pub fn round_div(numerator: i128, denominator: i128) -> i64 {
    if denominator == 0 {
        return 0;
    }
    let negative = (numerator < 0) != (denominator < 0);
    let n = numerator.abs();
    let d = denominator.abs();
    let q = (n * 2 + d) / (d * 2);
    let q = i64::try_from(q).unwrap_or(i64::MAX);
    if negative {
        -q
    } else {
        q
    }
}

/// Apply a percentage (expressed with 4 decimal places, so 18.5% => 185000)
/// to an amount in minor units.
pub const PERCENT_SCALE: i64 = 10_000;

pub fn apply_percent(amount_minor: i64, percent_scaled: i64) -> i64 {
    round_div(amount_minor as i128 * percent_scaled as i128, (PERCENT_SCALE * 100) as i128)
}

/// quantity is stored scaled by 1000 (3 decimal places) so partial units work.
pub const QTY_SCALE: i64 = 1000;

pub fn line_subtotal(qty_scaled: i64, unit_price_minor: i64) -> i64 {
    round_div(qty_scaled as i128 * unit_price_minor as i128, QTY_SCALE as i128)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_div_saturates_instead_of_wrapping() {
        // `as i64` here would produce a negative number, turning an invoice
        // line into a credit note.
        assert_eq!(round_div(i128::from(i64::MAX) * 4, 1), i64::MAX);
        assert_eq!(round_div(i128::from(i64::MIN) * 4, 1), -i64::MAX);
        assert_eq!(round_div(5, 0), 0, "a zero denominator is not a panic");
    }

    #[test]
    fn rounds_half_up() {
        assert_eq!(round_div(5, 2), 3);
        assert_eq!(round_div(-5, 2), -3);
        assert_eq!(round_div(4, 2), 2);
    }

    #[test]
    fn percent_of_amount() {
        // 18% of 1000.00 = 180.00
        assert_eq!(apply_percent(100_000, 18 * PERCENT_SCALE), 18_000);
        // 7.5% of 19.99 = 1.49925 -> 1.50
        assert_eq!(apply_percent(1_999, 75_000), 150);
    }

    #[test]
    fn subtotal_handles_fractional_quantity() {
        // 2.5 units at 19.99
        assert_eq!(line_subtotal(2_500, 1_999), 4_998);
    }
}
