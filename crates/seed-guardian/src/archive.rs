// archive.rs — capped Pareto archive over persisted members.
//
// Purpose: keep the best candidates under a hard cap, evicting dominated
// then redundant members.
// Why it exists: REQ-SEED-JJ5Q1072 — evaluation stays cheap only when the
// archive cannot grow without bound.
// Responsibilities: ArchiveEntry JSON roundtrip, novelty scoring, capped
// insert backed by the `archive_members` table.
// Invariants: cap is ARCHIVE_CAP (64); eviction prefers a dominated member,
// else the least novel; novelty is 1 minus max Jaccard over member tags.
// Public types/functions: ArchiveEntry, list, insert.

use crate::db::Db;
use crate::metrics::Metrics;
use crate::pareto;
use serde::{Deserialize, Serialize};

/// One archive member with tags for novelty scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.archive-entry work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct ArchiveEntry {
    /// Candidate ref (primary key).
    pub candidate_ref: String,
    /// Measured metrics.
    pub metrics: Metrics,
    /// Capability tags for novelty.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Cached novelty at insert time.
    #[serde(default)]
    pub novelty: f64,
}

// trace:exempt reason=internal-detail
fn encode(entry: &ArchiveEntry) -> String {
    serde_json::to_string(entry).unwrap_or_else(|_| "{}".to_string())
}

// trace:exempt reason=internal-detail
fn decode(candidate_ref: &str, text: &str, novelty: f64) -> ArchiveEntry {
    if let Ok(mut entry) = serde_json::from_str::<ArchiveEntry>(text) {
        entry.candidate_ref = candidate_ref.to_string();
        entry.novelty = novelty;
        entry
    } else if let Ok(metrics) = serde_json::from_str::<Metrics>(text) {
        ArchiveEntry {
            candidate_ref: candidate_ref.to_string(),
            metrics,
            tags: Vec::new(),
            novelty,
        }
    } else {
        ArchiveEntry {
            candidate_ref: candidate_ref.to_string(),
            metrics: crate::metrics::zero(),
            tags: Vec::new(),
            novelty,
        }
    }
}

/// All members decoded from the table.
// trace:v1 id=impl.archive-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn list(db: &Db) -> Result<Vec<ArchiveEntry>, String> {
    let rows = db.archive_list()?;
    Ok(rows.iter().map(|(r, m, n)| decode(r, m, *n)).collect())
}

/// Insert or refresh a member; evicts one member when over cap. Refreshing
/// an existing ref never evicts.
// trace:v1 id=impl.archive-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn insert(db: &Db, entry: &ArchiveEntry) -> Result<(), String> {
    let members = list(db)?;
    if members
        .iter()
        .any(|m| m.candidate_ref == entry.candidate_ref)
    {
        db.archive_upsert(&entry.candidate_ref, &encode(entry), entry.novelty)?;
        return Ok(());
    }
    let tag_sets: Vec<Vec<String>> = members.iter().map(|m| m.tags.clone()).collect();
    let mut fresh = entry.clone();
    fresh.novelty = pareto::novelty(&entry.tags, &tag_sets);
    if members.len() >= pareto::ARCHIVE_CAP {
        let scored: Vec<(Metrics, f64)> = members
            .iter()
            .map(|m| (m.metrics.clone(), m.novelty))
            .collect();
        if let Some(idx) = pareto::eviction_index(&scored) {
            db.archive_evict(&members[idx].candidate_ref)?;
        }
    }
    db.archive_upsert(&fresh.candidate_ref, &encode(&fresh), fresh.novelty)?;
    Ok(())
}
