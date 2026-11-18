use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::herdr::{self, Herdr, Terminal};
use crate::mcp::{DB_FLAG, MCP_FLAG};

pub const ROLE_KEY: &str = "fathom.role";
pub const AGENT_KEY: &str = "fathom.agent";
pub const CHAT_ROLE: &str = "chat";
pub const HERDR_CORE: &str = "herdr-core";
const SERVER_NAME: &str = "fathom";
const MCP_CONFIG_FILE: &str = "fathom-mcp.json";
const CLAUDE: &str = "claude";
const CODEX: &str = "codex";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
    Firstmate,
}

impl Agent {
    pub fn key(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Firstmate => "firstmate",
        }
    }

    fn program(self) -> &'static str {
        match self {
            Agent::Claude | Agent::Firstmate => CLAUDE,
            Agent::Codex => CODEX,
        }
    }
}

pub fn label(key: &str, value: &str) -> String {
    format!("{key}={value}")
}

pub fn chat_label() -> String {
    label(ROLE_KEY, CHAT_ROLE)
}

pub struct FathomServer {
    pub program: PathBuf,
    pub db: PathBuf,
}

impl FathomServer {
    fn args(&self) -> Vec<String> {
        vec![
            MCP_FLAG.to_string(),
            DB_FLAG.to_string(),
            self.db.display().to_string(),
        ]
    }

    fn config_file(&self) -> PathBuf {
        self.db.with_file_name(MCP_CONFIG_FILE)
    }
}

pub struct Launch<'a> {
    pub agent: Agent,
    pub role: &'a str,
    pub cwd: &'a Path,
    pub server: &'a FathomServer,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchError {
    Missing { tool: String },
    Failed { message: String },
}

fn failed(message: impl Into<String>) -> LaunchError {
    LaunchError::Failed {
        message: message.into(),
    }
}

pub fn open(
    herdr: &Herdr,
    launch: &Launch,
    find: impl Fn(&str) -> Option<PathBuf>,
) -> Result<Terminal, LaunchError> {
    herdr::program()
        .ok()
        .filter(|hc| hc.is_file())
        .ok_or_else(|| LaunchError::Missing {
            tool: HERDR_CORE.into(),
        })?;
    let program = launch.agent.program();
    let program = find(program).ok_or_else(|| LaunchError::Missing {
        tool: program.into(),
    })?;
    if !launch.cwd.is_dir() {
        return Err(failed(format!(
            "the working folder {} does not exist",
            launch.cwd.display()
        )));
    }
    let mut args = vec![
        "run".to_string(),
        "--bg".into(),
        "--json".into(),
        "--no-parent".into(),
        "--cwd".into(),
        launch.cwd.display().to_string(),
        "--label".into(),
        label(ROLE_KEY, launch.role),
        "--label".into(),
        label(AGENT_KEY, launch.agent.key()),
        "--".into(),
        program.display().to_string(),
    ];
    args.extend(agent_args(launch.agent, launch.server)?);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let started = herdr::parse_terminal(&herdr.run(&args).map_err(failed)?).map_err(failed)?;
    Ok(herdr.get(&started.address).unwrap_or(started))
}

fn agent_args(agent: Agent, server: &FathomServer) -> Result<Vec<String>, LaunchError> {
    match agent {
        Agent::Claude => Ok(vec![
            "--mcp-config".into(),
            write_mcp_config(server)?.display().to_string(),
        ]),
        Agent::Codex => Ok(vec![
            "-c".into(),
            format!(
                "mcp_servers.{SERVER_NAME}.command={}",
                json!(server.program.display().to_string())
            ),
            "-c".into(),
            format!("mcp_servers.{SERVER_NAME}.args={}", json!(server.args())),
        ]),
        Agent::Firstmate => Ok(vec![]),
    }
}

fn mcp_config(server: &FathomServer) -> serde_json::Value {
    json!({
        "mcpServers": {
            SERVER_NAME: {
                "command": server.program.display().to_string(),
                "args": server.args(),
            }
        }
    })
}

fn write_mcp_config(server: &FathomServer) -> Result<PathBuf, LaunchError> {
    let path = server.config_file();
    let text =
        serde_json::to_string_pretty(&mcp_config(server)).map_err(|e| failed(e.to_string()))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| failed(format!("cannot create {}: {e}", dir.display())))?;
    }
    std::fs::write(&path, text)
        .map_err(|e| failed(format!("cannot write {}: {e}", path.display())))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::herdr::Connection;
    use crate::herdr::tests::FAKE_HC;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Arc;

    const FAKE_HC_SCRIPT: &str = r#"#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done >> "$0.args"
printf '%s\n' '<end>' >> "$0.args"
case "$1" in
  run) printf '{"address":"t9","agent":"stub","cwd":"/started","state":"live"}\n' ;;
  get) printf '{"address":"%s","agent":"stub","cwd":"/started","state":"live","labels":{"fathom.role":"chat"}}\n' "$2" ;;
  *) exit 1 ;;
esac
"#;

    struct Lab {
        bin: tempfile::TempDir,
        data: tempfile::TempDir,
        folder: tempfile::TempDir,
    }

    impl Lab {
        fn new(tools: &[&str]) -> Lab {
            let lab = Lab {
                bin: tempfile::tempdir().unwrap(),
                data: tempfile::tempdir().unwrap(),
                folder: tempfile::tempdir().unwrap(),
            };
            for tool in tools {
                let script = lab.bin.path().join(tool);
                let body = if *tool == "hc" {
                    FAKE_HC_SCRIPT
                } else {
                    "#!/bin/sh\n"
                };
                std::fs::write(&script, body).unwrap();
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let hc = tools.contains(&"hc").then(|| lab.bin.path().join("hc"));
            FAKE_HC.with(|fake| *fake.borrow_mut() = hc);
            lab
        }

        fn server(&self) -> FathomServer {
            FathomServer {
                program: PathBuf::from("/Applications/Fathom.app/Contents/MacOS/fathom"),
                db: self.data.path().join("fathom.db"),
            }
        }

        fn open(&self, agent: Agent) -> Result<Terminal, LaunchError> {
            let herdr = Herdr::new(Connection::default(), Arc::new(|_| {}));
            let launch = Launch {
                agent,
                role: CHAT_ROLE,
                cwd: self.folder.path(),
                server: &self.server(),
            };
            let bin = self.bin.path().to_path_buf();
            open(&herdr, &launch, |program| {
                Some(bin.join(program)).filter(|path| path.is_file())
            })
        }

        fn calls(&self) -> Vec<Vec<String>> {
            let text = std::fs::read_to_string(self.bin.path().join("hc.args")).unwrap();
            text.split_terminator("<end>\n")
                .map(|call| call.lines().map(String::from).collect())
                .collect()
        }

        fn run_call(&self, agent: Agent, program: &str, args: &[&str]) -> Vec<String> {
            let mut call: Vec<String> = [
                "run",
                "--bg",
                "--json",
                "--no-parent",
                "--cwd",
                &self.folder.path().display().to_string(),
                "--label",
                "fathom.role=chat",
                "--label",
                &format!("fathom.agent={}", agent.key()),
                "--",
                &self.bin.path().join(program).display().to_string(),
            ]
            .iter()
            .map(|s| s.to_string())
            .collect();
            call.extend(args.iter().map(|s| s.to_string()));
            call
        }
    }

    #[test]
    fn claude_code_starts_with_an_mcp_config_file_for_fathom() {
        let lab = Lab::new(&["hc", "claude"]);
        let terminal = lab.open(Agent::Claude).unwrap();
        assert_eq!(terminal.address, "t9");
        assert_eq!(terminal.labels["fathom.role"], "chat");

        let config = lab.data.path().join("fathom-mcp.json");
        let config_arg = config.display().to_string();
        assert_eq!(
            lab.calls(),
            [
                lab.run_call(Agent::Claude, "claude", &["--mcp-config", &config_arg]),
                vec!["get".to_string(), "t9".into(), "--json".into()],
            ]
        );
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(config).unwrap()).unwrap();
        let db = lab.data.path().join("fathom.db").display().to_string();
        assert_eq!(
            written,
            json!({"mcpServers": {"fathom": {
                "command": "/Applications/Fathom.app/Contents/MacOS/fathom",
                "args": ["--mcp", "--db", db],
            }}})
        );
    }

    #[test]
    fn codex_gets_the_fathom_server_as_per_run_config_overrides() {
        let lab = Lab::new(&["hc", "codex"]);
        lab.open(Agent::Codex).unwrap();
        let db = lab.data.path().join("fathom.db").display().to_string();
        let command =
            r#"mcp_servers.fathom.command="/Applications/Fathom.app/Contents/MacOS/fathom""#;
        let args = format!(r#"mcp_servers.fathom.args=["--mcp","--db","{db}"]"#);
        assert_eq!(
            lab.calls()[0],
            lab.run_call(Agent::Codex, "codex", &["-c", command, "-c", &args])
        );
        assert!(!lab.data.path().join("fathom-mcp.json").exists());
    }

    #[test]
    fn firstmate_starts_plain_claude_code_without_the_fathom_server() {
        let lab = Lab::new(&["hc", "claude"]);
        lab.open(Agent::Firstmate).unwrap();
        assert_eq!(
            lab.calls()[0],
            lab.run_call(Agent::Firstmate, "claude", &[])
        );
        assert!(!lab.data.path().join("fathom-mcp.json").exists());
    }

    #[test]
    fn a_missing_agent_cli_or_herdr_core_is_named() {
        let lab = Lab::new(&["hc", "claude"]);
        assert_eq!(
            lab.open(Agent::Codex),
            Err(LaunchError::Missing {
                tool: "codex".into()
            })
        );
        let lab = Lab::new(&["codex"]);
        let missing_hc = FAKE_HC.with(|fake| {
            *fake.borrow_mut() = Some(lab.bin.path().join("hc"));
            lab.open(Agent::Codex)
        });
        assert_eq!(
            missing_hc,
            Err(LaunchError::Missing {
                tool: "herdr-core".into()
            })
        );
    }

    #[test]
    fn a_missing_working_folder_is_reported_before_anything_starts() {
        let lab = Lab::new(&["hc", "claude"]);
        let folder = lab.folder.path().to_path_buf();
        drop(lab.folder);
        let herdr = Herdr::new(Connection::default(), Arc::new(|_| {}));
        let server = FathomServer {
            program: PathBuf::from("/fathom"),
            db: lab.data.path().join("fathom.db"),
        };
        let launch = Launch {
            agent: Agent::Claude,
            role: CHAT_ROLE,
            cwd: &folder,
            server: &server,
        };
        let bin = lab.bin.path().to_path_buf();
        let result = open(&herdr, &launch, |program| Some(bin.join(program)));
        assert!(
            matches!(result, Err(LaunchError::Failed { message }) if message.contains("does not exist"))
        );
        assert!(!lab.bin.path().join("hc.args").exists());
    }

    const STUB_AGENT: &str = r#"#!/bin/sh
for arg in "$@"; do printf '%s\n' "$arg"; done > "$0.$$.args"
printf 'stub %s in %s\n' "$(basename "$0")" "$PWD"
while IFS= read -r line; do printf 'GOT:%s\n' "$line"; done
"#;

    fn stub_bin() -> tempfile::TempDir {
        let bin = tempfile::tempdir().unwrap();
        for tool in [CLAUDE, CODEX] {
            let script = bin.path().join(tool);
            std::fs::write(&script, STUB_AGENT).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        bin
    }

    fn stub_logs(bin: &Path, program: &str) -> Vec<PathBuf> {
        let mut logs: Vec<PathBuf> = std::fs::read_dir(bin)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                let name = path.file_name().unwrap().to_string_lossy();
                name.starts_with(&format!("{program}.")) && name.ends_with(".args")
            })
            .collect();
        logs.sort_by_key(|path| std::fs::metadata(path).unwrap().modified().unwrap());
        logs
    }

    fn received_args(bin: &Path, program: &str, before: usize) -> Vec<String> {
        crate::herdr::tests::wait_for("the stub to log its arguments", || {
            stub_logs(bin, program).len() > before
        });
        let text = std::fs::read_to_string(stub_logs(bin, program).last().unwrap()).unwrap();
        text.lines().map(String::from).collect()
    }

    #[test]
    #[ignore = "needs FATHOM_LAB_SESSION and FATHOM_LAB_SOCKET pointing at a throwaway herdr-core session"]
    fn opens_each_agent_in_a_lab() {
        use crate::herdr::View;
        use crate::herdr::tests::{screen_sink, wait_for};

        let connection = Connection {
            session: std::env::var("FATHOM_LAB_SESSION").expect("FATHOM_LAB_SESSION"),
            socket: std::env::var("FATHOM_LAB_SOCKET").expect("FATHOM_LAB_SOCKET"),
        };
        let herdr = Herdr::new(connection, Arc::new(|_| {}));
        let bin = stub_bin();
        let data = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let server = FathomServer {
            program: PathBuf::from("/Applications/Fathom.app/Contents/MacOS/fathom"),
            db: data.path().join("fathom.db"),
        };
        let config = data.path().join(MCP_CONFIG_FILE).display().to_string();
        let db = server.db.display().to_string();
        let cases = [
            (
                Agent::Claude,
                folder.path(),
                vec!["--mcp-config".to_string(), config.clone()],
            ),
            (
                Agent::Codex,
                folder.path(),
                vec![
                    "-c".to_string(),
                    format!(
                        r#"mcp_servers.fathom.command="{}""#,
                        server.program.display()
                    ),
                    "-c".to_string(),
                    format!(r#"mcp_servers.fathom.args=["--mcp","--db","{db}"]"#),
                ],
            ),
            (Agent::Firstmate, home.path(), vec![]),
        ];

        for (agent, cwd, expected_args) in cases {
            let launch = Launch {
                agent,
                role: CHAT_ROLE,
                cwd,
                server: &server,
            };
            let program = bin.path().join(agent.program());
            let logged_before = stub_logs(bin.path(), agent.program()).len();
            let terminal = open(&herdr, &launch, |name| {
                Some(bin.path().join(name)).filter(|path| path.is_file())
            })
            .unwrap();

            assert_eq!(
                terminal.labels.get(ROLE_KEY).map(String::as_str),
                Some(CHAT_ROLE)
            );
            assert_eq!(
                terminal.labels.get(AGENT_KEY).map(String::as_str),
                Some(agent.key())
            );
            assert_eq!(
                Path::new(&terminal.cwd).canonicalize().unwrap(),
                cwd.canonicalize().unwrap()
            );
            let got: serde_json::Value =
                serde_json::from_str(&herdr.run(&["get", &terminal.address, "--json"]).unwrap())
                    .unwrap();
            let mut argv = vec![program.display().to_string()];
            argv.extend(expected_args.iter().cloned());
            assert_eq!(got["argv"], json!(argv), "{got}");
            assert_eq!(
                received_args(bin.path(), agent.program(), logged_before),
                expected_args
            );
            assert_eq!(
                Path::new(&config).exists(),
                agent == Agent::Claude,
                "only Claude Code gets an MCP config file"
            );
            if agent == Agent::Claude {
                let written: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
                assert_eq!(
                    written["mcpServers"]["fathom"]["args"],
                    json!(["--mcp", "--db", db])
                );
                std::fs::remove_file(&config).unwrap();
            }

            let found = herdr
                .find_by_label(&chat_label())
                .unwrap()
                .expect("the chat terminal");
            assert_eq!(found.address, terminal.address);
            assert_eq!(
                found.labels.get(AGENT_KEY).map(String::as_str),
                Some(agent.key())
            );

            let (screen, sink) = screen_sink();
            herdr
                .attach(View::Chat, &terminal.address, 100, 30, sink)
                .unwrap();
            let seen =
                |text: &str| String::from_utf8_lossy(&screen.lock().unwrap().bytes).contains(text);
            wait_for("the stub's greeting", || seen("stub "));
            herdr.write_input(View::Chat, b"typed-in-fathom\r").unwrap();
            wait_for("the typed line", || seen("GOT:typed-in-fathom"));
            herdr
                .send(&terminal.address, "1 board request waiting")
                .unwrap();
            wait_for("the board-request nudge", || {
                seen("GOT:1 board request waiting")
            });
            let read = herdr.run(&["read", &terminal.address]).unwrap();
            assert!(read.contains("GOT:1 board request waiting"), "{read}");

            herdr.detach_all();
            herdr.run(&["kill", &terminal.address]).unwrap();
            wait_for("the terminal to finish", || {
                herdr
                    .find_by_label(&chat_label())
                    .unwrap()
                    .is_none_or(|t| t.address != terminal.address)
            });
        }
    }

    #[test]
    fn errors_reach_the_ui_tagged_by_kind() {
        let missing = serde_json::to_value(LaunchError::Missing {
            tool: "codex".into(),
        })
        .unwrap();
        assert_eq!(missing, json!({"kind": "missing", "tool": "codex"}));
        let agent: Agent = serde_json::from_value(json!("firstmate")).unwrap();
        assert_eq!(agent, Agent::Firstmate);
    }
}
