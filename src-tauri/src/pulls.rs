use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::shell_path;

const FRESH_FOR: Duration = Duration::from_secs(60);
const UNKNOWN_FRESH_FOR: Duration = Duration::from_secs(15);
const GH_TIMEOUT: Duration = Duration::from_secs(15);
const GH_FIELDS: &str =
    "state,isDraft,title,statusCheckRollup,reviewRequests,latestReviews,reviewDecision";
const FAILED_CONCLUSIONS: [&str; 6] = [
    "FAILURE",
    "TIMED_OUT",
    "CANCELLED",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
    "STALE",
];
const FAILED_STATES: [&str; 2] = ["FAILURE", "ERROR"];
const RUNNING_STATES: [&str; 2] = ["PENDING", "EXPECTED"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PrState {
    Open,
    Draft,
    Merged,
    Closed,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Checks {
    Passing,
    Failing,
    Running,
    None,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    Approved,
    ChangesRequested,
    Commented,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub login: String,
    pub state: ReviewState,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub url: String,
    pub state: PrState,
    pub checks: Checks,
    pub title: Option<String>,
    pub note: Option<String>,
    pub review_decision: Option<ReviewDecision>,
    pub requested: Vec<String>,
    pub reviews: Vec<Review>,
}

#[derive(Default)]
pub struct PrCache {
    entries: Mutex<HashMap<String, (Instant, PrStatus)>>,
}

impl PrCache {
    pub fn status(&self, url: &str) -> PrStatus {
        let Some(url) = pull_url(url) else {
            return unknown(url, "not a GitHub pull request link");
        };
        if let Some(status) = self.fresh(&url) {
            return status;
        }
        let status = fetch(&url).unwrap_or_else(|note| unknown(&url, &note));
        self.entries
            .lock()
            .unwrap()
            .insert(url, (Instant::now(), status.clone()));
        status
    }

    fn fresh(&self, url: &str) -> Option<PrStatus> {
        let entries = self.entries.lock().unwrap();
        let (at, status) = entries.get(url)?;
        let lifetime = if status.state == PrState::Unknown {
            UNKNOWN_FRESH_FOR
        } else {
            FRESH_FOR
        };
        (at.elapsed() < lifetime).then(|| status.clone())
    }
}

pub fn pull_url(url: &str) -> Option<String> {
    let rest = url.trim().strip_prefix("https://github.com/")?;
    let mut parts = rest.split(['/', '?', '#']);
    let (owner, repo, kind, number) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    let name_ok = |s: &str| {
        !s.is_empty()
            && !s.starts_with('-')
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
    };
    let number_ok = !number.is_empty() && number.chars().all(|c| c.is_ascii_digit());
    (name_ok(owner) && name_ok(repo) && kind == "pull" && number_ok)
        .then(|| format!("https://github.com/{owner}/{repo}/pull/{number}"))
}

fn unknown(url: &str, note: &str) -> PrStatus {
    PrStatus {
        url: url.to_string(),
        state: PrState::Unknown,
        checks: Checks::Unknown,
        title: None,
        note: Some(note.to_string()),
        review_decision: None,
        requested: Vec::new(),
        reviews: Vec::new(),
    }
}

fn fetch(url: &str) -> Result<PrStatus, String> {
    let gh = shell_path::find_first(&["gh"])
        .ok_or_else(|| "the GitHub CLI (gh) is not installed".to_string())?;
    let mut command = Command::new(gh);
    command
        .args(["pr", "view", url, "--json", GH_FIELDS])
        .env("PATH", shell_path::get())
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|e| format!("cannot run the GitHub CLI: {e}"))?;
    let pid = child.id();
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = send.send(child.wait_with_output());
    });
    let output = match receive.recv_timeout(GH_TIMEOUT) {
        Ok(result) => result.map_err(|e| format!("cannot run the GitHub CLI: {e}"))?,
        Err(_) => {
            // SAFETY: kill only signals the gh process this function spawned.
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
            return Err("GitHub did not answer in time".into());
        }
    };
    if !output.status.success() {
        return Err(gh_failure(&String::from_utf8_lossy(&output.stderr)));
    }
    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("unexpected answer from the GitHub CLI: {e}"))?;
    Ok(parse(url, &json))
}

fn gh_failure(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("gh auth login") || lower.contains("not logged") {
        return "the GitHub CLI is not signed in".into();
    }
    if lower.contains("could not resolve")
        || lower.contains("dial tcp")
        || lower.contains("network")
    {
        return "GitHub cannot be reached".into();
    }
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("the GitHub CLI failed")
        .to_string()
}

pub fn parse(url: &str, json: &Value) -> PrStatus {
    let draft = json["isDraft"].as_bool().unwrap_or(false);
    let state = match json["state"].as_str().unwrap_or_default() {
        "OPEN" if draft => PrState::Draft,
        "OPEN" => PrState::Open,
        "MERGED" => PrState::Merged,
        "CLOSED" => PrState::Closed,
        _ => PrState::Unknown,
    };
    let rollup = json["statusCheckRollup"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    PrStatus {
        url: url.to_string(),
        state,
        checks: checks_of(rollup),
        title: json["title"].as_str().map(str::to_string),
        note: None,
        review_decision: match json["reviewDecision"].as_str().unwrap_or_default() {
            "APPROVED" => Some(ReviewDecision::Approved),
            "CHANGES_REQUESTED" => Some(ReviewDecision::ChangesRequested),
            "REVIEW_REQUIRED" => Some(ReviewDecision::ReviewRequired),
            _ => None,
        },
        requested: list(&json["reviewRequests"])
            .filter_map(|request| login(&request["login"]))
            .collect(),
        reviews: list(&json["latestReviews"]).filter_map(review_of).collect(),
    }
}

fn list(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn login(value: &Value) -> Option<String> {
    value.as_str().filter(|l| !l.is_empty()).map(str::to_string)
}

fn review_of(review: &Value) -> Option<Review> {
    let state = match review["state"].as_str()? {
        "APPROVED" => ReviewState::Approved,
        "CHANGES_REQUESTED" => ReviewState::ChangesRequested,
        "COMMENTED" => ReviewState::Commented,
        "DISMISSED" => ReviewState::Dismissed,
        _ => return None,
    };
    Some(Review {
        login: login(&review["author"]["login"])?,
        state,
    })
}

pub fn checks_of(rollup: &[Value]) -> Checks {
    let field = |check: &Value, name: &str| check[name].as_str().unwrap_or_default().to_string();
    let mut running = false;
    for check in rollup {
        let (status, conclusion, state) = (
            field(check, "status"),
            field(check, "conclusion"),
            field(check, "state"),
        );
        if FAILED_CONCLUSIONS.contains(&conclusion.as_str())
            || FAILED_STATES.contains(&state.as_str())
        {
            return Checks::Failing;
        }
        let pending_run = !status.is_empty() && status != "COMPLETED";
        running |= pending_run || RUNNING_STATES.contains(&state.as_str());
    }
    match (rollup.is_empty(), running) {
        (true, _) => Checks::None,
        (false, true) => Checks::Running,
        (false, false) => Checks::Passing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const URL: &str = "https://github.com/example/atlas-api/pull/418";

    #[test]
    fn only_github_pull_request_links_are_looked_up() {
        assert_eq!(
            pull_url("https://github.com/example/atlas-api/pull/418/files?w=1"),
            Some(URL.into())
        );
        assert_eq!(
            pull_url("https://github.com/example/atlas-api/issues/4"),
            None
        );
        assert_eq!(pull_url("https://github.com/-x/atlas-api/pull/4"), None);
        assert_eq!(
            pull_url("https://gitlab.com/example/atlas-api/pull/4"),
            None
        );
        assert_eq!(pull_url("https://github.com/example/atlas-api/pull/"), None);
        let cache = PrCache::default();
        assert_eq!(cache.status("--help").state, PrState::Unknown);
    }

    #[test]
    fn states_include_drafts() {
        let open = json!({"state": "OPEN", "isDraft": false, "title": "Add retries"});
        assert_eq!(parse(URL, &open).state, PrState::Open);
        assert_eq!(parse(URL, &open).title.as_deref(), Some("Add retries"));
        let draft = json!({"state": "OPEN", "isDraft": true});
        assert_eq!(parse(URL, &draft).state, PrState::Draft);
        assert_eq!(
            parse(URL, &json!({"state": "MERGED"})).state,
            PrState::Merged
        );
        assert_eq!(
            parse(URL, &json!({"state": "CLOSED"})).state,
            PrState::Closed
        );
        assert_eq!(parse(URL, &json!({})).checks, Checks::None);
    }

    #[test]
    fn checks_fail_on_any_failure_run_while_pending_and_pass_otherwise() {
        let passed =
            json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SUCCESS"});
        let skipped =
            json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "SKIPPED"});
        let queued = json!({"__typename": "CheckRun", "status": "QUEUED", "conclusion": ""});
        let failed =
            json!({"__typename": "CheckRun", "status": "COMPLETED", "conclusion": "FAILURE"});
        let context_ok = json!({"__typename": "StatusContext", "state": "SUCCESS"});
        let context_pending = json!({"__typename": "StatusContext", "state": "PENDING"});
        let context_error = json!({"__typename": "StatusContext", "state": "ERROR"});

        assert_eq!(checks_of(&[]), Checks::None);
        assert_eq!(
            checks_of(&[passed.clone(), skipped, context_ok]),
            Checks::Passing
        );
        assert_eq!(
            checks_of(&[passed.clone(), queued.clone()]),
            Checks::Running
        );
        assert_eq!(
            checks_of(&[passed.clone(), context_pending]),
            Checks::Running
        );
        assert_eq!(checks_of(&[queued, failed]), Checks::Failing);
        assert_eq!(checks_of(&[passed, context_error]), Checks::Failing);
    }

    #[test]
    fn reviews_list_requested_people_and_each_latest_review() {
        let status = parse(
            URL,
            &json!({
                "state": "OPEN",
                "reviewDecision": "REVIEW_REQUIRED",
                "reviewRequests": [
                    {"__typename": "User", "login": "tomas-r"},
                    {"__typename": "Team", "name": "Web", "slug": "web"}
                ],
                "latestReviews": [
                    {"author": {"login": "mira-k"}, "state": "APPROVED"},
                    {"author": {"login": "priya-s"}, "state": "DISMISSED"},
                    {"author": {"login": "jun-o"}, "state": "PENDING"},
                    {"author": {}, "state": "COMMENTED"}
                ]
            }),
        );
        assert_eq!(status.review_decision, Some(ReviewDecision::ReviewRequired));
        assert_eq!(status.requested, ["tomas-r"]);
        assert_eq!(
            status.reviews,
            [
                Review {
                    login: "mira-k".into(),
                    state: ReviewState::Approved
                },
                Review {
                    login: "priya-s".into(),
                    state: ReviewState::Dismissed
                },
            ]
        );
        let quiet = parse(URL, &json!({"state": "OPEN", "reviewDecision": ""}));
        assert_eq!(quiet.review_decision, None);
        assert!(quiet.requested.is_empty() && quiet.reviews.is_empty());
    }

    #[test]
    fn gh_errors_become_quiet_notes() {
        assert_eq!(
            gh_failure("To get started with GitHub CLI, please run:  gh auth login"),
            "the GitHub CLI is not signed in"
        );
        assert_eq!(
            gh_failure("error connecting to api.github.com\ndial tcp: lookup failed"),
            "GitHub cannot be reached"
        );
        assert_eq!(
            gh_failure("\nGraphQL: Could not find the pull request\n"),
            "GraphQL: Could not find the pull request"
        );
    }
}
