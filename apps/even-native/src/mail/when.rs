//! "morgen 10 uur", "over 2 weken", "next friday 9am": a moment in plain words,
//! in Dutch or English, read in the reader's own time zone
//! (packages/mail-core/src/when.ts), and the moments people pick most
//! (`quickPicks` in components/when-picker.tsx). For snoozing and sending
//! later, so always in the future.

use std::sync::OnceLock;

use chrono::{Datelike, Duration, Months, NaiveDate, NaiveDateTime, NaiveTime, Timelike};
use regex::Regex;

use crate::i18n::t;

/// A day without a time starts here: the start of a working day.
const DEFAULT_HOUR: u32 = 8;

fn number_of(word: &str) -> Option<i64> {
    if !word.is_empty() && word.chars().all(|c| c.is_ascii_digit()) {
        return word.parse().ok();
    }
    Some(match word {
        "een" | "één" | "a" | "an" | "one" => 1,
        "twee" | "two" => 2,
        "drie" | "three" => 3,
        "vier" | "four" => 4,
        "vijf" | "five" => 5,
        "zes" | "six" => 6,
        "zeven" | "seven" => 7,
        "acht" | "eight" => 8,
        "negen" | "nine" => 9,
        "tien" | "ten" => 10,
        "elf" | "eleven" => 11,
        "twaalf" | "twelve" => 12,
        _ => return None,
    })
}

/// In the order the web tries them; Sunday is 0, as in JavaScript.
const WEEKDAYS: [(&str, u32); 30] = [
    ("zondag", 0), ("zo", 0), ("sunday", 0), ("sun", 0),
    ("maandag", 1), ("ma", 1), ("monday", 1), ("mon", 1),
    ("dinsdag", 2), ("di", 2), ("tuesday", 2), ("tue", 2), ("tues", 2),
    ("woensdag", 3), ("wo", 3), ("wednesday", 3), ("wed", 3),
    ("donderdag", 4), ("do", 4), ("thursday", 4), ("thu", 4), ("thurs", 4),
    ("vrijdag", 5), ("vr", 5), ("friday", 5), ("fri", 5),
    ("zaterdag", 6), ("za", 6), ("saturday", 6), ("sat", 6),
];

fn month_of(word: &str) -> Option<u32> {
    Some(match word {
        "januari" | "jan" | "january" => 0,
        "februari" | "feb" | "february" => 1,
        "maart" | "mrt" | "march" | "mar" => 2,
        "april" | "apr" => 3,
        "mei" | "may" => 4,
        "juni" | "jun" | "june" => 5,
        "juli" | "jul" | "july" => 6,
        "augustus" | "aug" | "august" => 7,
        "september" | "sep" | "sept" => 8,
        "oktober" | "okt" | "october" | "oct" => 9,
        "november" | "nov" => 10,
        "december" | "dec" => 11,
        _ => return None,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Unit {
    Minute,
    Hour,
    Day,
    Week,
    Month,
}

fn unit_of(word: &str) -> Option<Unit> {
    Some(match word {
        "m" | "min" | "mins" | "minuut" | "minuten" | "minute" | "minutes" => Unit::Minute,
        "u" | "h" | "uur" | "uren" | "hour" | "hours" | "hr" | "hrs" => Unit::Hour,
        "d" | "dag" | "dagen" | "day" | "days" => Unit::Day,
        "w" | "wk" | "week" | "weken" | "weeks" => Unit::Week,
        "maand" | "maanden" | "month" | "months" | "mnd" => Unit::Month,
        _ => return None,
    })
}

/// A pattern compiled once.
macro_rules! re {
    ($pattern:expr) => {{
        static RE: OnceLock<Regex> = OnceLock::new();
        RE.get_or_init(|| Regex::new($pattern).expect("a valid pattern"))
    }};
}

fn weekday(date: NaiveDate) -> u32 {
    date.weekday().num_days_from_sunday()
}

fn at_day(base: NaiveDate, days: i64) -> NaiveDate {
    base + Duration::days(days)
}

/// The next given weekday after today (a week ahead when it is that day now).
fn next_weekday(now: NaiveDate, day: u32) -> NaiveDate {
    let ahead = (day + 7 - weekday(now)) % 7;
    at_day(now, if ahead == 0 { 7 } else { ahead as i64 })
}

/// A clock time in the words: "10:30", "10 uur", "om 9", "half 3", "kwart over
/// 4", "9am", "15u". Bare hours before 7 mean the afternoon, as people say
/// them. Hours may come out below 0 or above 23; the caller turns those away.
fn time_in(text: &str) -> Option<((i64, u32), String)> {
    let take = |whole: &str, time: (i64, u32)| Some((time, text.replacen(whole, " ", 1)));
    let pm = |hour: i64, suffix: Option<&str>| match suffix {
        Some("pm") if hour < 12 => hour + 12,
        Some("am") if hour == 12 => 0,
        _ => hour,
    };
    let evening = re!(r"'?s ?avonds|in the evening|tonight|vanavond").is_match(text);
    let afternoon = re!(r"'?s ?middags|in the afternoon|vanmiddag").is_match(text);
    let day_part = |hour: i64| if (evening || afternoon) && hour < 12 { hour + 12 } else { hour };
    let explicit_part = re!(
        r"'?s ?(avonds|middags|ochtends|morgens)|in the (morning|afternoon|evening)|tonight|vanavond|vanmiddag|vanochtend"
    )
    .is_match(text);
    // Without am/pm or a part of the day, 1 to 6 o'clock is in the afternoon.
    let guess = |hour: i64, explicit: bool| if !explicit && (1..=6).contains(&hour) { hour + 12 } else { hour };
    let number = |value: &str| value.parse::<i64>().unwrap_or(99);

    if let Some(found) = re!(r"\bkwart (over|voor) (\d{1,2})\b").captures(text) {
        let hour = guess(day_part(number(&found[2])), explicit_part);
        let time = if &found[1] == "over" { (hour, 15) } else { (hour - 1, 45) };
        return take(&found[0], time);
    }
    if let Some(found) = re!(r"\bhalf (\d{1,2})\b").captures(text) {
        return take(&found[0], (guess(day_part(number(&found[1]) - 1), explicit_part), 30));
    }
    if let Some(found) = re!(r"\b(?:om |at |@ ?)?(\d{1,2})[:.](\d{2})\s*(am|pm)?\b").captures(text) {
        let hour = pm(day_part(number(&found[1])), found.get(3).map(|m| m.as_str()));
        return take(&found[0], (hour, number(&found[2]) as u32));
    }
    if let Some(found) = re!(r"\b(?:om |at |@ ?)?(\d{1,2})\s*(am|pm|uur|u|h|o'clock)\b").captures(text) {
        let suffix = &found[2];
        let explicit = suffix == "am" || suffix == "pm" || explicit_part;
        return take(&found[0], (guess(pm(day_part(number(&found[1])), Some(suffix)), explicit), 0));
    }
    if let Some(found) = re!(r"\b(?:om|at) (\d{1,2})\b").captures(text) {
        return take(&found[0], (guess(day_part(number(&found[1])), explicit_part), 0));
    }
    if re!(r"\b(noon|middag|12 uur 's middags)\b").is_match(text) && !re!(r"\bvanmiddag|morgenmiddag\b").is_match(text) {
        return Some(((12, 0), re!(r"\b(noon|middag)\b").replace(text, " ").into_owned()));
    }
    None
}

/// The day the words name, or none when they name none.
fn day_in(text: &str, now: NaiveDateTime) -> Option<NaiveDate> {
    let today = now.date();
    if re!(r"\bovermorgen\b|\bday after tomorrow\b").is_match(text) {
        return Some(at_day(today, 2));
    }
    if re!(r"\bmorgen|tomorrow\b").is_match(text) {
        return Some(at_day(today, 1));
    }
    if re!(r"\bvandaag|today|vanavond|vanmiddag|vanochtend|tonight\b").is_match(text) {
        return Some(today);
    }
    if re!(r"\b(dit |this |het |the )?weekend\b").is_match(text) {
        return Some(if weekday(today) == 6 { at_day(today, 7) } else { next_weekday(today, 6) });
    }
    let next_week = re!(r"\b(volgende week|next week)\b").is_match(text);
    if next_week
        && !re!(r"\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b")
            .is_match(text)
    {
        return Some(next_weekday(today, 1));
    }

    for (name, day) in WEEKDAYS {
        // The short ones are also plain words ("do", "ma"): only after "next" or "on", or up front.
        if name.len() <= 3 {
            let after = Regex::new(&format!(r"\b(volgende|next|op|on) {name}\b")).ok()?;
            let first = Regex::new(&format!(r"^{name}\b")).ok()?;
            if !after.is_match(text) && !first.is_match(text.trim()) {
                continue;
            }
        }
        if Regex::new(&format!(r"\b{name}\b")).ok()?.is_match(text) {
            // "volgende week vrijdag": the Friday of next week, not the coming one.
            if next_week {
                return Some(at_day(next_weekday(today, 1), ((day + 6) % 7) as i64));
            }
            return Some(next_weekday(today, day));
        }
    }

    // "12 november", "12 nov 2027", "november 12", "12-11", "12/11/2027".
    let number = |value: &str| value.parse::<u32>().unwrap_or(0);
    let year_of = |found: Option<regex::Match>| found.and_then(|year| year.as_str().parse::<i32>().ok());
    let mut named: Option<(u32, u32, Option<i32>)> = None;
    if let Some(found) = re!(r"\b(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?\b").captures(text) {
        if let Some(month) = month_of(&found[2]) {
            named = Some((number(&found[1]), month, year_of(found.get(3))));
        }
    }
    if named.is_none() {
        if let Some(found) = re!(r"\b([a-z]+) (\d{1,2})(?:,? (\d{4}))?\b").captures(text) {
            if let Some(month) = month_of(&found[1]) {
                named = Some((number(&found[2]), month, year_of(found.get(3))));
            }
        }
    }
    if named.is_none() {
        if let Some(found) = re!(r"\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b").captures(text) {
            let year = found.get(3).and_then(|year| {
                let year = year.as_str();
                if year.len() == 2 { format!("20{year}") } else { year.to_string() }.parse::<i32>().ok()
            });
            named = Some((number(&found[1]), number(&found[2]).wrapping_sub(1), year));
        }
    }
    let (day, month, year) = named?;
    if month > 11 || !(1..=31).contains(&day) {
        return None;
    }
    let date = NaiveDate::from_ymd_opt(year.unwrap_or(today.year()), month + 1, day)?;
    // Without a year, a date already past this year means next year's.
    if year.is_none() && at_day(date, 1).and_time(NaiveTime::MIN) <= now {
        return date.with_year(date.year() + 1);
    }
    Some(date)
}

/// Parts of the day without a clock time: "morgenavond", "this afternoon".
fn day_part_hour(text: &str) -> Option<u32> {
    if re!(r"avond|evening|tonight").is_match(text) {
        Some(20)
    } else if re!(r"middag|afternoon").is_match(text) {
        Some(14)
    } else if re!(r"ochtend|morgens|morning").is_match(text) {
        Some(8)
    } else {
        None
    }
}

/// The moment the words name (local time), or none when they don't name one
/// or name one that has passed. A time alone that has passed today means
/// tomorrow.
pub fn parse_when(input: &str, now: NaiveDateTime) -> Option<NaiveDateTime> {
    let lowered = input.to_lowercase().replace([',', '!', '?'], " ");
    let text = lowered.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }

    // "over 2 weken", "in 3 days", "2 uur", "30 min".
    if let Some(found) = re!(r"^(over |in |na |within )?(\S+) ([a-z]+)(?: (?:from now|later|vanaf nu))?$").captures(&text) {
        let amount = number_of(&found[2]);
        let unit = unit_of(&found[3]);
        // "17 uur" is a time of day; only "over 17 uur" counts from now.
        let counts = found.get(1).is_some() || unit.is_some_and(|unit| unit != Unit::Hour);
        if let (Some(amount), Some(unit), true) = (amount.filter(|amount| *amount > 0), unit, counts) {
            let morning = NaiveTime::from_hms_opt(DEFAULT_HOUR, 0, 0)?;
            return match unit {
                Unit::Minute => now.checked_add_signed(Duration::minutes(amount)),
                Unit::Hour => now.checked_add_signed(Duration::hours(amount)),
                Unit::Day => Some(at_day(now.date(), amount).and_time(morning)),
                Unit::Week => Some(at_day(now.date(), amount * 7).and_time(morning)),
                Unit::Month => Some(now.date().checked_add_months(Months::new(amount as u32))?.and_time(morning)),
            };
        }
    }

    let found = time_in(&text);
    let day = day_in(found.as_ref().map_or(text.as_str(), |(_, rest)| rest.as_str()), now);
    if found.is_none() && day.is_none() {
        return None;
    }
    let (hour, minute) = match &found {
        Some(((hour, minute), _)) => (*hour, *minute),
        None => (day_part_hour(&text).unwrap_or(DEFAULT_HOUR) as i64, 0),
    };
    if !(0..=23).contains(&hour) || minute > 59 {
        return None;
    }
    let time = NaiveTime::from_hms_opt(hour as u32, minute, 0)?;
    let date = day.unwrap_or(now.date()).and_time(time);
    if date <= now {
        // A time alone that has passed today is meant for tomorrow; a named day that has passed isn't valid.
        if day.is_some() {
            return None;
        }
        return Some(date + Duration::days(1));
    }
    Some(date)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    Snooze,
    /// For the composer's Send later, in a later pass.
    #[allow(dead_code)]
    Send,
}

/// One of the usual moments: its sign, name and real day and time.
#[derive(Clone, Debug)]
pub struct Pick {
    pub icon: &'static str,
    pub label: &'static str,
    pub at: NaiveDateTime,
}

/// Moments people pick most, worked out from now so each shows its real day and time.
pub fn quick_picks(purpose: Purpose, now: NaiveDateTime) -> Vec<Pick> {
    let at = |days: i64, hour: u32| at_day(now.date(), days).and_hms_opt(hour, 0, 0).unwrap_or(now);
    let today = weekday(now.date());
    let days_until = |day: u32| {
        let ahead = (day + 7 - today) % 7;
        if ahead == 0 { 7 } else { ahead as i64 }
    };
    let mut picks = Vec::new();
    match purpose {
        Purpose::Snooze => {
            if now.hour() + 3 <= 21 {
                picks.push(Pick {
                    icon: "coffee-02",
                    label: t("Later today", "Later vandaag"),
                    at: at(0, now.hour() + 3),
                });
            }
            if now.hour() < 19 {
                picks.push(Pick { icon: "moon-02", label: t("Tonight", "Vanavond"), at: at(0, 20) });
            }
            picks.push(Pick { icon: "sunrise", label: t("Tomorrow", "Morgen"), at: at(1, 8) });
            let weekend = if today == 6 { 7 } else { days_until(6) };
            picks.push(Pick { icon: "sun-03", label: t("This weekend", "Dit weekend"), at: at(weekend, 9) });
            picks.push(Pick {
                icon: "calendar-add-01",
                label: t("Next week", "Volgende week"),
                at: at(days_until(1), 8),
            });
        }
        Purpose::Send => {
            picks.push(Pick { icon: "sunrise", label: t("Tomorrow morning", "Morgenochtend"), at: at(1, 8) });
            picks.push(Pick { icon: "sun-03", label: t("Tomorrow afternoon", "Morgenmiddag"), at: at(1, 13) });
            picks.push(Pick {
                icon: "calendar-add-01",
                label: t("Monday morning", "Maandagochtend"),
                at: at(days_until(1), 8),
            });
        }
    }
    picks
}

#[cfg(test)]
mod tests {
    use super::{parse_when, quick_picks, Purpose};
    use chrono::{NaiveDate, NaiveDateTime};

    fn at(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(year, month, day).unwrap().and_hms_opt(hour, minute, 0).unwrap()
    }

    /// Friday 13 November 2026, 13:30.
    fn now() -> NaiveDateTime {
        at(2026, 11, 13, 13, 30)
    }

    fn when(text: &str) -> Option<NaiveDateTime> {
        parse_when(text, now())
    }

    #[test]
    fn reads_moments_counted_from_now() {
        assert_eq!(when("over 2 weken"), Some(at(2026, 11, 27, 8, 0)));
        assert_eq!(when("in 3 days"), Some(at(2026, 11, 16, 8, 0)));
        assert_eq!(when("over een uur"), Some(at(2026, 11, 13, 14, 30)));
        assert_eq!(when("30 min"), Some(at(2026, 11, 13, 14, 0)));
        assert_eq!(when("in an hour"), Some(at(2026, 11, 13, 14, 30)));
        // A bare "17 uur" is a time of day.
        assert_eq!(when("17 uur"), Some(at(2026, 11, 13, 17, 0)));
    }

    #[test]
    fn reads_days_and_times() {
        assert_eq!(when("morgen 10 uur"), Some(at(2026, 11, 14, 10, 0)));
        assert_eq!(when("Tomorrow 10am"), Some(at(2026, 11, 14, 10, 0)));
        assert_eq!(when("next friday 9am"), Some(at(2026, 11, 20, 9, 0)));
        // A bare number is no time, as on the web: the day at its start.
        assert_eq!(when("vrijdag 9"), Some(at(2026, 11, 20, 8, 0)));
        assert_eq!(when("vrijdag om 9"), Some(at(2026, 11, 20, 9, 0)));
        assert_eq!(when("maandag"), Some(at(2026, 11, 16, 8, 0)));
        assert_eq!(when("volgende week vrijdag"), Some(at(2026, 11, 20, 8, 0)));
        assert_eq!(when("half 3"), Some(at(2026, 11, 13, 14, 30)));
        assert_eq!(when("kwart voor 4"), Some(at(2026, 11, 13, 15, 45)));
        assert_eq!(when("morgenavond"), Some(at(2026, 11, 14, 20, 0)));
        assert_eq!(when("12 december"), Some(at(2026, 12, 12, 8, 0)));
        assert_eq!(when("3 jan"), Some(at(2027, 1, 3, 8, 0)));
        assert_eq!(when("24-12 15:00"), Some(at(2026, 12, 24, 15, 0)));
        // A time alone that has passed is meant for tomorrow; a passed day isn't a moment.
        assert_eq!(when("9:00"), Some(at(2026, 11, 14, 9, 0)));
        assert_eq!(when("vandaag 9:00"), None);
        assert_eq!(when("iets heel anders"), None);
        assert_eq!(when(""), None);
    }

    #[test]
    fn the_usual_moments_follow_the_clock() {
        let picks = quick_picks(Purpose::Snooze, now());
        let moments: Vec<NaiveDateTime> = picks.iter().map(|pick| pick.at).collect();
        assert_eq!(
            moments,
            [
                at(2026, 11, 13, 16, 0),
                at(2026, 11, 13, 20, 0),
                at(2026, 11, 14, 8, 0),
                at(2026, 11, 14, 9, 0),
                at(2026, 11, 16, 8, 0),
            ]
        );
        // Late in the evening only the days ahead remain.
        assert_eq!(quick_picks(Purpose::Snooze, at(2026, 11, 13, 22, 0)).len(), 3);
        assert_eq!(quick_picks(Purpose::Send, now()).len(), 3);
    }
}
