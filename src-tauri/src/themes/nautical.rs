use std::collections::BTreeMap;

use super::{
    Art, CONTRACT_VERSION, Fonts, Layout, MANIFEST_FILE, Manifest, Mode, NAUTICAL, STYLE_FILE,
    Text, Themes, write_files,
};

const APP_STYLES: &str = include_str!("../../../src/styles.css");
const TOKEN_SELECTOR: &str = ":root";
const KEPT_PROPERTIES: [&str; 1] = ["color-scheme"];

pub fn nautical_manifest(name: &str) -> Manifest {
    Manifest {
        fathom_theme: CONTRACT_VERSION,
        name: name.to_string(),
        cloned_from: Some(NAUTICAL.to_string()),
        modes: vec![Mode::Light, Mode::Dark],
        fonts: Fonts::default(),
        text: Text {
            brand: Some("FATHOM".into()),
            helper: Some("Bosun".into()),
            projects: Some("Projects →".into()),
            surface_lead: Some("At the ".into()),
            shallows_lead: Some("In the ".into()),
        },
        art: Art::default(),
        layout: Layout::default(),
    }
}

pub fn nautical_tokens() -> String {
    token_blocks(APP_STYLES)
}

pub fn duplicate_nautical(themes: &Themes, name: &str) -> Result<String, String> {
    let id = themes.free_id(name);
    let manifest =
        serde_json::to_string_pretty(&nautical_manifest(name.trim())).map_err(|e| e.to_string())?;
    let files = BTreeMap::from([
        (MANIFEST_FILE.to_string(), format!("{manifest}\n")),
        (STYLE_FILE.to_string(), nautical_tokens()),
    ]);
    write_files(&themes.root.join(&id), &files)?;
    Ok(id)
}

fn token_blocks(css: &str) -> String {
    let mut out = String::new();
    let mut rest = css;
    while let Some(open) = rest.find('{') {
        let selector = rest[..open]
            .rsplit('}')
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        let Some(close) = rest[open..].find('}') else {
            break;
        };
        let body = &rest[open + 1..open + close];
        rest = &rest[open + close + 1..];
        let is_token_block = !selector.is_empty()
            && selector
                .split(',')
                .all(|s| s.trim().starts_with(TOKEN_SELECTOR));
        if !is_token_block || body.contains('{') {
            continue;
        }
        let declarations: Vec<&str> = body
            .split(';')
            .map(str::trim)
            .filter(|d| d.starts_with("--") || KEPT_PROPERTIES.iter().any(|p| d.starts_with(p)))
            .collect();
        if declarations.is_empty() {
            continue;
        }
        out.push_str(&selector);
        out.push_str(" {\n");
        for declaration in declarations {
            out.push_str("  ");
            out.push_str(declaration);
            out.push_str(";\n");
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string() + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::{check_folder, read_manifest};

    #[test]
    fn copies_only_the_token_declarations_of_root_blocks() {
        let css = ":root {\n  --ink: #111;\n  color: var(--ink);\n}\n\n:root,\n:root[data-mode=\"light\"] {\n  color-scheme: light;\n  --page: #eee;\n}\n\n.card { --local: 1px; }\n";
        assert_eq!(
            token_blocks(css),
            ":root {\n  --ink: #111;\n}\n\n:root,\n:root[data-mode=\"light\"] {\n  color-scheme: light;\n  --page: #eee;\n}\n"
        );
    }

    #[test]
    fn the_app_tokens_cover_both_modes_and_the_terminal() {
        let tokens = nautical_tokens();
        for needle in [
            ":root[data-mode=\"dark\"] {",
            "--page:",
            "--term-background:",
            "--sailor-visor:",
            "--heading:",
        ] {
            assert!(tokens.contains(needle), "{needle}");
        }
        assert!(!tokens.contains("font-size"));
    }

    #[test]
    fn a_duplicate_is_a_complete_editable_theme() {
        let dir = tempfile::tempdir().unwrap();
        let themes = Themes::new(dir.path().join("themes"), &dir.path().join("data"));
        let id = duplicate_nautical(&themes, "Nautical").unwrap();
        assert_eq!(id, "nautical-2");
        let folder = themes.root.join(&id);
        let manifest = read_manifest(&folder).unwrap();
        assert_eq!(manifest.cloned_from.as_deref(), Some(NAUTICAL));
        assert_eq!(manifest.text.helper.as_deref(), Some("Bosun"));
        let (_, findings) = check_folder(&folder);
        assert!(findings.is_empty(), "{findings:?}");
        assert_eq!(
            duplicate_nautical(&themes, "Nautical").unwrap(),
            "nautical-3"
        );
    }
}
