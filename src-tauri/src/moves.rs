use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Deserialize;

use crate::db::{Db, MoveRequest, MoveStatus};
use crate::requests;
use crate::tasks::{Card, Row};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub card_id: String,
    pub title: String,
    pub column: i64,
    pub from_row: Row,
    pub to_row: Row,
    pub order: Vec<String>,
}

pub fn place(db: &Mutex<Db>, home: &Path, placement: Placement, now_ms: i64) -> Result<(), String> {
    let request = {
        let mut db = db.lock().unwrap();
        db.place_cards(
            &placement.card_id,
            placement.column,
            placement.to_row,
            &placement.order,
        )?;
        if placement.from_row == placement.to_row {
            return Ok(());
        }
        let request = MoveRequest {
            request_id: requests::request_id(&placement.card_id, now_ms),
            card_id: placement.card_id,
            title: placement.title,
            from_row: placement.from_row,
            to_row: placement.to_row,
            created_ms: now_ms,
            status: MoveStatus::Sending,
            note_id: None,
            answer: None,
            error: None,
        };
        db.add_request(&request)?;
        request
    };
    send(db, home, &request)?;
    let cards = cached_cards(db, home)?;
    reconcile(db, home, &cards)
}

pub fn resend(db: &Mutex<Db>, home: &Path, request_id: &str) -> Result<(), String> {
    let request = db.lock().unwrap().request(request_id)?;
    match request {
        Some(request) if request.status == MoveStatus::Failed => send(db, home, &request),
        Some(_) => Ok(()),
        None => Err(format!("no move request {request_id}")),
    }
}

pub fn reconcile(db: &Mutex<Db>, home: &Path, cards: &[Card]) -> Result<(), String> {
    let waiting: Vec<MoveRequest> = db
        .lock()
        .unwrap()
        .open_requests()?
        .into_iter()
        .filter(|r| matches!(r.status, MoveStatus::Asked | MoveStatus::Failed))
        .collect();
    if waiting.is_empty() {
        return Ok(());
    }
    let replies: HashMap<String, String> = if waiting.iter().any(|r| r.note_id.is_some()) {
        requests::replies(home).unwrap_or_else(|error| {
            eprintln!("fathom: cannot read Firstmate's replies: {error}");
            HashMap::new()
        })
    } else {
        HashMap::new()
    };
    let db = db.lock().unwrap();
    for request in waiting {
        match settle(&request, &replies, cards) {
            Some(Settlement::Answered(answer)) => {
                db.answer_request(&request.request_id, &answer)?
            }
            Some(Settlement::Landed) => {
                db.set_request_status(&request.request_id, MoveStatus::Landed)?
            }
            None => {}
        }
    }
    Ok(())
}

fn send(db: &Mutex<Db>, home: &Path, request: &MoveRequest) -> Result<(), String> {
    let body = requests::move_body(
        &request.card_id,
        &request.title,
        request.from_row,
        request.to_row,
    );
    let outcome = requests::send_note(home, &request.request_id, &body);
    db.lock()
        .unwrap()
        .finish_send(&request.request_id, &outcome)
}

pub fn cached_cards(db: &Mutex<Db>, home: &Path) -> Result<Vec<Card>, String> {
    let home = home.display().to_string();
    let db = db.lock().unwrap();
    let mut cards = db
        .snapshot()?
        .filter(|s| s.home == home)
        .map(|s| s.cards)
        .unwrap_or_default();
    db.number_cards(&home, &mut cards)?;
    Ok(cards)
}

#[derive(Debug, PartialEq)]
enum Settlement {
    Answered(String),
    Landed,
}

fn settle(
    request: &MoveRequest,
    replies: &HashMap<String, String>,
    cards: &[Card],
) -> Option<Settlement> {
    let answer = request.note_id.as_ref().and_then(|id| replies.get(id));
    if let Some(answer) = answer.filter(|_| request.status == MoveStatus::Asked) {
        return Some(Settlement::Answered(answer.clone()));
    }
    cards
        .iter()
        .any(|c| c.id == request.card_id && c.row == request.to_row)
        .then_some(Settlement::Landed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Snapshot;
    use crate::test_support::write_script;

    const FAKE_INBOX: &str = r#"#!/bin/sh
case "$1" in
note)
  if [ -e "$FM_HOME/offline" ]; then echo 'fm-inbox: no inbox' >&2; exit 1; fi
  cat > "$FM_HOME/body"
  printf '%s\n' "$*" >> "$FM_HOME/calls"
  echo '{"schema":"fm-inbox-note.v1","outcome":"created","id":"n-1","saved":true,"announced":true}' ;;
receipts)
  printf '{"replies":%s}\n' "$(cat "$FM_HOME/replies" 2>/dev/null || echo '[]')" ;;
esac
"#;

    fn lab(cards: Vec<Card>) -> (tempfile::TempDir, Mutex<Db>) {
        let home = tempfile::tempdir().unwrap();
        let script = home.path().join("bin/fm-inbox.sh");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        write_script(&script, FAKE_INBOX);
        let db = Db::open(&home.path().join("data")).unwrap();
        db.save_snapshot(&Snapshot {
            taken_at_ms: 1,
            home: home.path().display().to_string(),
            cards,
        })
        .unwrap();
        (home, Mutex::new(db))
    }

    fn read(home: &Path, name: &str) -> String {
        std::fs::read_to_string(home.join(name)).unwrap_or_default()
    }

    fn placement(from_row: Row, to_row: Row) -> Placement {
        Placement {
            card_id: "atl-12".into(),
            title: "Fix the\n  reef map".into(),
            column: 1,
            from_row,
            to_row,
            order: vec!["atl-12".into()],
        }
    }

    fn only_request(db: &Mutex<Db>) -> MoveRequest {
        let all = db.lock().unwrap().all_requests().unwrap();
        assert_eq!(all.len(), 1, "{all:?}");
        all.into_iter().next().unwrap()
    }

    const SENT: &str = "note --request-id fathom-move-atl-12-1000 --json -\n";

    #[test]
    fn a_row_change_asks_firstmate_and_a_reply_answers_it() {
        let (home, db) = lab(vec![card("atl-12", Row::Seabed)]);
        place(
            &db,
            home.path(),
            placement(Row::Seabed, Row::Shallows),
            1000,
        )
        .unwrap();
        assert_eq!(
            read(home.path(), "body"),
            "Fathom board request: move atl-12 \"Fix the reef map\" from seabed to shallows"
        );
        assert_eq!(read(home.path(), "calls"), SENT);
        let asked = only_request(&db);
        assert_eq!(asked.status, MoveStatus::Asked);
        assert_eq!(asked.note_id.as_deref(), Some("n-1"));
        let places = db.lock().unwrap().places().unwrap();
        assert_eq!(places.len(), 1);
        assert_eq!((places[0].row, places[0].position), (Row::Shallows, 0));

        std::fs::write(
            home.path().join("replies"),
            r#"[{"id":"n-1","body":"Not yet: it waits on atl-11.\n"}]"#,
        )
        .unwrap();
        reconcile(&db, home.path(), &[card("atl-12", Row::Seabed)]).unwrap();
        let answered = only_request(&db);
        assert_eq!(answered.status, MoveStatus::Answered);
        assert_eq!(
            answered.answer.as_deref(),
            Some("Not yet: it waits on atl-11.")
        );
    }

    #[test]
    fn the_task_list_catching_up_lands_the_move() {
        let (home, db) = lab(vec![card("atl-12", Row::Seabed)]);
        place(
            &db,
            home.path(),
            placement(Row::Seabed, Row::Shallows),
            1000,
        )
        .unwrap();
        reconcile(&db, home.path(), &[card("atl-12", Row::Shallows)]).unwrap();
        assert_eq!(only_request(&db).status, MoveStatus::Landed);
    }

    #[test]
    fn reordering_within_a_row_asks_nothing() {
        let (home, db) = lab(vec![card("atl-12", Row::Seabed)]);
        place(&db, home.path(), placement(Row::Seabed, Row::Seabed), 1000).unwrap();
        assert_eq!(read(home.path(), "calls"), "");
        assert!(db.lock().unwrap().all_requests().unwrap().is_empty());
        assert_eq!(db.lock().unwrap().places().unwrap()[0].row, Row::Seabed);
    }

    #[test]
    fn a_failed_send_is_kept_and_resent_under_the_same_request_id() {
        let (home, db) = lab(vec![card("atl-12", Row::Seabed)]);
        std::fs::write(home.path().join("offline"), "").unwrap();
        place(&db, home.path(), placement(Row::Seabed, Row::Deep), 1000).unwrap();
        let failed = only_request(&db);
        assert_eq!(failed.status, MoveStatus::Failed);
        assert_eq!(failed.error.as_deref(), Some("fm-inbox: no inbox"));
        assert_eq!(read(home.path(), "calls"), "");

        std::fs::remove_file(home.path().join("offline")).unwrap();
        resend(&db, home.path(), &failed.request_id).unwrap();
        assert_eq!(only_request(&db).status, MoveStatus::Asked);
        resend(&db, home.path(), &failed.request_id).unwrap();
        assert_eq!(read(home.path(), "calls"), SENT);
        assert!(resend(&db, home.path(), "fathom-move-gone-1").is_err());
    }

    #[test]
    fn moving_a_card_back_to_its_task_row_settles_at_once() {
        let (home, db) = lab(vec![card("atl-12", Row::Seabed)]);
        place(
            &db,
            home.path(),
            placement(Row::Shallows, Row::Seabed),
            1000,
        )
        .unwrap();
        assert_eq!(read(home.path(), "calls"), SENT);
        assert_eq!(only_request(&db).status, MoveStatus::Landed);
    }

    fn card(id: &str, row: Row) -> Card {
        Card {
            id: id.into(),
            title: id.into(),
            state: String::new(),
            kind: String::new(),
            project: "reef".into(),
            row,
            hold_kind: String::new(),
            hold_until: String::new(),
            hold_reason: String::new(),
            blocked_by: vec![],
            links: vec![],
            closed: String::new(),
            number: None,
        }
    }

    fn asked(card_id: &str, to: Row, status: MoveStatus) -> MoveRequest {
        MoveRequest {
            request_id: format!("r-{card_id}"),
            card_id: card_id.into(),
            title: card_id.into(),
            from_row: Row::Seabed,
            to_row: to,
            created_ms: 1,
            status,
            note_id: (status == MoveStatus::Asked).then(|| format!("n-{card_id}")),
            answer: None,
            error: None,
        }
    }

    #[test]
    fn a_request_settles_on_a_reply_first_then_on_the_task_list() {
        let replies = HashMap::from([("n-a".to_string(), "Not yet.".to_string())]);
        let cards = [
            card("a", Row::Shallows),
            card("b", Row::Shallows),
            card("c", Row::Seabed),
        ];
        let settle_one = |r: MoveRequest| settle(&r, &replies, &cards);
        assert_eq!(
            settle_one(asked("a", Row::Shallows, MoveStatus::Asked)),
            Some(Settlement::Answered("Not yet.".into()))
        );
        assert_eq!(
            settle_one(asked("b", Row::Shallows, MoveStatus::Asked)),
            Some(Settlement::Landed)
        );
        assert_eq!(
            settle_one(asked("c", Row::Shallows, MoveStatus::Asked)),
            None
        );
        assert_eq!(
            settle_one(asked("b", Row::Shallows, MoveStatus::Failed)),
            Some(Settlement::Landed)
        );
        assert_eq!(
            settle_one(asked("missing", Row::Deep, MoveStatus::Asked)),
            None
        );
    }
}
