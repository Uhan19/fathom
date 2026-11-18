use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::db::{Column, Db, RowName, Snapshot};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Everything {
    schema_version: usize,
    exported_at_ms: i64,
    columns: Vec<Column>,
    row_names: Vec<RowName>,
    settings: Vec<(String, String)>,
    snapshot: Option<Snapshot>,
}

pub fn export(db: &Db, parent: &Path, now_ms: i64) -> Result<PathBuf, String> {
    let out = parent.join(format!("fathom-export-{now_ms}"));
    std::fs::create_dir_all(&out).map_err(|e| format!("cannot create {}: {e}", out.display()))?;
    let mut settings: Vec<(String, String)> = db.settings()?.into_iter().collect();
    settings.sort();
    let everything = Everything {
        schema_version: db.schema_version()?,
        exported_at_ms: now_ms,
        columns: db.columns()?,
        row_names: db.row_names()?,
        settings,
        snapshot: db.snapshot()?,
    };
    let json = serde_json::to_string_pretty(&everything).map_err(|e| e.to_string())?;
    std::fs::write(out.join("fathom.json"), json).map_err(|e| e.to_string())?;

    write_csv(
        &out.join("columns.csv"),
        &["project", "name", "position", "width", "collapsed"],
        |w| {
            for c in &everything.columns {
                w.write_record([
                    &c.project,
                    &c.name,
                    &c.position.to_string(),
                    &c.width.to_string(),
                    &c.collapsed.to_string(),
                ])?;
            }
            Ok(())
        },
    )?;
    write_csv(&out.join("row_names.csv"), &["row", "name"], |w| {
        for r in &everything.row_names {
            w.write_record([r.row.key(), &r.name])?;
        }
        Ok(())
    })?;
    write_csv(&out.join("settings.csv"), &["key", "value"], |w| {
        for (key, value) in &everything.settings {
            w.write_record([key, value])?;
        }
        Ok(())
    })?;
    write_csv(
        &out.join("snapshot_cards.csv"),
        &[
            "id",
            "title",
            "state",
            "kind",
            "project",
            "row",
            "hold_kind",
            "hold_until",
            "blocked_by",
            "links",
            "closed",
        ],
        |w| {
            for c in everything.snapshot.iter().flat_map(|s| &s.cards) {
                let links: Vec<String> = c
                    .links
                    .iter()
                    .map(|l| format!("{}:{}", l.kind, l.target))
                    .collect();
                w.write_record([
                    &c.id,
                    &c.title,
                    &c.state,
                    &c.kind,
                    &c.project,
                    c.row.key(),
                    &c.hold_kind,
                    &c.hold_until,
                    &c.blocked_by.join(","),
                    &links.join(","),
                    &c.closed,
                ])?;
            }
            Ok(())
        },
    )?;
    Ok(out)
}

fn write_csv(
    path: &Path,
    header: &[&str],
    body: impl FnOnce(&mut csv::Writer<std::fs::File>) -> Result<(), csv::Error>,
) -> Result<(), String> {
    let mut writer = csv::Writer::from_path(path).map_err(|e| e.to_string())?;
    writer.write_record(header).map_err(|e| e.to_string())?;
    body(&mut writer).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{Card, Link, Row};

    #[test]
    fn writes_json_and_csv() {
        let data = tempfile::tempdir().unwrap();
        let mut db = Db::open(data.path()).unwrap();
        db.ensure_columns(&["harbor".into()]).unwrap();
        db.set_row_name(Row::Seabed, "Not started").unwrap();
        db.set_setting("terminalLabel", "role=lead").unwrap();
        let card = Card {
            id: "harbor-lights".into(),
            title: "Fix the harbor lights, \"soon\"".into(),
            state: "in_flight".into(),
            kind: "ship".into(),
            project: "harbor".into(),
            row: Row::Shallows,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![Link {
                kind: "pr".into(),
                target: "https://example.com/pull/7".into(),
            }],
            closed: String::new(),
        };
        db.save_snapshot(&Snapshot {
            taken_at_ms: 1,
            home: "/fm".into(),
            cards: vec![card],
        })
        .unwrap();

        let target = tempfile::tempdir().unwrap();
        let out = export(&db, target.path(), 99).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(out.join("fathom.json")).unwrap())
                .unwrap();
        assert_eq!(json["columns"][0]["project"], "harbor");
        assert_eq!(json["rowNames"][3]["name"], "Not started");
        assert_eq!(json["snapshot"]["cards"][0]["id"], "harbor-lights");
        let cards = std::fs::read_to_string(out.join("snapshot_cards.csv")).unwrap();
        assert!(cards.contains("\"Fix the harbor lights, \"\"soon\"\"\""));
        assert!(cards.contains("pr:https://example.com/pull/7"));
        for name in ["columns.csv", "row_names.csv", "settings.csv"] {
            assert!(out.join(name).is_file());
        }
    }
}
