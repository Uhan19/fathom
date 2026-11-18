use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::db::{CardPlace, Column, Db, MoveRequest, RowName, Snapshot};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Everything {
    schema_version: usize,
    exported_at_ms: i64,
    columns: Vec<Column>,
    deleted_columns: Vec<Column>,
    row_names: Vec<RowName>,
    settings: Vec<(String, String)>,
    snapshot: Option<Snapshot>,
    card_places: Vec<CardPlace>,
    move_requests: Vec<MoveRequest>,
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
        deleted_columns: db.deleted_columns()?,
        row_names: db.row_names()?,
        settings,
        snapshot: db.snapshot()?,
        card_places: db.places()?,
        move_requests: db.all_requests()?,
    };
    let json = serde_json::to_string_pretty(&everything).map_err(|e| e.to_string())?;
    std::fs::write(out.join("fathom.json"), json).map_err(|e| e.to_string())?;

    write_csv(
        &out.join("columns.csv"),
        &[
            "id",
            "project",
            "name",
            "position",
            "width",
            "collapsed",
            "deleted",
        ],
        |w| {
            let shown = everything.columns.iter().map(|c| (c, false));
            let deleted = everything.deleted_columns.iter().map(|c| (c, true));
            for (c, deleted) in shown.chain(deleted) {
                w.write_record([
                    &c.id.to_string(),
                    c.project.as_deref().unwrap_or_default(),
                    &c.name,
                    &c.position.to_string(),
                    &c.width.to_string(),
                    &c.collapsed.to_string(),
                    &deleted.to_string(),
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
    write_csv(
        &out.join("card_places.csv"),
        &["card_id", "column", "row", "position"],
        |w| {
            for p in &everything.card_places {
                w.write_record([
                    &p.card_id,
                    &p.column.map(|id| id.to_string()).unwrap_or_default(),
                    p.row.key(),
                    &p.position.to_string(),
                ])?;
            }
            Ok(())
        },
    )?;
    write_csv(
        &out.join("move_requests.csv"),
        &[
            "request_id",
            "card_id",
            "title",
            "from_row",
            "to_row",
            "created_ms",
            "status",
            "note_id",
            "answer",
            "error",
        ],
        |w| {
            for r in &everything.move_requests {
                w.write_record([
                    &r.request_id,
                    &r.card_id,
                    &r.title,
                    r.from_row.key(),
                    r.to_row.key(),
                    &r.created_ms.to_string(),
                    r.status.key(),
                    r.note_id.as_deref().unwrap_or_default(),
                    r.answer.as_deref().unwrap_or_default(),
                    r.error.as_deref().unwrap_or_default(),
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
        db.add_column("Later").unwrap();
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
            cards: vec![card.clone()],
        })
        .unwrap();
        let later = db.columns().unwrap()[0].id;
        let mut reef = card.clone();
        reef.project = "reef".into();
        let seeded = db.ensure_columns(&[card, reef]).unwrap();
        let (harbor, reef) = (seeded[1].id, seeded[2].id);
        db.delete_column(reef, &[]).unwrap();
        db.place_cards(
            "harbor-lights",
            harbor,
            Row::Deep,
            &["harbor-lights".into()],
        )
        .unwrap();
        db.add_request(&MoveRequest {
            request_id: "fathom-move-harbor-lights-5".into(),
            card_id: "harbor-lights".into(),
            title: "Fix the harbor lights".into(),
            from_row: Row::Shallows,
            to_row: Row::Deep,
            created_ms: 5,
            status: crate::db::MoveStatus::Asked,
            note_id: Some("n-1".into()),
            answer: None,
            error: None,
        })
        .unwrap();

        let target = tempfile::tempdir().unwrap();
        let out = export(&db, target.path(), 99).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(out.join("fathom.json")).unwrap())
                .unwrap();
        assert_eq!(json["columns"][1]["project"], "harbor");
        assert_eq!(json["deletedColumns"][0]["project"], "reef");
        assert_eq!(json["cardPlaces"][0]["column"], harbor);
        let columns = std::fs::read_to_string(out.join("columns.csv")).unwrap();
        assert!(columns.contains(&format!("\n{harbor},harbor,harbor,1,240,false,false\n")));
        assert!(columns.contains(&format!("\n{later},,Later,0,240,false,false\n")));
        assert!(columns.contains(&format!("\n{reef},reef,reef,2,240,false,true\n")));
        assert_eq!(json["rowNames"][3]["name"], "Not started");
        assert_eq!(json["snapshot"]["cards"][0]["id"], "harbor-lights");
        assert_eq!(json["cardPlaces"][0]["row"], "deep");
        assert_eq!(json["moveRequests"][0]["status"], "asked");
        let cards = std::fs::read_to_string(out.join("snapshot_cards.csv")).unwrap();
        assert!(cards.contains("\"Fix the harbor lights, \"\"soon\"\"\""));
        assert!(cards.contains("pr:https://example.com/pull/7"));
        let requests = std::fs::read_to_string(out.join("move_requests.csv")).unwrap();
        assert!(requests.contains("fathom-move-harbor-lights-5,harbor-lights"));
        for name in [
            "columns.csv",
            "row_names.csv",
            "settings.csv",
            "card_places.csv",
        ] {
            assert!(out.join(name).is_file());
        }
    }
}
