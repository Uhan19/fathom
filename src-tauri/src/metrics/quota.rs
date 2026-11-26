use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const RECORD_FLAG: &str = "--quota-record";
pub const FILE: &str = "quota.json";
pub const STALE_AFTER_MS: i64 = 60 * 60 * 1000;
const MAX_INPUT_BYTES: u64 = 1 << 20;
const KEEP_MS: i64 = 2 * 60 * 60 * 1000;
const SPACING_MS: i64 = 60 * 1000;
const PACE_WINDOW_MS: i64 = 30 * 60 * 1000;
const MIN_PACE_SPAN_MS: i64 = 5 * 60 * 1000;
const SAME_RESET_SLACK_S: i64 = 60;
const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;
const FULL: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Reading {
    pub used_percentage: f64,
    pub resets_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    pub at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub five_hour: Option<Reading>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seven_day: Option<Reading>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct History {
    snapshots: Vec<Snapshot>,
}

#[derive(Deserialize)]
struct StatusLine {
    rate_limits: Option<RateLimits>,
}

#[derive(Deserialize)]
struct RateLimits {
    five_hour: Option<serde_json::Value>,
    seven_day: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub used_percent: f64,
    pub resets_at_ms: i64,
    pub percent_per_hour: Option<f64>,
    pub runs_out_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReport {
    pub taken_at_ms: i64,
    pub available: bool,
    pub last_seen_ms: Option<i64>,
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
    pub record_line: String,
}

pub fn run_record(dir: Result<std::path::PathBuf, String>, now_ms: i64) -> i32 {
    let mut input = Vec::new();
    let read = std::io::stdin()
        .take(MAX_INPUT_BYTES)
        .read_to_end(&mut input);
    if let (Ok(dir), Ok(_)) = (dir, read) {
        let _ = record(&dir, &input, now_ms);
    }
    0
}

pub fn record(dir: &Path, status_line: &[u8], now_ms: i64) -> Result<bool, String> {
    let Some(snapshot) = snapshot_of(status_line, now_ms) else {
        return Ok(false);
    };
    let path = dir.join(FILE);
    let mut history = load(&path);
    add(&mut history.snapshots, snapshot);
    write_atomically(dir, &path, &history)?;
    Ok(true)
}

pub fn read(dir: &Path, now_ms: i64) -> QuotaReport {
    report(&load(&dir.join(FILE)).snapshots, now_ms)
}

fn snapshot_of(status_line: &[u8], now_ms: i64) -> Option<Snapshot> {
    let limits = serde_json::from_slice::<StatusLine>(status_line)
        .ok()?
        .rate_limits?;
    let five_hour = limits.five_hour.and_then(reading);
    let seven_day = limits.seven_day.and_then(reading);
    (five_hour.is_some() || seven_day.is_some()).then_some(Snapshot {
        at_ms: now_ms,
        five_hour,
        seven_day,
    })
}

fn reading(value: serde_json::Value) -> Option<Reading> {
    let reading: Reading = serde_json::from_value(value).ok()?;
    (reading.used_percentage.is_finite() && reading.used_percentage >= 0.0 && reading.resets_at > 0)
        .then_some(reading)
}

fn add(snapshots: &mut Vec<Snapshot>, snapshot: Snapshot) {
    let now = snapshot.at_ms;
    snapshots.retain(|kept| kept.at_ms <= now && now - kept.at_ms <= KEEP_MS);
    let len = snapshots.len();
    let previous_kept = len.checked_sub(2).map(|index| snapshots[index].at_ms);
    if previous_kept.is_some_and(|at| now - at < SPACING_MS) {
        snapshots[len - 1] = snapshot;
    } else {
        snapshots.push(snapshot);
    }
}

fn load(path: &Path) -> History {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_atomically(dir: &Path, path: &Path, history: &History) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let temp = dir.join(format!(".{FILE}.{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec(history).map_err(|e| e.to_string())?;
    std::fs::write(&temp, bytes)
        .and_then(|()| std::fs::rename(&temp, path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&temp);
            e.to_string()
        })
}

pub fn report(snapshots: &[Snapshot], now_ms: i64) -> QuotaReport {
    let latest = snapshots.iter().max_by_key(|s| s.at_ms);
    let last_seen_ms = latest.map(|s| s.at_ms);
    let fresh = latest.filter(|s| now_ms - s.at_ms <= STALE_AFTER_MS);
    let window_of = |pick: fn(&Snapshot) -> Option<Reading>| {
        fresh.and_then(|latest| window(snapshots, latest, pick, now_ms))
    };
    let five_hour = window_of(|s| s.five_hour);
    let seven_day = window_of(|s| s.seven_day);
    QuotaReport {
        taken_at_ms: now_ms,
        available: five_hour.is_some() || seven_day.is_some(),
        last_seen_ms,
        five_hour,
        seven_day,
        record_line: String::new(),
    }
}

pub fn record_line(program: &str) -> String {
    format!(
        "echo \"$input\" | {} {RECORD_FLAG} &",
        crate::launch::shell_quote(program)
    )
}

fn window(
    snapshots: &[Snapshot],
    latest: &Snapshot,
    pick: fn(&Snapshot) -> Option<Reading>,
    now_ms: i64,
) -> Option<Window> {
    let current = pick(latest)?;
    let resets_at_ms = current.resets_at * 1000;
    if resets_at_ms <= now_ms {
        return None;
    }
    let used_percent = current.used_percentage.min(FULL);
    let percent_per_hour = pace(snapshots, latest, current, pick);
    let runs_out_at_ms = percent_per_hour.and_then(|per_hour| {
        let at = if used_percent >= FULL {
            latest.at_ms
        } else if per_hour > 0.0 {
            latest.at_ms + ((FULL - used_percent) / per_hour * HOUR_MS) as i64
        } else {
            return None;
        };
        (at < resets_at_ms).then_some(at)
    });
    Some(Window {
        used_percent,
        resets_at_ms,
        percent_per_hour,
        runs_out_at_ms,
    })
}

fn pace(
    snapshots: &[Snapshot],
    latest: &Snapshot,
    current: Reading,
    pick: fn(&Snapshot) -> Option<Reading>,
) -> Option<f64> {
    let (start_ms, start) = snapshots
        .iter()
        .filter(|s| s.at_ms < latest.at_ms && latest.at_ms - s.at_ms <= PACE_WINDOW_MS)
        .filter_map(|s| pick(s).map(|reading| (s.at_ms, reading)))
        .filter(|(_, reading)| (reading.resets_at - current.resets_at).abs() <= SAME_RESET_SLACK_S)
        .min_by_key(|(at, _)| *at)?;
    let span_ms = latest.at_ms - start_ms;
    if span_ms < MIN_PACE_SPAN_MS {
        return None;
    }
    let rise = (current.used_percentage - start.used_percentage).max(0.0);
    Some(rise / (span_ms as f64 / HOUR_MS))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 60 * 1000;
    const NOW: i64 = 1_900_000_000_000;
    const FIVE_HOUR_RESET: i64 = NOW / 1000 + 2 * 60 * 60;
    const WEEK_RESET: i64 = NOW / 1000 + 4 * 24 * 60 * 60;

    fn status_line(five: f64, week: f64) -> Vec<u8> {
        serde_json::json!({
            "model": { "id": "claude-test-1", "display_name": "Test" },
            "workspace": { "current_dir": "/home/sailor/harbor" },
            "rate_limits": {
                "five_hour": { "used_percentage": five, "resets_at": FIVE_HOUR_RESET },
                "seven_day": { "used_percentage": week, "resets_at": WEEK_RESET },
            }
        })
        .to_string()
        .into_bytes()
    }

    fn snap(at_ms: i64, five: Option<f64>, week: Option<f64>) -> Snapshot {
        Snapshot {
            at_ms,
            five_hour: five.map(|used| Reading {
                used_percentage: used,
                resets_at: FIVE_HOUR_RESET,
            }),
            seven_day: week.map(|used| Reading {
                used_percentage: used,
                resets_at: WEEK_RESET,
            }),
        }
    }

    #[test]
    fn the_recorder_keeps_only_the_limits_and_the_time() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(record(dir.path(), &status_line(12.5, 40.0), NOW), Ok(true));
        let saved = std::fs::read_to_string(dir.path().join(FILE)).unwrap();
        assert!(!saved.contains("harbor") && !saved.contains("claude-test-1"));
        assert_eq!(
            load(&dir.path().join(FILE)).snapshots,
            vec![snap(NOW, Some(12.5), Some(40.0))]
        );
        let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    #[test]
    fn the_recorder_ignores_input_without_plan_limits() {
        let dir = tempfile::tempdir().unwrap();
        let api_key_session = br#"{"model":{"id":"claude-test-1"},"cost":{"total_cost_usd":0.1}}"#;
        for input in [
            &api_key_session[..],
            b"",
            b"not json",
            br#"{"rate_limits":{}}"#,
        ] {
            assert_eq!(record(dir.path(), input, NOW), Ok(false));
        }
        let bad = br#"{"rate_limits":{"five_hour":{"used_percentage":"x","resets_at":1},"seven_day":{"used_percentage":5,"resets_at":0}}}"#;
        assert_eq!(record(dir.path(), bad, NOW), Ok(false));
        assert!(!dir.path().join(FILE).exists());
    }

    #[test]
    fn the_recorder_keeps_one_snapshot_a_minute_for_two_hours() {
        let dir = tempfile::tempdir().unwrap();
        let mut at = NOW - 3 * 60 * MINUTE;
        while at <= NOW {
            record(dir.path(), &status_line(10.0, 20.0), at).unwrap();
            at += 10 * 1000;
        }
        let kept = load(&dir.path().join(FILE)).snapshots;
        assert_eq!(kept.last().unwrap().at_ms, NOW);
        assert!(kept.first().unwrap().at_ms >= NOW - KEEP_MS);
        assert!((115..=150).contains(&kept.len()), "{}", kept.len());
        assert!(kept.windows(2).all(|pair| pair[1].at_ms > pair[0].at_ms));
    }

    #[test]
    fn a_broken_history_file_starts_over_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), "{ half").unwrap();
        assert_eq!(record(dir.path(), &status_line(1.0, 2.0), NOW), Ok(true));
        assert_eq!(load(&dir.path().join(FILE)).snapshots.len(), 1);
    }

    #[test]
    fn the_report_gives_percent_reset_and_pace_over_the_last_half_hour() {
        let snapshots = vec![
            snap(NOW - 45 * MINUTE, Some(10.0), Some(47.0)),
            snap(NOW - 30 * MINUTE, Some(50.0), Some(47.0)),
            snap(NOW - 10 * MINUTE, Some(58.0), Some(47.05)),
            snap(NOW - MINUTE, Some(62.0), Some(47.1)),
        ];
        let report = report(&snapshots, NOW);
        assert!(report.available);
        assert_eq!(report.last_seen_ms, Some(NOW - MINUTE));
        let five = report.five_hour.unwrap();
        assert_eq!(five.used_percent, 62.0);
        assert_eq!(five.resets_at_ms, FIVE_HOUR_RESET * 1000);
        let per_hour = five.percent_per_hour.unwrap();
        assert!((per_hour - 12.0 / (29.0 / 60.0)).abs() < 1e-9);
        let expected = NOW - MINUTE + (38.0 / per_hour * HOUR_MS) as i64;
        assert_eq!(five.runs_out_at_ms, Some(expected));
        let week = report.seven_day.unwrap();
        assert!(week.percent_per_hour.unwrap() > 0.0);
        assert_eq!(week.runs_out_at_ms, None);
    }

    #[test]
    fn pace_needs_five_minutes_of_the_same_window() {
        let short = vec![
            snap(NOW - 3 * MINUTE, Some(10.0), None),
            snap(NOW, Some(11.0), None),
        ];
        assert_eq!(
            report(&short, NOW).five_hour.unwrap().percent_per_hour,
            None
        );
        let mut before_reset = snap(NOW - 20 * MINUTE, Some(90.0), None);
        before_reset.five_hour.as_mut().unwrap().resets_at = FIVE_HOUR_RESET - 5 * 60 * 60;
        let after = vec![before_reset, snap(NOW, Some(4.0), None)];
        let five = report(&after, NOW).five_hour.unwrap();
        assert_eq!(five.percent_per_hour, None);
        assert_eq!(five.runs_out_at_ms, None);
        let idle = vec![
            snap(NOW - 20 * MINUTE, Some(30.0), None),
            snap(NOW, Some(30.0), None),
        ];
        let five = report(&idle, NOW).five_hour.unwrap();
        assert_eq!(five.percent_per_hour, Some(0.0));
        assert_eq!(five.runs_out_at_ms, None);
    }

    #[test]
    fn a_window_at_its_limit_has_run_out_already() {
        let full = vec![
            snap(NOW - 10 * MINUTE, Some(96.0), None),
            snap(NOW, Some(100.4), None),
        ];
        let five = report(&full, NOW).five_hour.unwrap();
        assert_eq!(five.used_percent, 100.0);
        assert_eq!(five.runs_out_at_ms, Some(NOW));
    }

    #[test]
    fn quota_is_unavailable_with_no_data_old_data_or_only_passed_resets() {
        let empty = report(&[], NOW);
        assert!(!empty.available);
        assert_eq!(empty.last_seen_ms, None);

        let old = vec![snap(NOW - STALE_AFTER_MS - MINUTE, Some(20.0), Some(30.0))];
        let stale = report(&old, NOW);
        assert!(!stale.available);
        assert_eq!(stale.last_seen_ms, Some(NOW - STALE_AFTER_MS - MINUTE));
        assert_eq!((stale.five_hour, stale.seven_day), (None, None));

        let fresh = vec![snap(NOW - MINUTE, Some(20.0), Some(30.0))];
        let after_five_hour_reset = report(&fresh, (FIVE_HOUR_RESET + 1) * 1000);
        assert!(!after_five_hour_reset.available);
        let one_window = report(&[snap(NOW, None, Some(30.0))], NOW);
        assert!(one_window.available);
        assert_eq!(one_window.five_hour, None);
    }

    #[test]
    fn read_reports_unavailable_when_nothing_was_recorded() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!read(dir.path(), NOW).available);
        record(dir.path(), &status_line(5.0, 6.0), NOW - MINUTE).unwrap();
        assert!(read(dir.path(), NOW).available);
    }

    #[test]
    fn the_record_line_pipes_the_status_line_input_to_this_program() {
        assert_eq!(
            record_line("/Applications/Fathom.app/Contents/MacOS/fathom"),
            r#"echo "$input" | '/Applications/Fathom.app/Contents/MacOS/fathom' --quota-record &"#
        );
        assert_eq!(
            record_line("/Users/a b/it's/fathom"),
            r#"echo "$input" | '/Users/a b/it'\''s/fathom' --quota-record &"#
        );
    }
}
