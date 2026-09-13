use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::protocol::{BirthIdentity, ProcessIdentity, Root};

const MAX_TARGETS: usize = 4_096;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricStatus {
    metric: &'static str,
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsMetrics {
    rss_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_percent: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu_window_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SampleRow {
    process: ProcessIdentity,
    role: String,
    metrics: OsMetrics,
    #[serde(rename = "metricStatus", skip_serializing_if = "Vec::is_empty")]
    metric_status: Vec<MetricStatus>,
}

pub struct SampleRound {
    pub sampled_at: String,
    pub collection_started_at: String,
    pub collection_finished_at: String,
    pub coverage: &'static str,
    pub rows: Vec<SampleRow>,
}

pub struct Sampler {
    system: System,
    last_refresh: Option<Instant>,
}

impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new();
        refresh(&mut system);
        Self {
            system,
            last_refresh: Some(Instant::now()),
        }
    }

    pub fn owner_matches(&mut self, owner: &ProcessIdentity) -> bool {
        refresh(&mut self.system);
        self.system
            .process(Pid::from_u32(owner.pid))
            .is_some_and(|process| birth_matches(process.start_time(), owner.birth.as_ref()))
    }

    pub fn sample(&mut self, roots: &[Root]) -> SampleRound {
        let collection_started_at = now();
        refresh(&mut self.system);
        let cpu_window_ms = self
            .last_refresh
            .replace(Instant::now())
            .map(|previous| previous.elapsed().as_millis() as u64);

        let processes = self.system.processes();
        let mut children = HashMap::<u32, Vec<u32>>::new();
        for (pid, process) in processes {
            if let Some(parent) = process.parent() {
                children
                    .entry(parent.as_u32())
                    .or_default()
                    .push(pid.as_u32());
            }
        }

        let mut verified = roots
            .iter()
            .filter(|root| {
                processes
                    .get(&Pid::from_u32(root.process.pid))
                    .is_some_and(|process| {
                        birth_matches(process.start_time(), root.process.birth.as_ref())
                    })
            })
            .collect::<Vec<_>>();
        verified.sort_by_key(|root| role_priority(&root.role));

        let exact = verified
            .iter()
            .map(|root| (root.process.pid, root.role.clone()))
            .collect::<HashMap<_, _>>();
        let mut selected = exact.clone();
        for root in verified {
            let descendant_role = match root.role.as_str() {
                "pi" => "pi-descendant",
                "electron-main" => "electron-other",
                _ => "pi-descendant",
            };
            let mut queue = VecDeque::from([root.process.pid]);
            let mut visited = HashSet::new();
            while let Some(parent) = queue.pop_front() {
                if !visited.insert(parent) {
                    continue;
                }
                for child in children.get(&parent).into_iter().flatten() {
                    queue.push_back(*child);
                    selected
                        .entry(*child)
                        .or_insert_with(|| descendant_role.to_owned());
                }
            }
        }
        if selected.contains_key(&std::process::id()) {
            selected.insert(std::process::id(), "sidecar".to_owned());
        }
        for (pid, role) in exact {
            selected.insert(pid, role);
        }

        let partial = selected.len() > MAX_TARGETS;
        let mut selected = selected.into_iter().collect::<Vec<_>>();
        selected.sort_by_key(|(pid, _)| *pid);
        selected.truncate(MAX_TARGETS);

        let mut rows = selected
            .into_iter()
            .filter_map(|(pid, role)| {
                let process = processes.get(&Pid::from_u32(pid))?;
                let warming_up = cpu_window_ms.is_none();
                Some(SampleRow {
                    process: ProcessIdentity {
                        pid,
                        parent_pid: process.parent().map(Pid::as_u32).filter(|pid| *pid > 0),
                        birth: Some(BirthIdentity {
                            value: process.start_time().saturating_mul(1_000).to_string(),
                            source: "sysinfo".to_owned(),
                            precision_ms: 1_000,
                        }),
                    },
                    role,
                    metrics: OsMetrics {
                        rss_bytes: process.memory(),
                        cpu_percent: (!warming_up).then_some(process.cpu_usage()),
                        cpu_window_ms: (!warming_up).then_some(cpu_window_ms.unwrap_or_default()),
                    },
                    metric_status: if warming_up {
                        vec![MetricStatus {
                            metric: "cpuPercent",
                            status: "warming-up",
                        }]
                    } else {
                        Vec::new()
                    },
                })
            })
            .collect::<Vec<_>>();
        rows.sort_by_key(|row| row.process.pid);

        SampleRound {
            sampled_at: now(),
            collection_started_at,
            collection_finished_at: now(),
            coverage: if partial { "partial" } else { "complete" },
            rows,
        }
    }
}

fn refresh(system: &mut System) {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_memory()
            .with_cpu()
            .without_tasks(),
    );
}

fn birth_matches(actual_seconds: u64, expected: Option<&BirthIdentity>) -> bool {
    expected.is_none_or(|identity| {
        identity
            .value
            .parse::<u64>()
            .is_ok_and(|value| value == actual_seconds.saturating_mul(1_000))
    })
}

fn role_priority(role: &str) -> u8 {
    match role {
        "pi" => 0,
        "electron-main" => 1,
        "daemon" => 2,
        _ => 3,
    }
}

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
