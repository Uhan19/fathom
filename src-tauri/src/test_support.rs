use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

// Written by a child so no test thread's fork inherits the write fd (ETXTBSY).
pub fn write_script(path: &Path, body: &str) {
    let mut writer = Command::new("/bin/sh")
        .args(["-c", r#"cat > "$1" && chmod 755 "$1""#, "write_script"])
        .arg(path)
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    writer
        .stdin
        .take()
        .unwrap()
        .write_all(body.as_bytes())
        .unwrap();
    assert!(writer.wait().unwrap().success(), "{}", path.display());
}
