use std::path::{Path, PathBuf};

use super::{ASSET_EXTENSIONS, check_asset_path, check_id};

pub const SCHEME: &str = "fathom-theme";
const NOT_FOUND: u16 = 404;
const OK: u16 = 200;
const ASSET_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'";

pub struct Asset {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl Asset {
    fn missing() -> Asset {
        Asset {
            status: NOT_FOUND,
            content_type: "text/plain",
            body: Vec::new(),
        }
    }

    pub fn into_response(self) -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(self.status)
            .header("Content-Type", self.content_type)
            .header("Content-Security-Policy", ASSET_POLICY)
            .header("Cache-Control", "no-cache")
            .header("Access-Control-Allow-Origin", "*")
            .body(self.body)
            .expect("a theme asset response is well formed")
    }
}

pub fn base(id: &str, version: &str) -> String {
    format!("{SCHEME}://localhost/{id}/{version}/")
}

pub fn serve(path: &str, folder_of: impl Fn(&str) -> Option<PathBuf>) -> Asset {
    let decoded = percent_decode(path.trim_start_matches('/'));
    let Some((id, versioned)) = decoded.split_once('/') else {
        return Asset::missing();
    };
    let Some((_version, file)) = versioned.split_once('/') else {
        return Asset::missing();
    };
    if check_id(id).is_err() || check_asset_path(file, &ASSET_EXTENSIONS).is_err() {
        return Asset::missing();
    }
    let Some(folder) = folder_of(id) else {
        return Asset::missing();
    };
    match std::fs::read(folder.join(file)) {
        Ok(body) => Asset {
            status: OK,
            content_type: content_type(Path::new(file)),
            body,
        },
        Err(_) => Asset::missing(),
    }
}

fn content_type(file: &Path) -> &'static str {
    match file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("css") => "text/css",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        _ => "application/octet-stream",
    }
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[i], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("art")).unwrap();
        std::fs::write(dir.path().join("theme.css"), "body{}").unwrap();
        std::fs::write(dir.path().join("art/mark one.svg"), "<svg/>").unwrap();
        std::fs::write(dir.path().join("theme.json"), "{}").unwrap();
        dir
    }

    fn path_of(url: &str) -> String {
        url.parse::<tauri::http::Uri>().unwrap().path().to_string()
    }

    #[test]
    fn serves_assets_of_a_known_theme_with_their_type() {
        let dir = folder();
        let lookup = |id: &str| (id == "riso").then(|| dir.path().to_path_buf());
        let css = serve(
            &path_of(&format!("{}theme.css", base("riso", "abc"))),
            lookup,
        );
        assert_eq!((css.status, css.content_type), (OK, "text/css"));
        assert_eq!(css.body, b"body{}");
        let art = serve(
            &path_of(&format!("{}art/mark%20one.svg", base("riso", "abc"))),
            lookup,
        );
        assert_eq!((art.status, art.content_type), (OK, "image/svg+xml"));
    }

    #[test]
    fn a_new_version_gives_every_asset_a_new_url() {
        let before = format!("{}art/mark.svg", base("riso", "abc"));
        let after = format!("{}art/mark.svg", base("riso", "def"));
        assert_ne!(before, after);
        let dir = folder();
        let lookup = |id: &str| (id == "riso").then(|| dir.path().to_path_buf());
        let css = serve(
            &path_of(&format!("{}theme.css", base("riso", "def"))),
            lookup,
        );
        assert_eq!(css.status, OK);
    }

    #[test]
    fn refuses_unknown_themes_traversal_hidden_files_and_non_assets() {
        let dir = folder();
        let lookup = |id: &str| (id == "riso").then(|| dir.path().to_path_buf());
        for path in [
            "/other/v/theme.css",
            "/riso/v/../riso/theme.css",
            "/riso/v/%2e%2e/secret.css",
            "/riso/v/theme.json",
            "/riso/v/.shots/board.png",
            "/riso/v//etc/passwd.css",
            "/riso/theme.css",
            "/riso",
            "/Riso/v/theme.css",
        ] {
            assert_eq!(serve(path, lookup).status, NOT_FOUND, "{path}");
        }
    }
}
