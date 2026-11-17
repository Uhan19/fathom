use std::ffi::CStr;
use std::process::Command;
use std::sync::OnceLock;

const MARKER: &str = "__FATHOM_PATH__";

static PATH: OnceLock<String> = OnceLock::new();

pub fn get() -> &'static str {
    PATH.get_or_init(resolve)
}

pub fn find(program: &str) -> Option<std::path::PathBuf> {
    get()
        .split(':')
        .map(|dir| std::path::Path::new(dir).join(program))
        .find(|candidate| is_executable(candidate))
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

fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(passwd_shell)?;
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

    #[test]
    fn merge_keeps_order_and_drops_duplicates() {
        assert_eq!(
            merge("/usr/bin:/bin", "/opt/tools:/usr/bin:"),
            "/usr/bin:/bin:/opt/tools"
        );
    }

    #[test]
    fn shell_path_is_found_without_the_inherited_path() {
        let found = login_shell_path().expect("login shell path");
        assert!(found.contains("/usr/bin"));
    }
}
