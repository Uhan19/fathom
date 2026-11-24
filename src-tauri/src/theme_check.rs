use std::fs::{self, OpenOptions};
use std::io::{Read, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::snapshot;
use crate::themes::{
    self, Finding, Manifest, Mode, SHOTS_DIR, Themes, check_folder, folder_hash, id_of,
};

pub const THEME_COMMAND: &str = "theme";
const CHECK: &str = "check";
const SHOT: &str = "shot";
const JSON_FLAG: &str = "--json";
const MODE_FLAG: &str = "--mode";
const SIZE_FLAG: &str = "--size";
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(300);
const LOCK_POLL: Duration = Duration::from_millis(250);
const WINDOW_LABEL: &str = "theme-check";
const HARNESS_PAGE: &str = "themecheck.html";
const CHECK_SHOTS: &str = "check";
const REPORT_FILE: &str = "check.json";
const LOCK_EXTENSION: &str = "lock";
const USAGE: &str = "usage: fathom theme check <folder> [--json]\n       fathom theme shot <folder> [--mode light|dark] [--size desktop|min] [--json]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Size {
    Desktop,
    Min,
}

impl Size {
    pub fn pixels(self) -> (u32, u32) {
        match self {
            Size::Desktop => (1600, 1000),
            Size::Min => (960, 600),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Size::Desktop => "desktop",
            Size::Min => "min",
        }
    }

    fn parse(text: &str) -> Result<Size, String> {
        match text {
            "desktop" => Ok(Size::Desktop),
            "min" => Ok(Size::Min),
            _ => Err(format!("the size is desktop or min, not {text}")),
        }
    }
}

fn parse_mode(text: &str) -> Result<Mode, String> {
    match text {
        "light" => Ok(Mode::Light),
        "dark" => Ok(Mode::Dark),
        _ => Err(format!("the mode is light or dark, not {text}")),
    }
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Light => "light",
        Mode::Dark => "dark",
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Job {
    Check,
    Shot { mode: Option<Mode>, size: Size },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub folder: PathBuf,
    pub job: Job,
    pub json: bool,
}

pub fn parse(args: &[String]) -> Option<Result<Request, String>> {
    if args.get(1).map(String::as_str) != Some(THEME_COMMAND) {
        return None;
    }
    Some(parse_request(&args[2..]))
}

fn parse_request(args: &[String]) -> Result<Request, String> {
    let usage = || USAGE.to_string();
    let (verb, rest) = args.split_first().ok_or_else(usage)?;
    let mut folder = None;
    let mut json = false;
    let mut mode = None;
    let mut size = Size::Desktop;
    let mut words = rest.iter();
    while let Some(word) = words.next() {
        match word.as_str() {
            JSON_FLAG => json = true,
            MODE_FLAG if verb == SHOT => mode = Some(parse_mode(words.next().ok_or_else(usage)?)?),
            SIZE_FLAG if verb == SHOT => size = Size::parse(words.next().ok_or_else(usage)?)?,
            crate::mcp::DB_FLAG => {
                words.next().ok_or_else(usage)?;
            }
            flag if flag.starts_with("--") => return Err(usage()),
            path if folder.is_none() => folder = Some(PathBuf::from(path)),
            _ => return Err(usage()),
        }
    }
    let folder = folder.ok_or_else(usage)?;
    let job = match verb.as_str() {
        CHECK => Job::Check,
        SHOT => Job::Shot { mode, size },
        _ => return Err(usage()),
    };
    Ok(Request { folder, job, json })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub theme: String,
    pub passed: bool,
    pub cached: bool,
    pub findings: Vec<Finding>,
    pub shots: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    mode: Mode,
    size: Size,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanTheme {
    id: String,
    version: String,
    base: String,
    manifest: Manifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    job: &'static str,
    theme: PlanTheme,
    runs: Vec<Run>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HarnessReport {
    findings: Vec<Finding>,
    #[serde(default)]
    shots: Vec<String>,
    #[serde(default)]
    incomplete: bool,
}

struct Session {
    plan: Plan,
    folder: PathBuf,
    baselines: PathBuf,
    report: Mutex<Option<HarnessReport>>,
}

const BASELINES_DIR: &str = ".baselines";

fn build_stamp() -> String {
    let modified = std::env::current_exe()
        .and_then(fs::metadata)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or_default();
    format!("{}-{modified}", env!("CARGO_PKG_VERSION"))
}

fn baseline_file(dir: &Path, mode: Mode, size: Size) -> PathBuf {
    dir.join(format!(
        "{}-{}-{}.json",
        build_stamp(),
        mode_name(mode),
        size.name()
    ))
}

fn runs_for(manifest: &Manifest, job: &Job) -> Vec<Run> {
    let run = |mode: Mode, size: Size| {
        let (width, height) = size.pixels();
        Run {
            mode,
            size,
            width,
            height,
        }
    };
    match job {
        Job::Check => manifest
            .modes
            .iter()
            .flat_map(|&mode| [Size::Desktop, Size::Min].map(|size| run(mode, size)))
            .collect(),
        Job::Shot { mode, size } => {
            let mode = mode
                .filter(|m| manifest.modes.contains(m))
                .unwrap_or(manifest.modes[0]);
            vec![run(mode, *size)]
        }
    }
}

pub fn run_cli(context: tauri::Context, request: Request, data_dir: &Path) -> i32 {
    match execute(context, &request, data_dir) {
        Ok(outcome) => {
            print_outcome(&outcome, request.json);
            i32::from(!outcome.passed)
        }
        Err(error) => {
            eprintln!("fathom: {error}");
            2
        }
    }
}

fn print_outcome(outcome: &Outcome, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string(outcome).expect("an outcome is serializable")
        );
        return;
    }
    if outcome.passed {
        let note = if outcome.cached {
            " (unchanged since the last check)"
        } else {
            ""
        };
        println!("{}: passed{note}", outcome.theme);
    } else {
        println!("{}: {} problems", outcome.theme, outcome.findings.len());
        for finding in &outcome.findings {
            println!("- {}", describe(finding));
        }
    }
    for shot in &outcome.shots {
        println!("{shot}");
    }
}

pub fn describe(finding: &Finding) -> String {
    let place: Vec<String> = [
        finding.view.clone(),
        finding.mode.map(|m| mode_name(m).to_string()),
        finding.size.clone(),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut text = String::new();
    if !place.is_empty() {
        text.push_str(&format!("[{}] ", place.join(", ")));
    }
    if let Some(file) = &finding.file {
        text.push_str(&format!("{file}: "));
    }
    if let Some(control) = &finding.control {
        text.push_str(&format!("control {control}: "));
    } else if let Some(part) = &finding.part {
        text.push_str(&format!("part {part}: "));
    }
    text.push_str(&finding.problem);
    if let Some(shot) = &finding.screenshot {
        text.push_str(&format!(" ({shot})"));
    }
    text
}

fn execute(context: tauri::Context, request: &Request, data_dir: &Path) -> Result<Outcome, String> {
    let folder = fs::canonicalize(&request.folder)
        .map_err(|e| format!("cannot open {}: {e}", request.folder.display()))?;
    let id = id_of(&folder)?;
    let themes = Themes::new(themes::default_root()?, data_dir);
    let kept = fs::canonicalize(&themes.root)
        .ok()
        .is_some_and(|root| folder.parent() == Some(root.as_path()));
    let _lock = if kept {
        Some(Lock::acquire(&themes.store, &id)?)
    } else {
        None
    };
    let snapshot = themes.snapshot(&id, &folder)?;
    let hash = folder_hash(&snapshot.dir)?;
    if kept
        && request.job == Job::Check
        && let Some(record) = themes.record(&id).filter(|r| r.hash == hash)
    {
        return Ok(Outcome {
            theme: id,
            passed: record.passed,
            cached: true,
            findings: record.findings,
            shots: Vec::new(),
        });
    }
    let (manifest, findings) = check_folder(&snapshot.dir);
    let Some(manifest) = manifest.filter(|_| findings.is_empty()) else {
        return finish(
            &themes,
            kept,
            &id,
            &snapshot.dir,
            &folder,
            &hash,
            request,
            HarnessReport {
                findings,
                ..HarnessReport::default()
            },
        );
    };
    if request.job == Job::Check {
        let _ = fs::remove_dir_all(folder.join(SHOTS_DIR).join(CHECK_SHOTS));
    }
    let rendering = Rendering {
        shots: &folder,
        served: &snapshot.dir,
        id: &id,
        version: &hash,
        store: &themes.store,
    };
    let report = render(context, &rendering, manifest, &request.job)?;
    finish(
        &themes,
        kept,
        &id,
        &snapshot.dir,
        &folder,
        &hash,
        request,
        report,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish(
    themes: &Themes,
    kept: bool,
    id: &str,
    checked: &Path,
    folder: &Path,
    hash: &str,
    request: &Request,
    report: HarnessReport,
) -> Result<Outcome, String> {
    let outcome = Outcome {
        theme: id.to_string(),
        passed: report.findings.is_empty(),
        cached: false,
        findings: report.findings,
        shots: report.shots,
    };
    if request.job == Job::Check {
        if kept && !report.incomplete {
            themes.store_result(
                id,
                checked,
                hash,
                outcome.findings.clone(),
                crate::state::now_ms(),
            )?;
        }
        write_report(folder, &outcome);
    }
    Ok(outcome)
}

struct Rendering<'a> {
    shots: &'a Path,
    served: &'a Path,
    id: &'a str,
    version: &'a str,
    store: &'a Path,
}

fn write_report(folder: &Path, outcome: &Outcome) {
    let dir = folder.join(SHOTS_DIR);
    if fs::create_dir_all(&dir).is_ok()
        && let Ok(text) = serde_json::to_string_pretty(outcome)
    {
        let _ = fs::write(dir.join(REPORT_FILE), text);
    }
}

fn render(
    mut context: tauri::Context,
    rendering: &Rendering,
    manifest: Manifest,
    job: &Job,
) -> Result<HarnessReport, String> {
    let Rendering {
        shots: folder,
        served,
        id,
        version,
        store,
    } = *rendering;
    context.config_mut().app.windows.clear();
    let runs = runs_for(&manifest, job);
    let (width, height) = runs[0].size.pixels();
    let session = Arc::new(Session {
        plan: Plan {
            job: match job {
                Job::Check => CHECK,
                Job::Shot { .. } => SHOT,
            },
            theme: PlanTheme {
                id: id.to_string(),
                version: version.to_string(),
                base: themes::scheme::base(id, version),
                manifest,
            },
            runs,
        },
        folder: folder.to_path_buf(),
        baselines: store.join(BASELINES_DIR),
        report: Mutex::new(None),
    });
    let served_id = id.to_string();
    let served_folder = served.to_path_buf();
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol(themes::scheme::SCHEME, move |_ctx, request| {
            themes::scheme::serve(request.uri().path(), |asked| {
                (asked == served_id).then(|| served_folder.clone())
            })
            .into_response()
        })
        .manage(Arc::clone(&session))
        .invoke_handler(tauri::generate_handler![
            check_plan,
            check_resize,
            check_snapshot,
            check_pixels,
            check_log,
            check_baseline,
            check_keep_baseline,
            check_finish
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let window =
                WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App(HARNESS_PAGE.into()))
                    .title("Fathom theme check")
                    .inner_size(f64::from(width), f64::from(height))
                    .position(0.0, 0.0)
                    .resizable(true)
                    .decorations(false)
                    .skip_taskbar(true)
                    .focused(false)
                    .visible(false)
                    .background_throttling(
                        tauri::utils::config::BackgroundThrottlingPolicy::Disabled,
                    )
                    .build()?;
            snapshot::hide_offscreen(&window);
            window.show()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(CHECK_TIMEOUT);
                if let Some(session) = handle.try_state::<Arc<Session>>() {
                    session.report.lock().unwrap().get_or_insert(HarnessReport {
                        findings: vec![Finding::general(format!(
                            "the check did not finish within {} seconds",
                            CHECK_TIMEOUT.as_secs()
                        ))],
                        shots: Vec::new(),
                        incomplete: true,
                    });
                }
                handle.exit(1);
            });
            Ok(())
        })
        .build(context)
        .map_err(|e| format!("cannot open the render window: {e}"))?;
    app.run_return(|_, _| {});
    session
        .report
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "the render window closed before the check finished".to_string())
}

type SessionRef<'a> = State<'a, Arc<Session>>;

#[tauri::command]
fn check_plan(session: SessionRef) -> Plan {
    session.plan.clone()
}

#[tauri::command]
fn check_resize(window: tauri::WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn check_baseline(session: SessionRef, mode: Mode, size: Size) -> Option<serde_json::Value> {
    if cfg!(debug_assertions) {
        return None;
    }
    let text = fs::read_to_string(baseline_file(&session.baselines, mode, size)).ok()?;
    serde_json::from_str(&text).ok()
}

#[tauri::command]
fn check_keep_baseline(
    session: SessionRef,
    mode: Mode,
    size: Size,
    scans: serde_json::Value,
) -> Result<(), String> {
    fs::create_dir_all(&session.baselines).map_err(|e| e.to_string())?;
    let stamp = build_stamp();
    for entry in fs::read_dir(&session.baselines)
        .into_iter()
        .flatten()
        .flatten()
    {
        if !entry.file_name().to_string_lossy().starts_with(&stamp) {
            let _ = fs::remove_file(entry.path());
        }
    }
    let text = serde_json::to_string(&scans).map_err(|e| e.to_string())?;
    fs::write(baseline_file(&session.baselines, mode, size), text).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_log(text: String) {
    eprintln!("theme check: {text}");
}

#[tauri::command]
async fn check_snapshot(
    window: tauri::WebviewWindow,
    session: SessionRef<'_>,
    name: String,
) -> Result<String, String> {
    let relative = shot_path(&name)?;
    let target = session.folder.join(&relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    tauri::async_runtime::spawn_blocking(move || snapshot::capture(&window, target))
        .await
        .map_err(|e| e.to_string())??;
    Ok(relative)
}

#[tauri::command]
async fn check_pixels(window: tauri::WebviewWindow) -> Result<String, String> {
    use base64::Engine as _;
    let target =
        std::env::temp_dir().join(format!("fathom-theme-check-{}.png", std::process::id()));
    let captured = target.clone();
    tauri::async_runtime::spawn_blocking(move || snapshot::capture(&window, captured))
        .await
        .map_err(|e| e.to_string())??;
    let bytes = fs::read(&target).map_err(|e| format!("cannot read the screenshot: {e}"))?;
    let _ = fs::remove_file(&target);
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn check_finish(app: tauri::AppHandle, session: SessionRef, report: HarnessReport) {
    session.report.lock().unwrap().get_or_insert(report);
    app.exit(0);
}

fn shot_path(name: &str) -> Result<String, String> {
    let well_formed = !name.is_empty()
        && name.split('/').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        });
    if well_formed {
        Ok(format!("{SHOTS_DIR}/{name}.png"))
    } else {
        Err(format!("{name} is not a screenshot name"))
    }
}

struct Lock(PathBuf);

impl Lock {
    fn acquire(store: &Path, id: &str) -> Result<Lock, String> {
        fs::create_dir_all(store).map_err(|e| format!("cannot create {}: {e}", store.display()))?;
        let path = store.join(format!("{id}.{LOCK_EXTENSION}"));
        let started = Instant::now();
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let _ = write!(file, "{}", std::process::id());
                    return Ok(Lock(path));
                }
                Err(_) if stale(&path) => {
                    let _ = fs::remove_file(&path);
                }
                Err(_) if started.elapsed() > CHECK_TIMEOUT => {
                    return Err(format!("another check of {id} is still running"));
                }
                Err(_) => std::thread::sleep(LOCK_POLL),
            }
        }
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn stale(lock: &Path) -> bool {
    fs::metadata(lock)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|age| age > CHECK_TIMEOUT + Duration::from_secs(30))
}

pub fn run_subprocess(program: &Path, args: &[String]) -> Result<Outcome, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start the theme check: {e}"))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let started = Instant::now();
    let deadline = CHECK_TIMEOUT * 2 + Duration::from_secs(30);
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => break,
            None if started.elapsed() > deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("the theme check did not finish".into());
            }
            None => std::thread::sleep(LOCK_POLL),
        }
    }
    let stdout = stdout.join().unwrap_or_default();
    serde_json::from_str(String::from_utf8_lossy(&stdout).trim()).map_err(|_| {
        let stderr = stderr.join().unwrap_or_default();
        format!(
            "the theme check failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        )
    })
}

fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

pub fn check_args(folder: &Path, db_file: Option<&Path>) -> Vec<String> {
    let mut args = vec![
        THEME_COMMAND.to_string(),
        CHECK.to_string(),
        folder.display().to_string(),
        JSON_FLAG.to_string(),
    ];
    if let Some(db) = db_file {
        args.extend([crate::mcp::DB_FLAG.to_string(), db.display().to_string()]);
    }
    args
}

pub fn shot_args(folder: &Path, mode: Option<Mode>, size: Size) -> Vec<String> {
    let mut args = vec![
        THEME_COMMAND.to_string(),
        SHOT.to_string(),
        folder.display().to_string(),
        JSON_FLAG.to_string(),
        SIZE_FLAG.to_string(),
        size.name().to_string(),
    ];
    if let Some(mode) = mode {
        args.extend([MODE_FLAG.to_string(), mode_name(mode).to_string()]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(words: &[&str]) -> Vec<String> {
        std::iter::once("fathom")
            .chain(words.iter().copied())
            .map(String::from)
            .collect()
    }

    #[test]
    fn reads_the_check_and_shot_commands() {
        assert_eq!(parse(&args(&["--mcp"])), None);
        assert_eq!(
            parse(&args(&["theme", "check", "/t/riso", "--json"])),
            Some(Ok(Request {
                folder: PathBuf::from("/t/riso"),
                job: Job::Check,
                json: true,
            }))
        );
        assert_eq!(
            parse(&args(&[
                "theme", "shot", "riso", "--mode", "dark", "--size", "min"
            ])),
            Some(Ok(Request {
                folder: PathBuf::from("riso"),
                job: Job::Shot {
                    mode: Some(Mode::Dark),
                    size: Size::Min,
                },
                json: false,
            }))
        );
        for bad in [
            vec!["theme"],
            vec!["theme", "check"],
            vec!["theme", "paint", "riso"],
            vec!["theme", "check", "riso", "--mode", "dark"],
            vec!["theme", "check", "riso", "--force"],
            vec!["theme", "shot", "riso", "--mode", "dusk"],
            vec!["theme", "shot", "riso", "--size"],
            vec!["theme", "check", "a", "b"],
        ] {
            assert!(matches!(parse(&args(&bad)), Some(Err(_))), "{bad:?}");
        }
    }

    #[test]
    fn the_subprocess_arguments_read_back() {
        let check = check_args(Path::new("/t/riso"), Some(Path::new("/d/f.sqlite")));
        let request = parse(&args(&check.iter().map(String::as_str).collect::<Vec<_>>()))
            .unwrap()
            .unwrap();
        assert_eq!(request.job, Job::Check);
        assert!(request.json);
        let shot = shot_args(Path::new("/t/riso"), Some(Mode::Light), Size::Min);
        let request = parse(&args(&shot.iter().map(String::as_str).collect::<Vec<_>>()))
            .unwrap()
            .unwrap();
        assert_eq!(
            request.job,
            Job::Shot {
                mode: Some(Mode::Light),
                size: Size::Min
            }
        );
    }

    #[test]
    fn a_check_renders_every_declared_mode_at_both_sizes_and_a_shot_one_view() {
        let mut manifest = themes::parse_manifest(r#"{"fathomTheme":1,"name":"Riso"}"#).unwrap();
        let check = runs_for(&manifest, &Job::Check);
        let pairs: Vec<_> = check.iter().map(|r| (r.mode, r.size)).collect();
        assert_eq!(
            pairs,
            vec![
                (Mode::Light, Size::Desktop),
                (Mode::Light, Size::Min),
                (Mode::Dark, Size::Desktop),
                (Mode::Dark, Size::Min)
            ]
        );
        assert_eq!((check[1].width, check[1].height), (960, 600));
        manifest.modes = vec![Mode::Dark];
        let shot = runs_for(
            &manifest,
            &Job::Shot {
                mode: Some(Mode::Light),
                size: Size::Desktop,
            },
        );
        assert_eq!((shot.len(), shot[0].mode), (1, Mode::Dark));
    }

    #[test]
    fn screenshot_names_stay_inside_the_shots_folder() {
        assert_eq!(
            shot_path("check/light-desktop-board").unwrap(),
            ".shots/check/light-desktop-board.png"
        );
        for bad in ["", "../x", "a//b", "A", "a.png", "/abs"] {
            assert!(shot_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn describes_a_finding_with_its_place_control_and_screenshot() {
        let finding = Finding {
            problem: "covered by another element".into(),
            control: Some("column-collapse".into()),
            part: None,
            file: None,
            view: Some("board".into()),
            mode: Some(Mode::Dark),
            size: Some("min".into()),
            screenshot: Some(".shots/check/dark-min-board.png".into()),
        };
        assert_eq!(
            describe(&finding),
            "[board, dark, min] control column-collapse: covered by another element (.shots/check/dark-min-board.png)"
        );
    }

    #[cfg(unix)]
    #[test]
    fn reads_an_outcome_larger_than_a_pipe_holds() {
        let dir = tempfile::tempdir().unwrap();
        let outcome = Outcome {
            theme: "riso".into(),
            passed: false,
            cached: false,
            findings: (0..5000)
                .map(|i| Finding::general(format!("problem {i} with a long description")))
                .collect(),
            shots: Vec::new(),
        };
        let file = dir.path().join("outcome.json");
        fs::write(&file, serde_json::to_string(&outcome).unwrap()).unwrap();
        assert!(fs::metadata(&file).unwrap().len() > 128 * 1024);
        let started = Instant::now();
        let read = run_subprocess(Path::new("cat"), &[file.display().to_string()]).unwrap();
        assert_eq!(read.findings.len(), 5000);
        assert!(started.elapsed() < Duration::from_secs(30));
    }

    #[test]
    fn a_check_that_could_not_finish_leaves_no_verdict_behind() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path().join("themes"), &dir.path().join("data"));
        let folder = themes.root.join("riso");
        fs::create_dir_all(&folder).unwrap();
        fs::write(
            folder.join(themes::MANIFEST_FILE),
            r#"{"fathomTheme":1,"name":"Riso"}"#,
        )
        .unwrap();
        let hash = folder_hash(&folder).unwrap();
        let request = Request {
            folder: folder.clone(),
            job: Job::Check,
            json: true,
        };
        let stopped = HarnessReport {
            findings: vec![Finding::general("the check could not finish: timed out")],
            incomplete: true,
            ..HarnessReport::default()
        };
        let snapshot = themes.snapshot("riso", &folder).unwrap();
        let outcome = finish(
            &themes,
            true,
            "riso",
            &snapshot.dir,
            &folder,
            &hash,
            &request,
            stopped,
        )
        .unwrap();
        assert!(!outcome.passed);
        assert!(themes.record("riso").is_none());
        assert_eq!(crate::theme_watch::stale(&themes), vec!["riso"]);
        let failed = HarnessReport {
            findings: vec![Finding::general("the brand mark is hidden")],
            ..HarnessReport::default()
        };
        finish(
            &themes,
            true,
            "riso",
            &snapshot.dir,
            &folder,
            &hash,
            &request,
            failed,
        )
        .unwrap();
        assert_eq!(themes.record("riso").map(|r| r.hash), Some(hash));
        assert!(crate::theme_watch::stale(&themes).is_empty());
    }

    #[test]
    fn a_second_check_waits_for_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let first = Lock::acquire(dir.path(), "riso").unwrap();
        let path = dir.path().join("riso.lock");
        assert!(path.exists());
        let waiter = {
            let store = dir.path().to_path_buf();
            std::thread::spawn(move || Lock::acquire(&store, "riso").map(|_| ()))
        };
        std::thread::sleep(Duration::from_millis(400));
        assert!(!waiter.is_finished());
        drop(first);
        waiter.join().unwrap().unwrap();
        assert!(!path.exists());
    }
}
