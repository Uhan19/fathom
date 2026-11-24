use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Serialize;

const DOCKER_BUNDLE: &str = "/Docker.app/";
const DOCKER_VM_NAMES: [&str; 5] = [
    "com.docker.virtualization",
    "com.docker.hyperkit",
    "com.apple.Virtualization.VirtualMachine",
    "qemu-system-aarch64",
    "qemu-system-x86_64",
];
const CHROME_EXECUTABLES: [&str; 3] = ["chrome", "chromium", "chrome-headless-shell"];
const SHELLS: [&str; 6] = ["zsh", "bash", "sh", "fish", "dash", "login"];
const AUTOMATION_HINTS: [&str; 5] = [
    "playwright",
    "puppeteer",
    "chrome-devtools",
    "agent-browser",
    "browser-use",
];
const DEV_SERVER_TOOLS: [&str; 10] = [
    "vite",
    "next",
    "next-server",
    "webpack",
    "webpack-dev-server",
    "react-scripts",
    "astro",
    "nuxt",
    "nuxi",
    "remix",
];
const PACKAGE_RUNNERS: [&str; 5] = ["npm", "pnpm", "yarn", "bun", "npx"];
const DEV_SCRIPTS: [&str; 3] = ["dev", "start", "serve"];
const APP_SUFFIX: &str = ".app";
const TOP_APPS: usize = 8;

const CLAUDE_VERSIONS: &str = "/claude/versions/";
const CLAUDE_CODE: &str = "Claude Code";
pub const AGENT_CLAUDE: &str = "Agent (Claude Code)";
pub const AGENT_CODEX: &str = "Agent (Codex)";
pub const HEADLESS_CHROME: &str = "Headless Chrome";
pub const CHROME: &str = "Chrome";
pub const AUTOMATION: &str = "Browser automation helper";
pub const DEV_SERVER: &str = "Local dev server";
pub const SHELL: &str = "Shell";
pub const DOCKER: &str = "Docker";
pub const DOCKER_VM: &str = "Docker VM";
pub const DOCKER_DESKTOP: &str = "Docker Desktop";
pub const FATHOM: &str = "Fathom";
pub const ORCHESTRATOR: &str = "Orchestrator";
pub const BOARD_ASSISTANT: &str = "Board assistant";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Process {
    pub pid: u32,
    pub parent: u32,
    pub name: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Pressure {
    Normal,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Machine {
    pub total: u64,
    pub used: u64,
    pub system: u64,
    pub system_name: &'static str,
    pub pressure: Option<Pressure>,
    pub activity_monitor: bool,
    pub processes: Vec<Process>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerRoot {
    pub task_id: String,
    pub title: String,
    pub terminal: String,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalRoot {
    pub terminal: Option<String>,
    pub pid: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Roots {
    pub fathom: Vec<u32>,
    pub orchestrator: Option<TerminalRoot>,
    pub workers: Vec<WorkerRoot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupKind {
    Fathom,
    Orchestrator,
    Worker,
    Docker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub label: String,
    pub bytes: u64,
    pub processes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub kind: GroupKind,
    pub id: String,
    pub name: String,
    pub task_id: Option<String>,
    pub terminal: Option<String>,
    pub bytes: u64,
    pub parts: Vec<Part>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rest {
    pub bytes: u64,
    pub apps: Vec<App>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySample {
    pub taken_at_ms: i64,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub pressure: Option<Pressure>,
    pub activity_monitor: bool,
    pub herdr_connected: bool,
    pub groups: Vec<Group>,
    pub rest: Rest,
}

struct Tree<'a> {
    by_pid: HashMap<u32, &'a Process>,
    children: HashMap<u32, Vec<u32>>,
    claimed: HashSet<u32>,
}

impl<'a> Tree<'a> {
    fn new(processes: &'a [Process]) -> Tree<'a> {
        let by_pid: HashMap<u32, &Process> = processes.iter().map(|p| (p.pid, p)).collect();
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for process in processes.iter().filter(|p| p.parent != p.pid) {
            children
                .entry(process.parent)
                .or_default()
                .push(process.pid);
        }
        Tree {
            by_pid,
            children,
            claimed: HashSet::new(),
        }
    }

    fn claim(&mut self, root: u32) -> Vec<(&'a Process, Option<&'a Process>)> {
        let mut found = Vec::new();
        let mut stack: Vec<(u32, Option<u32>)> = vec![(root, None)];
        while let Some((pid, parent)) = stack.pop() {
            let Some(process) = self.by_pid.get(&pid).copied() else {
                continue;
            };
            if !self.claimed.insert(pid) {
                continue;
            }
            found.push((process, parent.and_then(|p| self.by_pid.get(&p).copied())));
            if let Some(kids) = self.children.get(&pid) {
                stack.extend(kids.iter().map(|kid| (*kid, Some(pid))));
            }
        }
        found
    }
}

pub fn group(
    machine: &Machine,
    roots: &Roots,
    herdr_connected: bool,
    taken_at_ms: i64,
    args_of: &dyn Fn(u32) -> Vec<String>,
) -> MemorySample {
    let mut tree = Tree::new(&machine.processes);
    let mut groups = Vec::new();

    for worker in &roots.workers {
        let members = tree.claim(worker.pid);
        if members.is_empty() {
            continue;
        }
        groups.push(Group {
            kind: GroupKind::Worker,
            id: format!("worker:{}", worker.task_id),
            name: worker.title.clone(),
            task_id: Some(worker.task_id.clone()),
            terminal: Some(worker.terminal.clone()),
            bytes: 0,
            parts: agent_parts(&members, args_of),
        });
    }
    if let Some(orchestrator) = &roots.orchestrator {
        let members = tree.claim(orchestrator.pid);
        if !members.is_empty() {
            groups.push(Group {
                kind: GroupKind::Orchestrator,
                id: "orchestrator".into(),
                name: ORCHESTRATOR.into(),
                task_id: None,
                terminal: orchestrator.terminal.clone(),
                bytes: 0,
                parts: agent_parts(&members, args_of),
            });
        }
    }
    let fathom: Vec<_> = roots
        .fathom
        .iter()
        .flat_map(|pid| tree.claim(*pid))
        .collect();
    if !fathom.is_empty() {
        groups.push(Group {
            kind: GroupKind::Fathom,
            id: "fathom".into(),
            name: FATHOM.into(),
            task_id: None,
            terminal: None,
            bytes: 0,
            parts: fathom_parts(&fathom, roots.fathom.first().copied()),
        });
    }
    let docker_roots: Vec<u32> = machine
        .processes
        .iter()
        .filter(|p| is_docker(p))
        .map(|p| p.pid)
        .collect();
    let docker: Vec<_> = docker_roots
        .into_iter()
        .flat_map(|pid| tree.claim(pid))
        .collect();
    if !docker.is_empty() {
        groups.push(Group {
            kind: GroupKind::Docker,
            id: "docker".into(),
            name: DOCKER.into(),
            task_id: None,
            terminal: None,
            bytes: 0,
            parts: summed(docker.iter().map(|(p, _)| (docker_label(p), p.bytes))),
        });
    }
    for group in &mut groups {
        group.bytes = group.parts.iter().map(|part| part.bytes).sum();
    }

    let grouped: u64 = groups.iter().map(|g| g.bytes).sum();
    let unclaimed = machine
        .processes
        .iter()
        .filter(|p| !tree.claimed.contains(&p.pid))
        .map(|p| (app_name(p), p.bytes));
    let mut apps = summed(unclaimed);
    let rest = machine.used.saturating_sub(grouped);
    apps.push(Part {
        label: machine.system_name.into(),
        bytes: machine.system,
        processes: 0,
    });
    apps.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.label.cmp(&b.label)));
    MemorySample {
        taken_at_ms,
        total: machine.total,
        used: machine.used,
        available: machine.total.saturating_sub(machine.used),
        pressure: machine.pressure,
        activity_monitor: machine.activity_monitor,
        herdr_connected,
        groups,
        rest: Rest {
            bytes: rest,
            apps: apps
                .into_iter()
                .filter(|app| app.bytes > 0)
                .take(TOP_APPS)
                .map(|app| App {
                    name: app.label,
                    bytes: app.bytes,
                })
                .collect(),
        },
    }
}

fn agent_parts(
    members: &[(&Process, Option<&Process>)],
    args_of: &dyn Fn(u32) -> Vec<String>,
) -> Vec<Part> {
    let mut labels: HashMap<u32, String> = HashMap::new();
    let mut ordered = Vec::new();
    for (process, parent) in members {
        let inherited = parent
            .and_then(|p| labels.get(&p.pid))
            .filter(|label| is_browser(label))
            .cloned();
        let label = inherited.unwrap_or_else(|| label_of(process, &args_of(process.pid)));
        labels.insert(process.pid, label.clone());
        ordered.push((label, process.bytes));
    }
    summed(ordered.into_iter())
}

fn fathom_parts(members: &[(&Process, Option<&Process>)], own: Option<u32>) -> Vec<Part> {
    let mut own_tree: HashSet<u32> = own.into_iter().collect();
    let labeled = members.iter().map(|(process, parent)| {
        let in_own = Some(process.pid) == own || parent.is_some_and(|p| own_tree.contains(&p.pid));
        if in_own {
            own_tree.insert(process.pid);
        }
        let label = if in_own { FATHOM } else { BOARD_ASSISTANT };
        (label.to_string(), process.bytes)
    });
    summed(labeled.collect::<Vec<_>>().into_iter())
}

fn summed(items: impl Iterator<Item = (String, u64)>) -> Vec<Part> {
    let mut sums: BTreeMap<String, (u64, usize)> = BTreeMap::new();
    for (label, bytes) in items {
        let entry = sums.entry(label).or_default();
        entry.0 += bytes;
        entry.1 += 1;
    }
    let mut parts: Vec<Part> = sums
        .into_iter()
        .map(|(label, (bytes, processes))| Part {
            label,
            bytes,
            processes,
        })
        .collect();
    parts.sort_by(|a, b| b.bytes.cmp(&a.bytes).then(a.label.cmp(&b.label)));
    parts
}

fn is_browser(label: &str) -> bool {
    label == HEADLESS_CHROME || label == CHROME
}

fn base(text: &str) -> &str {
    text.rsplit('/').next().unwrap_or(text)
}

pub fn label_of(process: &Process, args: &[String]) -> String {
    let name = base(&process.name);
    let exe = base(&process.path);
    let first = args.first().map(|a| base(a)).unwrap_or_default();
    let joined = args.join(" ");
    if is_chrome(process) {
        return if args.iter().any(|a| a.starts_with("--headless")) {
            HEADLESS_CHROME.into()
        } else {
            CHROME.into()
        };
    }
    if is_claude(process) || first == "claude" || joined.contains("@anthropic-ai/claude-code") {
        return AGENT_CLAUDE.into();
    }
    if [name, exe, first].contains(&"codex") || joined.contains("@openai/codex") {
        return AGENT_CODEX.into();
    }
    if AUTOMATION_HINTS.iter().any(|hint| joined.contains(hint)) {
        return AUTOMATION.into();
    }
    if is_dev_server(args) {
        return DEV_SERVER.into();
    }
    if SHELLS.contains(&name.trim_start_matches('-')) {
        return SHELL.into();
    }
    if !exe.is_empty() { exe } else { name }.to_string()
}

fn is_claude(process: &Process) -> bool {
    process.path.contains(CLAUDE_VERSIONS)
        || base(&process.path) == "claude"
        || base(&process.name) == "claude"
}

fn is_chrome(process: &Process) -> bool {
    let path = &process.path;
    path.contains("Chrome")
        || path.contains("Chromium")
        || CHROME_EXECUTABLES.contains(&base(path))
        || CHROME_EXECUTABLES.contains(&base(&process.name))
}

fn is_dev_server(args: &[String]) -> bool {
    let tools = args
        .iter()
        .take(3)
        .any(|arg| DEV_SERVER_TOOLS.contains(&base(arg).split(' ').next().unwrap_or_default()));
    let runner = args
        .first()
        .is_some_and(|first| PACKAGE_RUNNERS.contains(&base(first)))
        && args
            .iter()
            .skip(1)
            .any(|arg| DEV_SCRIPTS.contains(&arg.as_str()));
    tools || runner
}

fn is_docker(process: &Process) -> bool {
    process.path.contains(DOCKER_BUNDLE) || DOCKER_VM_NAMES.contains(&base(&process.path))
}

fn docker_label(process: &Process) -> String {
    let exe = base(&process.path);
    if DOCKER_VM_NAMES.contains(&exe) {
        DOCKER_VM.into()
    } else {
        DOCKER_DESKTOP.into()
    }
}

pub fn app_name(process: &Process) -> String {
    let bundle = process.path.split('/').find_map(|part| {
        part.strip_suffix(APP_SUFFIX)
            .filter(|name| !name.is_empty())
    });
    match bundle {
        Some(name) => name.to_string(),
        None if is_claude(process) => CLAUDE_CODE.to_string(),
        None if !process.path.is_empty() => base(&process.path).to_string(),
        None => base(&process.name).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1 << 20;

    fn process(pid: u32, parent: u32, path: &str, mb: u64) -> Process {
        Process {
            pid,
            parent,
            name: base(path).chars().take(16).collect(),
            path: path.into(),
            bytes: mb * MB,
        }
    }

    fn args_for(pid: u32) -> Vec<String> {
        let args: &[&str] = match pid {
            21 => &["/usr/local/bin/claude", "--resume"],
            22 => &[
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "--headless=new",
            ],
            24 => &["node", "/work/node_modules/.bin/playwright-mcp"],
            25 => &["node", "/work/node_modules/.bin/vite", "--port", "5173"],
            26 => &["pnpm", "run", "dev"],
            31 => &["/usr/local/bin/claude"],
            41 => &["/usr/local/bin/claude", "--model", "haiku"],
            _ => &[],
        };
        args.iter().map(|a| a.to_string()).collect()
    }

    fn machine() -> Machine {
        Machine {
            total: 16384 * MB,
            used: 9000 * MB,
            system: 2500 * MB,
            system_name: "macOS",
            pressure: Some(Pressure::Normal),
            activity_monitor: true,
            processes: vec![
                process(1, 0, "/sbin/launchd", 20),
                process(10, 1, "/Applications/Fathom.app/Contents/MacOS/fathom", 120),
                process(11, 10, "/usr/local/bin/hc", 5),
                process(
                    12,
                    10,
                    "/System/Library/WebKit/com.apple.WebKit.WebContent",
                    300,
                ),
                process(100, 1, "/usr/local/bin/herdr-core", 15),
                process(20, 100, "/bin/zsh", 4),
                process(21, 20, "/usr/local/bin/claude", 300),
                process(
                    22,
                    21,
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    400,
                ),
                process(
                    23,
                    22,
                    "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)",
                    129,
                ),
                process(24, 21, "/usr/local/bin/node", 354),
                process(25, 26, "/usr/local/bin/node", 200),
                process(26, 21, "/usr/local/bin/pnpm", 37),
                process(30, 100, "/bin/zsh", 3),
                process(31, 30, "/usr/local/bin/claude", 500),
                process(40, 100, "/usr/local/bin/claude", 250),
                process(
                    50,
                    1,
                    "/Applications/Docker.app/Contents/MacOS/com.docker.backend",
                    150,
                ),
                process(
                    51,
                    50,
                    "/Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/MacOS/Docker Desktop",
                    70,
                ),
                process(
                    52,
                    50,
                    "/System/Library/Frameworks/Virtualization.framework/com.apple.Virtualization.VirtualMachine",
                    2048,
                ),
                process(
                    60,
                    1,
                    "/Applications/Discord.app/Contents/MacOS/Discord",
                    600,
                ),
                process(
                    61,
                    60,
                    "/Applications/Discord.app/Contents/Frameworks/Discord Helper (Renderer).app/Contents/MacOS/Discord Helper (Renderer)",
                    400,
                ),
                process(70, 1, "/usr/local/bin/rust-analyzer", 800),
            ],
        }
    }

    fn roots() -> Roots {
        Roots {
            fathom: vec![10, 40],
            orchestrator: Some(TerminalRoot {
                terminal: Some("t3".into()),
                pid: 30,
            }),
            workers: vec![WorkerRoot {
                task_id: "reef-7".into(),
                title: "Chart the reef".into(),
                terminal: "t2".into(),
                pid: 20,
            }],
        }
    }

    fn parts(group: &Group) -> Vec<(&str, u64)> {
        group
            .parts
            .iter()
            .map(|p| (p.label.as_str(), p.bytes / MB))
            .collect()
    }

    #[test]
    fn processes_group_into_fathom_the_orchestrator_each_worker_docker_and_the_rest() {
        let sample = group(&machine(), &roots(), true, 7, &args_for);
        let kinds: Vec<(GroupKind, &str, u64)> = sample
            .groups
            .iter()
            .map(|g| (g.kind, g.name.as_str(), g.bytes / MB))
            .collect();
        assert_eq!(
            kinds,
            [
                (GroupKind::Worker, "Chart the reef", 1424),
                (GroupKind::Orchestrator, ORCHESTRATOR, 503),
                (GroupKind::Fathom, FATHOM, 675),
                (GroupKind::Docker, DOCKER, 2268),
            ]
        );
        let worker = &sample.groups[0];
        assert_eq!(worker.task_id.as_deref(), Some("reef-7"));
        assert_eq!(worker.terminal.as_deref(), Some("t2"));
        assert_eq!(
            parts(worker),
            [
                (HEADLESS_CHROME, 529),
                (AUTOMATION, 354),
                (AGENT_CLAUDE, 300),
                (DEV_SERVER, 237),
                (SHELL, 4),
            ]
        );
        assert_eq!(
            parts(&sample.groups[2]),
            [(FATHOM, 425), (BOARD_ASSISTANT, 250)]
        );
        assert_eq!(
            parts(&sample.groups[3]),
            [(DOCKER_VM, 2048), (DOCKER_DESKTOP, 220)]
        );
    }

    #[test]
    fn everything_else_is_the_used_total_minus_the_groups_with_apps_by_bundle() {
        let sample = group(&machine(), &roots(), true, 7, &args_for);
        assert_eq!(sample.available, (16384 - 9000) * MB);
        assert_eq!(sample.rest.bytes, (9000 - 1424 - 503 - 675 - 2268) * MB);
        let apps: Vec<(&str, u64)> = sample
            .rest
            .apps
            .iter()
            .map(|a| (a.name.as_str(), a.bytes / MB))
            .collect();
        assert_eq!(
            apps,
            [
                ("macOS", 2500),
                ("Discord", 1000),
                ("rust-analyzer", 800),
                ("launchd", 20),
                ("herdr-core", 15),
            ]
        );
    }

    #[test]
    fn without_herdr_roots_agents_fall_into_everything_else() {
        let roots = Roots {
            fathom: vec![10],
            ..Roots::default()
        };
        let sample = group(&machine(), &roots, false, 7, &args_for);
        let kinds: Vec<GroupKind> = sample.groups.iter().map(|g| g.kind).collect();
        assert_eq!(kinds, [GroupKind::Fathom, GroupKind::Docker]);
        assert!(!sample.herdr_connected);
        assert!(sample.rest.apps.iter().any(|a| a.name == CLAUDE_CODE));
    }

    #[test]
    fn a_worker_whose_terminal_process_is_gone_has_no_group() {
        let mut roots = roots();
        roots.workers[0].pid = 999;
        let sample = group(&machine(), &roots, true, 7, &args_for);
        assert!(sample.groups.iter().all(|g| g.kind != GroupKind::Worker));
    }

    #[test]
    fn a_process_never_counts_in_two_groups() {
        let mut roots = roots();
        roots.fathom.push(20);
        let sample = group(&machine(), &roots, true, 7, &args_for);
        let worker = sample.groups.iter().find(|g| g.kind == GroupKind::Worker);
        assert_eq!(worker.unwrap().bytes / MB, 1424);
        assert_eq!(
            sample.groups.iter().map(|g| g.bytes).sum::<u64>() + sample.rest.bytes,
            sample.used
        );
    }

    #[test]
    fn child_processes_get_plain_labels() {
        let label = |path: &str, args: &[&str]| {
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            label_of(&process(1, 0, path, 1), &args)
        };
        assert_eq!(
            label("/home/a/.local/share/claude/versions/2.1.0", &[]),
            AGENT_CLAUDE
        );
        assert_eq!(
            label("/usr/bin/node", &["node", "/x/@openai/codex/bin/codex.js"]),
            AGENT_CODEX
        );
        assert_eq!(
            label(
                "/opt/chrome/chrome-headless-shell",
                &["chrome-headless-shell", "--headless"]
            ),
            HEADLESS_CHROME
        );
        assert_eq!(
            label(
                "/usr/bin/node",
                &["node", "/x/chrome-devtools-mcp/index.js"]
            ),
            AUTOMATION
        );
        assert_eq!(
            label("/usr/bin/node", &["node", "/x/.bin/next", "dev"]),
            DEV_SERVER
        );
        assert_eq!(label("/usr/bin/npm", &["npm", "run", "dev"]), DEV_SERVER);
        assert_eq!(label("/usr/bin/node", &["node", "/x/vitest.mjs"]), "node");
        assert_eq!(label("/bin/zsh", &["-zsh"]), SHELL);
        assert_eq!(label("/usr/bin/git", &["git", "status"]), "git");
    }

    #[test]
    fn an_app_is_named_by_its_outermost_bundle() {
        let name = |path: &str| app_name(&process(1, 0, path, 1));
        assert_eq!(
            name(
                "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper"
            ),
            "Google Chrome"
        );
        assert_eq!(name("/usr/libexec/trustd"), "trustd");
        assert_eq!(
            name("/home/a/.local/share/claude/versions/2.1.0"),
            CLAUDE_CODE
        );
    }
}
