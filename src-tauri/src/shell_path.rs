use std::ffi::CStr;
use std::process::Command;
use std::sync::OnceLock;

const MARKER: &str = "__FATHOM_PATH__";
#[cfg(target_os = "macos")]
pub const DEFAULT_SHELL: &str = "/bin/zsh";
#[cfg(not(target_os = "macos"))]
pub const DEFAULT_SHELL: &str = "/bin/sh";

static PATH: OnceLock<String> = OnceLock::new();

pub fn get() -> &'static str {
    PATH.get_or_init(resolve)
}

pub fn find_first(programs: &[&str]) -> Option<std::path::PathBuf> {
    find_first_in(get(), programs)
}

fn find_first_in(path: &str, programs: &[&str]) -> Option<std::path::PathBuf> {
    programs.iter().find_map(|program| {
        path.split(':')
            .map(|dir| std::path::Path::new(dir).join(program))
            .find(|candidate| is_executable(candidate))
    })
}

fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

fn resolve() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let from_shell = login_shell_path().unwrap_or_default();
    merge(&inherited, &from_shell)
}

fn merge(first: &str, second: &str) -> String {
    let mut seen = Vec::<&str>::new();
    for entry in first.split(':').chain(second.split(':')) {
        if !entry.is_empty() && !seen.contains(&entry) {
            seen.push(entry);
        }
    }
    seen.join(":")
}

pub fn login_shell() -> Option<String> {
    std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(passwd_shell)
}

pub fn user_shell() -> std::path::PathBuf {
    choose_shell(std::env::var("SHELL").ok(), passwd_shell())
}

pub(crate) fn choose_shell(env: Option<String>, passwd: Option<String>) -> std::path::PathBuf {
    [env, passwd]
        .into_iter()
        .flatten()
        .map(std::path::PathBuf::from)
        .find(|shell| shell.is_absolute() && is_executable(shell))
        .unwrap_or_else(|| std::path::PathBuf::from(DEFAULT_SHELL))
}

fn login_shell_path() -> Option<String> {
    let shell = login_shell()?;
    let script = format!("printf '%s%s%s' {MARKER} \"$PATH\" {MARKER}");
    let output = Command::new(shell)
        .args(["-l", "-i", "-c", &script])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let start = text.find(MARKER)? + MARKER.len();
    let end = start + text[start..].find(MARKER)?;
    Some(text[start..end].to_string())
}

fn passwd_shell() -> Option<String> {
    // SAFETY: getpwuid returns a pointer into static storage that stays valid until the next call on this thread.
    unsafe {
        let entry = libc::getpwuid(libc::getuid());
        if entry.is_null() || (*entry).pw_shell.is_null() {
            return None;
        }
        CStr::from_ptr((*entry).pw_shell)
            .to_str()
            .ok()
            .map(str::to_string)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn merge_keeps_order_and_drops_duplicates() {
        assert_eq!(
            merge("/usr/bin:/bin", "/opt/tools:/usr/bin:"),
            "/usr/bin:/bin:/opt/tools"
        );
    }

    fn executable(dir: &std::path::Path, name: &str) {
        let file = dir.join(name);
        crate::test_support::write_script(&file, "#!/bin/sh\n");
    }

    #[test]
    fn finds_the_first_program_anywhere_on_the_path_before_the_next() {
        let early = tempfile::tempdir().unwrap();
        let late = tempfile::tempdir().unwrap();
        executable(early.path(), "hc");
        let path = format!("{}:{}", early.path().display(), late.path().display());
        let programs = ["herdr-core", "hc"];
        assert_eq!(
            find_first_in(&path, &programs),
            Some(early.path().join("hc"))
        );
        executable(late.path(), "herdr-core");
        assert_eq!(
            find_first_in(&path, &programs),
            Some(late.path().join("herdr-core"))
        );
    }

    #[test]
    fn the_shell_comes_from_shell_then_the_passwd_entry_then_the_system_default() {
        let dir = tempfile::tempdir().unwrap();
        executable(dir.path(), "fish");
        executable(dir.path(), "bash");
        let fish = dir.path().join("fish").display().to_string();
        let bash = dir.path().join("bash").display().to_string();
        let gone = dir.path().join("gone").display().to_string();
        let chosen = |env: Option<&str>, passwd: Option<&str>| {
            choose_shell(env.map(String::from), passwd.map(String::from))
        };
        assert_eq!(chosen(Some(&fish), Some(&bash)), PathBuf::from(&fish));
        assert_eq!(chosen(None, Some(&bash)), PathBuf::from(&bash));
        assert_eq!(chosen(Some(""), Some(&bash)), PathBuf::from(&bash));
        assert_eq!(chosen(Some(&gone), Some(&bash)), PathBuf::from(&bash));
        assert_eq!(chosen(Some("fish"), None), PathBuf::from(DEFAULT_SHELL));
        assert_eq!(chosen(None, None), PathBuf::from(DEFAULT_SHELL));
        assert_eq!(
            chosen(Some(&gone), Some(&gone)),
            PathBuf::from(DEFAULT_SHELL)
        );
    }

    #[test]
    fn skips_files_that_are_not_executable() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("hc"), "").unwrap();
        let path = dir.path().display().to_string();
        assert_eq!(find_first_in(&path, &["hc"]), None);
    }

    #[test]
    fn shell_path_is_found_without_the_inherited_path() {
        let found = login_shell_path().expect("login shell path");
        assert!(found.contains("/usr/bin"));
    }
}
