//! Dates, moments, money and numbers as the web's `Intl` writes them in en-GB
//! and nl-NL (apps/mail-web/src/lib/dates.ts, `formatMoment` in lib/later.ts,
//! `formatMoney` in lib/invoices.ts).

use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveDateTime, Utc};

use crate::i18n::{lang, t, Lang};

/// Time for today, a short date otherwise, with the year only when it isn't
/// this one (`shortDate`).
pub fn short_date(at: DateTime<Utc>) -> String {
    let at = at.with_timezone(&Local);
    let now = Local::now();
    if at.date_naive() == now.date_naive() {
        at.format("%H:%M").to_string()
    } else {
        day_month(at.date_naive(), at.year() != now.year())
    }
}

/// "12 Nov", "12 nov 2025".
pub fn day_month(date: NaiveDate, with_year: bool) -> String {
    let pattern = if with_year { "%-d %b %Y" } else { "%-d %b" };
    date.format_localized(pattern, lang().locale()).to_string().replace('.', "")
}

/// "Friday 13 November", for the empty pane and a typed moment.
pub fn long_day(date: NaiveDate) -> String {
    capitalize(&date.format_localized("%A %-d %B", lang().locale()).to_string())
}

/// "Fri", "vr": a day within the week.
pub fn short_weekday(date: NaiveDate) -> String {
    date.format_localized("%a", lang().locale()).to_string().replace('.', "")
}

/// The first letter in capitals (the web's `first-letter:uppercase`).
pub fn capitalize(text: &str) -> String {
    let mut letters = text.chars();
    match letters.next() {
        Some(first) => first.to_uppercase().chain(letters).collect(),
        None => String::new(),
    }
}

/// "tomorrow 08:00", "Friday 10:00", "12 Dec 08:00": short, for toasts and
/// lines (`formatMoment`). Local time.
pub fn moment(at: NaiveDateTime, now: NaiveDateTime) -> String {
    let time = at.format("%H:%M");
    let days = (at.date() - now.date()).num_days();
    match days {
        0 => format!("{} {time}", t("today", "vandaag")),
        1 => format!("{} {time}", t("tomorrow", "morgen")),
        2..=6 => format!("{} {time}", at.date().format_localized("%A", lang().locale())),
        _ => format!("{} {time}", day_month(at.date(), false)),
    }
}

/// [`moment`] of an API time.
pub fn moment_of(at: DateTime<Utc>) -> String {
    moment(at.with_timezone(&Local).naive_local(), Local::now().naive_local())
}

/// "1,234" in English, "1.234" in Dutch (`toLocaleString`).
pub fn number(value: u64) -> String {
    let digits = value.to_string();
    let separator = match lang() {
        Lang::En => ',',
        Lang::Nl => '.',
    };
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(separator);
        }
        out.push(digit);
    }
    out
}

/// "€121.00" in English, "€ 121,00" in Dutch, in the invoice's currency.
/// `round` drops the cents, for sums (`formatMoney`).
pub fn money(cents: i64, currency: Option<&str>, round: bool) -> String {
    let currency = currency.unwrap_or("EUR");
    let symbol = match currency {
        "EUR" => "€",
        "USD" => "$",
        "GBP" => "£",
        other => other,
    };
    let negative = cents < 0;
    let cents = cents.unsigned_abs();
    let (whole, fraction) = if round { ((cents + 50) / 100, None) } else { (cents / 100, Some(cents % 100)) };
    let mut amount = number(whole);
    if let Some(fraction) = fraction {
        amount.push(match lang() {
            Lang::En => '.',
            Lang::Nl => ',',
        });
        amount.push_str(&format!("{fraction:02}"));
    }
    // A code instead of a symbol keeps a space before the amount in both languages.
    let gap = if symbol.len() > 1 && symbol.chars().all(|c| c.is_ascii_alphabetic()) {
        "\u{a0}"
    } else {
        match lang() {
            Lang::En => "",
            Lang::Nl => "\u{a0}",
        }
    };
    format!("{}{symbol}{gap}{amount}", if negative { "-" } else { "" })
}

/// "20 Nov" for a due date written as yyyy-mm-dd, read as a calendar day.
pub fn due_label(date: &str) -> String {
    match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(date) => day_month(date, false),
        Err(_) => date.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::{capitalize, number};

    #[test]
    fn numbers_and_capitals() {
        // Either language: three digits a group.
        let grouped = number(1234567);
        assert!(grouped == "1,234,567" || grouped == "1.234.567");
        assert_eq!(number(999), "999");
        assert_eq!(capitalize("vrijdag 13 november"), "Vrijdag 13 november");
    }
}
