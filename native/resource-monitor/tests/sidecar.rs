use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{Value, json};

#[test]
fn writes_a_complete_real_process_round() {
    let directory =
        std::env::temp_dir().join(format!("pie-resource-monitor-{}", uuid::Uuid::new_v4()));
    let mut child = Command::new(env!("CARGO_BIN_EXE_pie-resource-monitor"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    send(
        &mut input,
        json!({
            "type": "configure",
            "schemaVersion": 1,
            "owner": { "pid": std::process::id() },
            "outputDirectory": directory,
            "sampleIntervalMs": 50,
        }),
    );
    let mut ready = String::new();
    output.read_line(&mut ready).unwrap();
    if ready.is_empty() {
        panic!(
            "sidecar stdout closed with status {:?}",
            child.wait().unwrap()
        );
    }
    assert_eq!(
        serde_json::from_str::<Value>(&ready).unwrap()["type"],
        "ready"
    );
    send(
        &mut input,
        json!({
            "type": "replace_roots",
            "schemaVersion": 1,
            "revision": 9,
            "roots": [{ "process": { "pid": std::process::id() }, "role": "daemon" }],
        }),
    );
    assert_eq!(event(&mut output)["revision"], 9);
    assert_eq!(event(&mut output)["status"], "available");
    send(&mut input, json!({ "type": "stop", "schemaVersion": 1 }));
    assert!(child.wait_timeout(Duration::from_secs(5)).unwrap());

    let path = fs::read_dir(&directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "jsonl")
        })
        .unwrap();
    let records = BufReader::new(fs::File::open(path).unwrap())
        .lines()
        .map(|line| serde_json::from_str::<Value>(&line.unwrap()).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(records.first().unwrap()["type"], "file_start");
    let samples = records
        .iter()
        .filter(|record| record["type"] == "os_sample")
        .collect::<Vec<_>>();
    assert!(samples.iter().any(|sample| {
        sample["process"]["pid"] == std::process::id() && sample["role"] == "daemon"
    }));
    assert!(samples.iter().any(|sample| sample["role"] == "sidecar"));
    let end = records
        .iter()
        .find(|record| record["type"] == "sample_end")
        .unwrap();
    assert_eq!(end["expectedRows"], samples.len());
    assert_eq!(end["rootRevision"], 9);
    assert_eq!(records.last().unwrap()["type"], "writer_stop");
    fs::remove_dir_all(directory).unwrap();
}

fn send(input: &mut impl Write, value: Value) {
    serde_json::to_writer(&mut *input, &value).unwrap();
    input.write_all(b"\n").unwrap();
    input.flush().unwrap();
}

fn event(output: &mut impl BufRead) -> Value {
    let mut line = String::new();
    output.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

trait WaitTimeout {
    fn wait_timeout(&mut self, timeout: Duration) -> std::io::Result<bool>;
}

impl WaitTimeout for std::process::Child {
    fn wait_timeout(&mut self, timeout: Duration) -> std::io::Result<bool> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if self.try_wait()?.is_some() {
                return Ok(true);
            }
            if std::time::Instant::now() >= deadline {
                self.kill()?;
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
