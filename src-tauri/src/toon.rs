use std::collections::HashMap;

pub type Record = HashMap<String, String>;

const EMPTY_MARKERS: [&str; 2] = ["-", "none"];

pub fn parse_list(text: &str) -> Result<Vec<Record>, String> {
    let mut lines = text.lines();
    let fields = loop {
        let Some(line) = lines.next() else {
            return Ok(Vec::new());
        };
        if let Some(fields) = table_header(line) {
            break fields;
        }
    };
    let mut records = Vec::new();
    for line in lines {
        let Some(row) = line.strip_prefix("  ") else {
            break;
        };
        let values = split_row(row)?;
        if values.len() != fields.len() {
            return Err(format!(
                "row has {} values but the header has {} fields: {row}",
                values.len(),
                fields.len()
            ));
        }
        records.push(fields.iter().cloned().zip(values).collect());
    }
    Ok(records)
}

pub fn parse_object(text: &str, name: &str) -> Result<Record, String> {
    let header = format!("{name}:");
    let mut lines = text.lines().skip_while(|line| line.trim_end() != header);
    if lines.next().is_none() {
        return Err(error_message(text));
    }
    let mut record = Record::new();
    for line in lines {
        let Some(entry) = line.strip_prefix("  ") else {
            break;
        };
        let Some((key, raw)) = entry.split_once(": ") else {
            continue;
        };
        let mut chars = raw.chars().peekable();
        record.insert(key.to_string(), read_value(&mut chars)?);
    }
    Ok(record)
}

pub fn error_message(text: &str) -> String {
    text.lines()
        .find_map(|line| line.strip_prefix("error: "))
        .map(|raw| read_value(&mut raw.chars().peekable()).unwrap_or_else(|_| raw.to_string()))
        .unwrap_or_else(|| text.trim().to_string())
}

fn table_header(line: &str) -> Option<Vec<String>> {
    let rest = line.strip_prefix("tasks[")?;
    let open = rest.find("]{")?;
    let fields = rest[open + 2..].strip_suffix("}:")?;
    Some(fields.split(',').map(str::to_string).collect())
}

fn split_row(row: &str) -> Result<Vec<String>, String> {
    let mut chars = row.chars().peekable();
    let mut values = Vec::new();
    loop {
        values.push(read_value(&mut chars)?);
        match chars.next() {
            None => return Ok(values),
            Some(',') => {}
            Some(other) => return Err(format!("unexpected '{other}' after a value in: {row}")),
        }
    }
}

fn read_value(chars: &mut std::iter::Peekable<std::str::Chars>) -> Result<String, String> {
    let value = if chars.peek() == Some(&'"') {
        chars.next();
        read_quoted(chars)?
    } else {
        let mut plain = String::new();
        while let Some(&c) = chars.peek() {
            if c == ',' {
                break;
            }
            plain.push(c);
            chars.next();
        }
        plain
    };
    Ok(if EMPTY_MARKERS.contains(&value.as_str()) {
        String::new()
    } else {
        value
    })
}

fn read_quoted(chars: &mut std::iter::Peekable<std::str::Chars>) -> Result<String, String> {
    let mut out = String::new();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Ok(out),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some(other) => out.push(other),
                None => break,
            },
            other => out.push(other),
        }
    }
    Err("unterminated quoted value".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"count: 3
tasks[3]{id,state,kind,repo,title,hold_kind,blocked_by}:
  alpha-one,in_flight,ship,harbor,"Fix the \"tide\" gauge, then ship","-",none
  beta-two,queued,scout,harbor,Plain title without quotes,parked,"alpha-one,gamma-three"
  gamma-three,queued,ship,reef,"A long title that the list cut short at eighty characters so it en\n... (truncated, 120 chars total - use show gamma-three --full to see complete text)",captain,none
help[1]: Run `tasks-axi show <id>` for details
"#;

    #[test]
    fn parses_rows_with_quotes_escapes_and_empty_markers() {
        let rows = parse_list(LIST).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["title"], "Fix the \"tide\" gauge, then ship");
        assert_eq!(rows[0]["hold_kind"], "");
        assert_eq!(rows[0]["blocked_by"], "");
        assert_eq!(rows[1]["title"], "Plain title without quotes");
        assert_eq!(rows[1]["blocked_by"], "alpha-one,gamma-three");
        assert!(rows[2]["title"].contains("\n... (truncated"));
    }

    #[test]
    fn empty_list_has_no_rows() {
        let text =
            "count: 0\ntasks: 0 repo=nowhere tasks in this backlog\nhelp[1]:\n  - Run something\n";
        assert!(parse_list(text).unwrap().is_empty());
    }

    #[test]
    fn rejects_rows_that_do_not_match_the_header() {
        let text = "tasks[1]{id,state}:\n  only-id\n";
        assert!(parse_list(text).is_err());
    }

    #[test]
    fn parses_show_object() {
        let text = "task:\n  id: alpha-one\n  title: \"Fix the gauge\\nsecond line\"\n  hold_until: none\n  links: \"pr:https://example.com/pull/1,report:data/alpha-one/report.md\"\n";
        let record = parse_object(text, "task").unwrap();
        assert_eq!(record["id"], "alpha-one");
        assert_eq!(record["title"], "Fix the gauge\nsecond line");
        assert_eq!(record["hold_until"], "");
        assert!(record["links"].starts_with("pr:https://"));
    }

    #[test]
    fn surfaces_error_text() {
        let text = "error: \"Task \\\"nope\\\" not found in this backlog\"\ncode: NOT_FOUND\n";
        assert_eq!(
            parse_object(text, "task").unwrap_err(),
            "Task \"nope\" not found in this backlog"
        );
    }
}
