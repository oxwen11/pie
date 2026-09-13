use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BirthIdentity {
    pub value: String,
    pub source: String,
    pub precision_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessIdentity {
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birth: Option<BirthIdentity>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub process: ProcessIdentity,
    pub role: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    #[serde(rename_all = "camelCase")]
    Configure {
        schema_version: u8,
        owner: ProcessIdentity,
        output_directory: String,
        sample_interval_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    ReplaceRoots {
        schema_version: u8,
        revision: u64,
        roots: Vec<Root>,
    },
    #[serde(rename_all = "camelCase")]
    Stop { schema_version: u8 },
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    #[serde(rename_all = "camelCase")]
    Ready {
        schema_version: u8,
        process: ProcessIdentity,
    },
    #[serde(rename_all = "camelCase")]
    RootsApplied { schema_version: u8, revision: u64 },
    #[serde(rename_all = "camelCase")]
    Status {
        schema_version: u8,
        status: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'static str>,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_sampled_at: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_written_at: Option<String>,
        dropped_rounds: u64,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterIdentity {
    pub instance_id: String,
    pub process: ProcessIdentity,
}
