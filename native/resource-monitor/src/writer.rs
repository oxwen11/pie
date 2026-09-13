use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use fs2::FileExt;
use serde_json::{Map, Value, json};

use crate::protocol::{SCHEMA_VERSION, WriterIdentity};
use crate::sampler::{SampleRound, now};

const LINE_LIMIT: usize = 64 * 1024;
const ROUND_LIMIT: usize = 1024 * 1024;
const FILE_LIMIT: u64 = 16 * 1024 * 1024;
const SOURCE_LIMIT: u64 = 64 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const FILE_OPEN_LIMIT: Duration = Duration::from_secs(60 * 60);
const FILE_COUNT_LIMIT: usize = 256;

struct ActiveFile {
    name: String,
    writer: BufWriter<File>,
    size: u64,
    created_at: SystemTime,
    retention_start: SystemTime,
}

struct Entry {
    name: String,
    size: u64,
    created_at: SystemTime,
    deletable: bool,
}

pub struct ResourceWriter {
    directory: PathBuf,
    source: &'static str,
    identity: WriterIdentity,
    _lock: File,
    active: Option<ActiveFile>,
    sequence: u64,
    dropped_rounds: u64,
}

impl ResourceWriter {
    pub fn open(directory: PathBuf, identity: WriterIdentity) -> Result<Self, String> {
        create_directory(&directory)?;
        let lock_path = directory.join(".writer.lock");
        let lock = owner_file(&lock_path, true)?;
        lock.try_lock_exclusive()
            .map_err(|_| "writer-lock-unavailable".to_owned())?;
        let mut writer = Self {
            directory,
            source: "os",
            identity,
            _lock: lock,
            active: None,
            sequence: 0,
            dropped_rounds: 0,
        };
        writer.maintain(SystemTime::now())?;
        Ok(writer)
    }

    pub fn write(&mut self, round: SampleRound, root_revision: u64) -> Result<String, String> {
        let sequence = self.sequence;
        self.sequence = self.sequence.saturating_add(1);
        let payload = encode_round(
            &round,
            &self.identity,
            sequence,
            root_revision,
            self.dropped_rounds,
        )?;
        let sampled_at = parse_time(&round.sampled_at)?;
        if let Err(error) = self.write_payload(&payload, sampled_at) {
            self.dropped_rounds = self.dropped_rounds.saturating_add(1);
            return Err(error);
        }
        self.dropped_rounds = 0;
        Ok(now())
    }

    pub fn stop(&mut self) {
        let record = line(&json!({
            "schemaVersion": SCHEMA_VERSION,
            "type": "writer_stop",
            "source": self.source,
            "writer": self.identity,
            "writtenAt": now(),
            "droppedRounds": self.dropped_rounds,
        }));
        if let (Some(active), Ok(record)) = (self.active.as_mut(), record)
            && active.size + record.len() as u64 <= FILE_LIMIT
        {
            let _ = active.writer.write_all(&record);
            let _ = active.writer.flush();
        }
        let _ = self.close_active();
    }

    fn write_payload(&mut self, payload: &[u8], sampled_at: SystemTime) -> Result<(), String> {
        let current = SystemTime::now();
        let rotate = self.active.as_ref().is_some_and(|active| {
            active.size + payload.len() as u64 > FILE_LIMIT
                || current
                    .duration_since(active.created_at)
                    .unwrap_or_default()
                    >= FILE_OPEN_LIMIT
                || sampled_at < active.retention_start
                || current
                    .duration_since(active.retention_start)
                    .unwrap_or_default()
                    >= RETENTION
        });
        if rotate {
            self.close_active()?;
        }
        if self.active.is_none() {
            self.open_file(payload.len() as u64, sampled_at)?;
        } else if !self.reserve(payload.len() as u64, false)? {
            self.close_active()?;
            self.open_file(payload.len() as u64, sampled_at)?;
        }
        let active = self.active.as_mut().ok_or_else(|| "writer-io".to_owned())?;
        active
            .writer
            .write_all(payload)
            .map_err(|_| "writer-io".to_owned())?;
        active.writer.flush().map_err(|_| "writer-io".to_owned())?;
        active.size += payload.len() as u64;
        Ok(())
    }

    fn open_file(&mut self, round_bytes: u64, sampled_at: SystemTime) -> Result<(), String> {
        let created_at = SystemTime::now();
        let created_text = now();
        let retention_start = created_at.min(sampled_at);
        let header = line(&json!({
            "schemaVersion": SCHEMA_VERSION,
            "type": "file_start",
            "source": self.source,
            "writer": self.identity,
            "writtenAt": created_text,
            "createdAt": created_text,
            "retentionStartAt": DateTime::<Utc>::from(retention_start).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }))?;
        let needed = header.len() as u64 + round_bytes;
        if needed > FILE_LIMIT || !self.reserve(needed, true)? {
            return Err("writer-capacity".to_owned());
        }
        let (name, file) = self.create_file(&created_text)?;
        let mut writer = BufWriter::new(file);
        writer
            .write_all(&header)
            .map_err(|_| "writer-io".to_owned())?;
        writer.flush().map_err(|_| "writer-io".to_owned())?;
        self.active = Some(ActiveFile {
            name,
            writer,
            size: header.len() as u64,
            created_at,
            retention_start,
        });
        Ok(())
    }

    fn create_file(&self, created_at: &str) -> Result<(String, File), String> {
        let stem = created_at.replace(':', "-");
        for suffix in 0_u32.. {
            let name = format!(
                "{stem}{}.jsonl",
                if suffix == 0 {
                    String::new()
                } else {
                    format!("-{suffix}")
                }
            );
            match owner_file(&self.directory.join(&name), false) {
                Ok(file) => return Ok((name, file)),
                Err(error) if error == "file-exists" => continue,
                Err(error) => return Err(error),
            }
        }
        Err("writer-io".to_owned())
    }

    fn reserve(&mut self, additional: u64, needs_file: bool) -> Result<bool, String> {
        loop {
            let entries = self.entries(SystemTime::now())?;
            let bytes = entries.iter().map(|entry| entry.size).sum::<u64>();
            if bytes + additional <= SOURCE_LIMIT
                && entries.len() + usize::from(needs_file) <= FILE_COUNT_LIMIT
            {
                return Ok(true);
            }
            let active_name = self.active.as_ref().map(|active| active.name.as_str());
            let oldest = entries
                .iter()
                .filter(|entry| entry.deletable && Some(entry.name.as_str()) != active_name)
                .min_by_key(|entry| entry.created_at);
            let Some(oldest) = oldest else {
                return Ok(false);
            };
            fs::remove_file(self.directory.join(&oldest.name))
                .map_err(|_| "writer-io".to_owned())?;
        }
    }

    fn maintain(&mut self, current: SystemTime) -> Result<(), String> {
        self.entries(current).map(|_| ())
    }

    fn entries(&self, current: SystemTime) -> Result<Vec<Entry>, String> {
        let mut result = Vec::new();
        for item in fs::read_dir(&self.directory).map_err(|_| "writer-io".to_owned())? {
            let item = item.map_err(|_| "writer-io".to_owned())?;
            let name = item.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let metadata = item.metadata().map_err(|_| "writer-io".to_owned())?;
            if !metadata.is_file()
                || item
                    .file_type()
                    .map_err(|_| "writer-io".to_owned())?
                    .is_symlink()
            {
                return Err("writer-unsafe-entry".to_owned());
            }
            let Some(created_at) = filename_time(&name) else {
                result.push(Entry {
                    name,
                    size: metadata.len(),
                    created_at: SystemTime::UNIX_EPOCH,
                    deletable: false,
                });
                continue;
            };
            if self
                .active
                .as_ref()
                .is_some_and(|active| active.name == name)
            {
                result.push(Entry {
                    name,
                    size: metadata.len(),
                    created_at,
                    deletable: false,
                });
                continue;
            }
            let retention = retention_from_header(&item.path(), created_at, current);
            if retention.is_none_or(|retention| {
                current.duration_since(retention).unwrap_or_default() >= RETENTION
            }) {
                fs::remove_file(item.path()).map_err(|_| "writer-io".to_owned())?;
                continue;
            }
            result.push(Entry {
                name,
                size: metadata.len(),
                created_at,
                deletable: true,
            });
        }
        Ok(result)
    }

    fn close_active(&mut self) -> Result<(), String> {
        if let Some(mut active) = self.active.take() {
            active.writer.flush().map_err(|_| "writer-io".to_owned())?;
        }
        Ok(())
    }
}

impl Drop for ResourceWriter {
    fn drop(&mut self) {
        let _ = self.close_active();
        let _ = self._lock.unlock();
    }
}

fn encode_round(
    round: &SampleRound,
    writer: &WriterIdentity,
    sequence: u64,
    root_revision: u64,
    dropped_rounds: u64,
) -> Result<Vec<u8>, String> {
    let written_at = now();
    let mut encoded = Vec::new();
    let mut rows = 0_u64;
    let mut truncated = false;
    for row in &round.rows {
        let mut object = serde_json::to_value(row)
            .map_err(|_| "writer-encode".to_owned())?
            .as_object()
            .cloned()
            .ok_or_else(|| "writer-encode".to_owned())?;
        add_envelope(
            &mut object,
            writer,
            sequence,
            rows,
            &round.sampled_at,
            &written_at,
        );
        let row = line(&Value::Object(object))?;
        if encoded.len() + row.len() + LINE_LIMIT > ROUND_LIMIT {
            truncated = true;
            continue;
        }
        encoded.extend_from_slice(&row);
        rows += 1;
    }
    let end = line(&json!({
        "schemaVersion": SCHEMA_VERSION,
        "type": "sample_end",
        "source": "os",
        "writer": writer,
        "sampledAt": round.sampled_at,
        "writtenAt": written_at,
        "sampleSequence": sequence,
        "expectedRows": rows,
        "collectionStartedAt": round.collection_started_at,
        "collectionFinishedAt": round.collection_finished_at,
        "coverage": if truncated || round.coverage == "partial" { "partial" } else { "complete" },
        "rootRevision": root_revision,
        "droppedRounds": dropped_rounds,
    }))?;
    if encoded.len() + end.len() > ROUND_LIMIT {
        return Err("writer-round-limit".to_owned());
    }
    encoded.extend_from_slice(&end);
    Ok(encoded)
}

fn add_envelope(
    object: &mut Map<String, Value>,
    writer: &WriterIdentity,
    sequence: u64,
    row_index: u64,
    sampled_at: &str,
    written_at: &str,
) {
    object.insert("schemaVersion".to_owned(), json!(SCHEMA_VERSION));
    object.insert("type".to_owned(), json!("os_sample"));
    object.insert("source".to_owned(), json!("os"));
    object.insert("writer".to_owned(), json!(writer));
    object.insert("sampledAt".to_owned(), json!(sampled_at));
    object.insert("writtenAt".to_owned(), json!(written_at));
    object.insert("sampleSequence".to_owned(), json!(sequence));
    object.insert("rowIndex".to_owned(), json!(row_index));
}

fn line(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|_| "writer-encode".to_owned())?;
    bytes.push(b'\n');
    (bytes.len() <= LINE_LIMIT)
        .then_some(bytes)
        .ok_or_else(|| "writer-line-limit".to_owned())
}

fn filename_time(name: &str) -> Option<SystemTime> {
    let stem = name.get(..24)?;
    let normalized = format!("{}:{}:{}", &stem[..13], &stem[14..16], &stem[17..]);
    DateTime::parse_from_rfc3339(&normalized)
        .ok()
        .map(|value| SystemTime::from(value.with_timezone(&Utc)))
}

fn retention_from_header(
    path: &Path,
    filename: SystemTime,
    current: SystemTime,
) -> Option<SystemTime> {
    let mut line = String::new();
    BufReader::new(File::open(path).ok()?)
        .take(LINE_LIMIT as u64)
        .read_line(&mut line)
        .ok()?;
    let value: Value = serde_json::from_str(&line).ok()?;
    if value.get("schemaVersion")?.as_u64()? != u64::from(SCHEMA_VERSION)
        || value.get("type")?.as_str()? != "file_start"
        || value.get("source")?.as_str()? != "os"
    {
        return None;
    }
    let retention = parse_time(value.get("retentionStartAt")?.as_str()?).ok()?;
    (retention <= filename && retention <= current).then_some(retention)
}

fn parse_time(value: &str) -> Result<SystemTime, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| SystemTime::from(value.with_timezone(&Utc)))
        .map_err(|_| "writer-time".to_owned())
}

fn create_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "writer-io".to_owned())?;
    let metadata = fs::symlink_metadata(path).map_err(|_| "writer-io".to_owned())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("writer-unsafe-directory".to_owned());
    }
    set_owner_mode(path, true)?;
    Ok(())
}

fn owner_file(path: &Path, existing: bool) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    if !existing {
        options.create_new(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "file-exists".to_owned()
        } else {
            "writer-io".to_owned()
        }
    })?;
    set_owner_mode(path, false)?;
    Ok(file)
}

fn set_owner_mode(path: &Path, directory: bool) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            path,
            fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
        )
        .map_err(|_| "writer-io".to_owned())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::filename_time;

    #[test]
    fn recognizes_resource_file_names() {
        assert!(filename_time("2026-09-13T03-24-45.436Z.jsonl").is_some());
        assert!(filename_time("other.jsonl").is_none());
    }
}
