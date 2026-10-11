//! Conversão de texto em número/data nos formatos brasileiro e internacional.
//! Mesmas regras de `@cityview/importer` (packages/importer/src/values.ts), com as
//! expressões regulares de lá escritas à mão.

use crate::spec::NumberLocale;

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `\d{1,3}(<sep>\d{3})+` — exige ao menos um separador.
fn grouped(s: &str, sep: char) -> bool {
    let mut parts = s.split(sep);
    let first = parts.next().unwrap_or("");
    if first.len() > 3 || !all_digits(first) {
        return false;
    }
    let mut groups = 0;
    for p in parts {
        if p.len() != 3 || !all_digits(p) {
            return false;
        }
        groups += 1;
    }
    groups > 0
}

/// `\d+(\.\d+)?([eE][+-]?\d+)?`
fn plain(s: &str) -> bool {
    let (mantissa, exp) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let mantissa_ok = match mantissa.split_once('.') {
        Some((i, f)) => all_digits(i) && all_digits(f),
        None => all_digits(mantissa),
    };
    let exp_ok = exp.is_none_or(|e| all_digits(e.strip_prefix(['+', '-']).unwrap_or(e)));
    mantissa_ok && exp_ok
}

/// `\d+,\d+`
fn decimal_comma(s: &str) -> bool {
    s.split_once(',').is_some_and(|(i, f)| all_digits(i) && all_digits(f))
}

/// `\d{1,3}(\.\d{3})+(,\d+)?`
fn thousands_dot_decimal_comma(s: &str) -> bool {
    match s.split_once(',') {
        Some((i, f)) => grouped(i, '.') && all_digits(f),
        None => grouped(s, '.'),
    }
}

/// `\d{1,3}(,\d{3})+(\.\d+)?`
fn thousands_comma_decimal_dot(s: &str) -> bool {
    match s.split_once('.') {
        Some((i, f)) => grouped(i, ',') && all_digits(f),
        None => grouped(s, ','),
    }
}

/// Converte texto em número. `None` quando não é número.
pub fn parse_number(raw: &str, locale: NumberLocale) -> Option<f64> {
    let cleaned: String = raw
        .trim()
        .trim_start_matches("R$")
        .trim_start_matches("r$")
        .trim_end_matches('%')
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| if c == '−' { '-' } else { c })
        .collect();
    let (negative, body) = match cleaned.as_bytes().first() {
        Some(b'-') => (true, &cleaned[1..]),
        Some(b'+') => (false, &cleaned[1..]),
        _ => (false, cleaned.as_str()),
    };
    if body.is_empty() {
        return None;
    }
    let normalized = if locale == NumberLocale::Br && thousands_dot_decimal_comma(body) {
        body.replace('.', "").replace(',', ".")
    } else if plain(body) {
        body.to_owned()
    } else if decimal_comma(body) {
        body.replace(',', ".")
    } else if thousands_dot_decimal_comma(body) {
        body.replace('.', "").replace(',', ".")
    } else if thousands_comma_decimal_dot(body) {
        body.replace(',', "")
    } else {
        return None;
    };
    let v: f64 = normalized.parse().ok()?;
    v.is_finite().then_some(if negative { -v } else { v })
}

/// "2024-03-01..." ou "01/03/2024" → "2024-03-01".
pub fn parse_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    let b = s.as_bytes();
    let d = |r: std::ops::Range<usize>| all_digits(&s[r]);
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-' && d(0..4) && d(5..7) && d(8..10) {
        return Some(s[..10].to_owned());
    }
    if b.len() >= 10 && b[2] == b'/' && b[5] == b'/' && d(0..2) && d(3..5) && d(6..10) {
        return Some(format!("{}-{}-{}", &s[6..10], &s[3..5], &s[..2]));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use NumberLocale::{Br, Intl};

    #[test]
    fn numbers_like_the_typescript_importer() {
        assert_eq!(parse_number("-23.5505", Intl), Some(-23.5505));
        assert_eq!(parse_number("-23,5505", Intl), Some(-23.5505));
        assert_eq!(parse_number("1.234,56", Intl), Some(1234.56));
        assert_eq!(parse_number("1,234.56", Intl), Some(1234.56));
        assert_eq!(parse_number("R$ 1.500", Br), Some(1500.0));
        assert_eq!(parse_number("1.500", Intl), Some(1.5));
        assert_eq!(parse_number("-34.882", Intl), Some(-34.882));
        assert_eq!(parse_number("15%", Intl), Some(15.0));
        assert_eq!(parse_number("1e3", Intl), Some(1000.0));
        assert_eq!(parse_number("86.254,34", Br), Some(86254.34));
        assert_eq!(parse_number("", Intl), None);
        assert_eq!(parse_number("N/D", Intl), None);
        assert_eq!(parse_number("1,2,3", Intl), None);
        assert_eq!(parse_number("12/05/2024", Intl), None);
    }

    #[test]
    fn dates() {
        assert_eq!(parse_date("2024-03-01").as_deref(), Some("2024-03-01"));
        assert_eq!(parse_date("01/03/2024").as_deref(), Some("2024-03-01"));
        assert_eq!(parse_date("março"), None);
    }
}
