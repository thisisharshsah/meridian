//! Conversion between JSON coming off the wire and SQLite bind values, driven
//! by the field's declared kind. This is the only place that decides what a
//! client is allowed to put in a column.

use serde_json::Value;

use crate::engine::schema::{FieldDef, FieldKind};
use crate::error::FieldError;

#[derive(Debug, Clone, PartialEq)]
pub enum Bind {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

pub type SqlQuery<'a> = sqlx::query::Query<'a, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>;

pub fn bind_one<'a>(q: SqlQuery<'a>, b: &Bind) -> SqlQuery<'a> {
    match b {
        Bind::Null => q.bind(Option::<String>::None),
        Bind::Int(i) => q.bind(*i),
        Bind::Real(f) => q.bind(*f),
        Bind::Text(s) => q.bind(s.clone()),
    }
}

fn err(field: &str, msg: impl Into<String>) -> FieldError {
    FieldError::new(field, msg)
}

/// Parse a decimal string or number into a scaled integer.
/// `"12.34"` with scale 100 becomes 1234. Rejects excess precision loudly
/// rather than silently truncating money.
pub fn parse_scaled(raw: &str, scale: i64, field: &str) -> Result<i64, FieldError> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(err(field, "must be a number"));
    }
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i, f),
        None => (s, ""),
    };
    if int_part.is_empty() && frac_part.is_empty() {
        return Err(err(field, "must be a number"));
    }
    if !int_part.chars().all(|c| c.is_ascii_digit())
        || !frac_part.chars().all(|c| c.is_ascii_digit())
    {
        return Err(err(field, "must be a number"));
    }
    let digits = (scale as f64).log10().round() as usize;
    if frac_part.len() > digits {
        return Err(err(
            field,
            format!("supports at most {digits} decimal place(s)"),
        ));
    }
    let mut frac = frac_part.to_string();
    while frac.len() < digits {
        frac.push('0');
    }
    let int_val: i64 = if int_part.is_empty() {
        0
    } else {
        int_part.parse().map_err(|_| err(field, "number is too large"))?
    };
    let frac_val: i64 = if frac.is_empty() { 0 } else { frac.parse().unwrap_or(0) };
    let total = int_val
        .checked_mul(scale)
        .and_then(|v| v.checked_add(frac_val))
        .ok_or_else(|| err(field, "number is too large"))?;

    // Bound the magnitude, not just the type. `i64` alone still lets a single
    // line carry a value large enough that summing a document overflows, and a
    // wrapped total reads as a negative amount owed.
    if total > crate::common::money::MAX_SCALED {
        return Err(err(field, "number is too large"));
    }

    Ok(if neg { -total } else { total })
}

fn scale_for(kind: &FieldKind) -> Option<i64> {
    match kind {
        FieldKind::Money => Some(crate::common::money::SCALE),
        FieldKind::Percent => Some(crate::common::money::PERCENT_SCALE),
        FieldKind::Quantity => Some(crate::common::money::QTY_SCALE),
        _ => None,
    }
}

/// Validate + coerce one incoming JSON value for `field`.
pub fn to_bind(field: &FieldDef, value: &Value) -> Result<Bind, FieldError> {
    let name = field.name;

    if value.is_null() {
        if field.required {
            return Err(err(name, format!("{} is required", field.label)));
        }
        return Ok(Bind::Null);
    }

    // Empty strings mean "cleared" for every kind except free text.
    if let Value::String(s) = value {
        if s.is_empty() && !matches!(field.kind, FieldKind::Text | FieldKind::LongText) {
            if field.required {
                return Err(err(name, format!("{} is required", field.label)));
            }
            return Ok(Bind::Null);
        }
    }

    match &field.kind {
        FieldKind::Text | FieldKind::LongText => {
            let s = as_string(value).ok_or_else(|| err(name, "must be text"))?;
            if field.required && s.trim().is_empty() {
                return Err(err(name, format!("{} is required", field.label)));
            }
            let max = if matches!(field.kind, FieldKind::LongText) { 100_000 } else { 1_000 };
            if s.chars().count() > max {
                return Err(err(name, format!("must be {max} characters or fewer")));
            }
            Ok(Bind::Text(s))
        }
        FieldKind::Email => {
            let s = as_string(value).ok_or_else(|| err(name, "must be text"))?;
            let s = s.trim().to_lowercase();
            if !is_email(&s) {
                return Err(err(name, "must be a valid email address"));
            }
            Ok(Bind::Text(s))
        }
        FieldKind::Phone => {
            let s = as_string(value).ok_or_else(|| err(name, "must be text"))?;
            let s = s.trim().to_string();
            if s.chars().count() > 40 {
                return Err(err(name, "must be 40 characters or fewer"));
            }
            Ok(Bind::Text(s))
        }
        FieldKind::Url => {
            let s = as_string(value).ok_or_else(|| err(name, "must be text"))?;
            let s = s.trim().to_string();
            if !(s.starts_with("http://") || s.starts_with("https://")) {
                return Err(err(name, "must start with http:// or https://"));
            }
            Ok(Bind::Text(s))
        }
        FieldKind::Int => match value {
            Value::Number(n) => n
                .as_i64()
                .map(Bind::Int)
                .ok_or_else(|| err(name, "must be a whole number")),
            Value::String(s) => s
                .trim()
                .parse::<i64>()
                .map(Bind::Int)
                .map_err(|_| err(name, "must be a whole number")),
            _ => Err(err(name, "must be a whole number")),
        },
        FieldKind::Money | FieldKind::Percent | FieldKind::Quantity => {
            let scale = scale_for(&field.kind).unwrap();
            let raw = match value {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => return Err(err(name, "must be a number")),
            };
            parse_scaled(&raw, scale, name).map(Bind::Int)
        }
        FieldKind::Bool => match value {
            Value::Bool(b) => Ok(Bind::Int(if *b { 1 } else { 0 })),
            Value::Number(n) => Ok(Bind::Int(if n.as_i64().unwrap_or(0) != 0 { 1 } else { 0 })),
            Value::String(s) => match s.as_str() {
                "true" | "1" | "yes" => Ok(Bind::Int(1)),
                "false" | "0" | "no" => Ok(Bind::Int(0)),
                _ => Err(err(name, "must be true or false")),
            },
            _ => Err(err(name, "must be true or false")),
        },
        FieldKind::Date => {
            let s = as_string(value).ok_or_else(|| err(name, "must be a date"))?;
            let s = s.trim();
            // Accept a full timestamp and keep only the date part.
            let d = s.split('T').next().unwrap_or(s);
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| err(name, "must be a date in YYYY-MM-DD format"))?;
            Ok(Bind::Text(d.to_string()))
        }
        FieldKind::DateTime => {
            let s = as_string(value).ok_or_else(|| err(name, "must be a timestamp"))?;
            let parsed = chrono::DateTime::parse_from_rfc3339(s.trim())
                .map_err(|_| err(name, "must be an RFC3339 timestamp"))?;
            Ok(Bind::Text(
                parsed.with_timezone(&chrono::Utc).to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            ))
        }
        FieldKind::Select { options } => {
            let s = as_string(value).ok_or_else(|| err(name, "must be text"))?;
            if options.iter().any(|o| o.value == s) {
                Ok(Bind::Text(s))
            } else {
                let allowed: Vec<&str> = options.iter().map(|o| o.value).collect();
                Err(err(name, format!("must be one of: {}", allowed.join(", "))))
            }
        }
        FieldKind::Ref { .. } => {
            let s = as_string(value).ok_or_else(|| err(name, "must be a record id"))?;
            let s = s.trim().to_string();
            if !crate::common::ids::is_valid_id(&s) {
                return Err(err(name, "must be a valid record id"));
            }
            Ok(Bind::Text(s))
        }
        FieldKind::Json => Ok(Bind::Text(value.to_string())),
    }
}

fn as_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn is_email(s: &str) -> bool {
    let mut parts = s.split('@');
    let (local, domain) = match (parts.next(), parts.next(), parts.next()) {
        (Some(l), Some(d), None) => (l, d),
        _ => return false,
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains(' ')
        && s.len() <= 320
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::schema::{money as money_field, select, opt, text as text_field, date as date_field};

    #[test]
    fn money_parses_without_float_error() {
        assert_eq!(parse_scaled("0.1", 100, "f").unwrap(), 10);
        assert_eq!(parse_scaled("1234.56", 100, "f").unwrap(), 123_456);
        assert_eq!(parse_scaled("-8.05", 100, "f").unwrap(), -805);
        assert_eq!(parse_scaled("42", 100, "f").unwrap(), 4_200);
        assert_eq!(parse_scaled(".5", 100, "f").unwrap(), 50);
    }

    #[test]
    fn absurd_magnitudes_are_refused_rather_than_overflowing_a_total() {
        assert!(parse_scaled("99999999999999999", 100, "f").is_err());
        assert!(parse_scaled("-99999999999999999", 100, "f").is_err());
        // Something merely large is still fine.
        assert!(parse_scaled("1000000000", 100, "f").is_ok());
    }

    #[test]
    fn money_rejects_excess_precision_instead_of_truncating() {
        assert!(parse_scaled("1.005", 100, "f").is_err());
        assert!(parse_scaled("abc", 100, "f").is_err());
    }

    #[test]
    fn select_rejects_values_outside_its_options() {
        let f = select("status", "Status", vec![opt("open", "Open", "blue")]);
        assert!(to_bind(&f, &Value::String("open".into())).is_ok());
        assert!(to_bind(&f, &Value::String("nope".into())).is_err());
    }

    #[test]
    fn required_text_rejects_blank() {
        let f = text_field("name", "Name").required();
        assert!(to_bind(&f, &Value::String("  ".into())).is_err());
        assert!(to_bind(&f, &Value::Null).is_err());
    }

    #[test]
    fn optional_money_clears_on_empty_string() {
        let f = money_field("amount", "Amount");
        assert_eq!(to_bind(&f, &Value::String(String::new())).unwrap(), Bind::Null);
    }

    #[test]
    fn dates_normalise_to_iso() {
        let f = date_field("due", "Due");
        assert_eq!(
            to_bind(&f, &Value::String("2026-03-04T10:00:00Z".into())).unwrap(),
            Bind::Text("2026-03-04".into())
        );
        assert!(to_bind(&f, &Value::String("04/03/2026".into())).is_err());
    }
}
