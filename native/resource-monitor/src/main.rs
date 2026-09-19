mod protocol;
mod sampler;
mod writer;

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use protocol::{Command, Event, ProcessIdentity, Root, SCHEMA_VERSION, WriterIdentity};
use sampler::Sampler;
use writer::ResourceWriter;

const MAX_CONTROL_LINE: u64 = 64 * 1024;
const MAX_ROOTS: usize = 256;

fn main() {
    if let Err(reason) = run() {
        eprintln!("resource-monitor: {reason}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), &'static str> {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let configure = read_command(&mut reader)?.ok_or("missing configure command")?;
    let Command::Configure {
        schema_version,
        owner,
        output_directory,
        sample_interval_ms,
    } = configure
    else {
        return Err("first command must configure");
    };
    if schema_version != SCHEMA_VERSION || sample_interval_ms == 0 {
        return Err("unsupported configure command");
    }

    let process = ProcessIdentity {
        pid: std::process::id(),
        parent_pid: None,
        birth: None,
    };
    let identity = WriterIdentity {
        instance_id: uuid::Uuid::new_v4().to_string(),
        process: process.clone(),
    };
    let mut writer = ResourceWriter::open(PathBuf::from(output_directory), identity)
        .map_err(|_| "writer unavailable")?;
    emit(&Event::Ready {
        schema_version: SCHEMA_VERSION,
        process,
    })?;

    drop(reader);
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        while let Ok(Some(command)) = read_command(&mut reader) {
            if sender.send(command).is_err() {
                break;
            }
        }
    });

    let mut sampler = Sampler::new();
    let mut roots = vec![Root {
        process: owner.clone(),
        role: "daemon".to_owned(),
    }];
    let mut revision = 0_u64;
    let interval = Duration::from_millis(sample_interval_ms);

    loop {
        match receiver.recv_timeout(interval) {
            Ok(Command::ReplaceRoots {
                schema_version,
                revision: next_revision,
                roots: next_roots,
            }) if schema_version == SCHEMA_VERSION && next_roots.len() <= MAX_ROOTS => {
                roots = next_roots;
                revision = next_revision;
                emit(&Event::RootsApplied {
                    schema_version: SCHEMA_VERSION,
                    revision,
                })?;
            }
            Ok(Command::Stop { schema_version }) if schema_version == SCHEMA_VERSION => break,
            Ok(Command::Configure { .. } | Command::ReplaceRoots { .. } | Command::Stop { .. }) => {
                emit(&Event::Status {
                    schema_version: SCHEMA_VERSION,
                    status: "paused",
                    reason: Some("invalid-control"),
                    last_sampled_at: None,
                    last_written_at: None,
                    dropped_rounds: 0,
                })?;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !sampler.owner_matches(&owner) {
                    break;
                }
                let round = sampler.sample(&roots);
                let sampled_at = round.sampled_at.clone();
                match writer.write(round, revision) {
                    Ok(written_at) => emit(&Event::Status {
                        schema_version: SCHEMA_VERSION,
                        status: "available",
                        reason: None,
                        last_sampled_at: Some(sampled_at),
                        last_written_at: Some(written_at),
                        dropped_rounds: 0,
                    })?,
                    Err(_) => emit(&Event::Status {
                        schema_version: SCHEMA_VERSION,
                        status: "paused",
                        reason: Some("writer-io"),
                        last_sampled_at: Some(sampled_at),
                        last_written_at: None,
                        dropped_rounds: 1,
                    })?,
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    writer.stop();
    Ok(())
}

fn read_command(reader: &mut impl BufRead) -> Result<Option<Command>, &'static str> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().map_err(|_| "control read failed")?;
        if buffer.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("unterminated control line")
            };
        }
        let length = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffer.len(), |index| index + 1);
        if line.len() + length > MAX_CONTROL_LINE as usize {
            return Err("control line too large");
        }
        line.extend_from_slice(&buffer[..length]);
        reader.consume(length);
        if line.ends_with(b"\n") {
            break;
        }
    }
    serde_json::from_slice(&line)
        .map(Some)
        .map_err(|_| "invalid control json")
}

fn emit(event: &Event) -> Result<(), &'static str> {
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, event).map_err(|_| "event encode failed")?;
    stdout.write_all(b"\n").map_err(|_| "event write failed")?;
    stdout.flush().map_err(|_| "event flush failed")
}
