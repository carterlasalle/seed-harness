// promotion_rules.rs — the five Phase 10 promotion acceptance cases.
//
// Purpose: pin the promotion safety rule — gates plus non-inferiority plus
// material gain, with probation rollback as backstop.
// Why it exists: REQ-SEED-JJ5Q1072 acceptance.
// Invariants: each case names the rule it guards; thresholds match
// metrics/pareto (0.01 default, 0.005 critical).

use seed_guardian::evaluation::{self, Gate, GateResult, State};
use seed_guardian::metrics::Metrics;
use seed_guardian::promotion::{self, Probation, ProbationOutcome};

// trace:exempt reason=internal-detail
fn champion() -> Metrics {
    Metrics {
        quality: 0.80,
        latency_ms: 100.0,
        tokens: 1000.0,
        cost: 0.0100,
        reliability: 0.99,
        complexity: 10.0,
    }
}

// trace:exempt reason=internal-detail
fn pass(gate: Gate) -> GateResult {
    GateResult {
        gate,
        passed: true,
        detail: "ok".to_string(),
    }
}

#[test]
// trace:v1 id=impl.test-promote-broken work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn broken_candidate_rejected_at_first_gate() {
    // A unit failure stops the pipeline even with better metrics.
    let results = vec![
        pass(Gate::Static),
        GateResult {
            gate: Gate::Unit,
            passed: false,
            detail: "3 tests failed".to_string(),
        },
    ];
    let state = evaluation::evaluate(&results);
    assert_eq!(state, State::Rejected);
    let better = Metrics {
        quality: 0.95,
        ..champion()
    };
    assert!(promotion::can_promote(&better, &champion(), state, false).is_err());
}

#[test]
// trace:v1 id=impl.test-promote-inferior work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn inferior_candidate_rejected_despite_clean_gates() {
    // Champion-terminal state, but quality far below tolerance.
    let worse = Metrics {
        quality: 0.70,
        ..champion()
    };
    assert!(promotion::can_promote(&worse, &champion(), State::Champion, false).is_err());
}

#[test]
// trace:v1 id=impl.test-promote-no-gain work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn non_inferior_without_material_gain_rejected() {
    // A tie is non-inferior but earns no promotion without a real gain.
    let tie = champion();
    assert!(promotion::can_promote(&tie, &champion(), State::Champion, false).is_err());
}

#[test]
// trace:v1 id=impl.test-promote-gain work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn genuine_gain_promotes_and_records() {
    let better = Metrics {
        quality: 0.85,
        ..champion()
    };
    promotion::can_promote(&better, &champion(), State::Champion, false).expect("promotable");
    let dir = std::env::temp_dir().join(format!("seed-promote-{}-gain", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = seed_guardian::db::open(&dir.join("g.sqlite")).unwrap();
    db.migrate().unwrap();
    let record = promotion::record_promotion(
        &db,
        "cand-b",
        "champ-a",
        vec!["static".to_string(), "unit".to_string()],
        &better,
        &champion(),
        "quality +0.05",
    )
    .expect("record");
    assert_eq!(record.candidate_ref, "cand-b");
    assert_eq!(record.to_ref, "cand-b");
    assert_eq!(record.from_ref, "champ-a");
    assert_eq!(record.probation_tasks, promotion::PROBATION_TASKS);
}

#[test]
// trace:v1 id=impl.test-promote-probation work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn probation_rolls_back_on_two_strikes() {
    let dir = std::env::temp_dir().join(format!("seed-promote-{}-prob", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = seed_guardian::db::open(&dir.join("g.sqlite")).unwrap();
    db.migrate().unwrap();
    seed_guardian::champion::set(&db, "champ-a", "baseline").unwrap();
    seed_guardian::champion::set(&db, "cand-b", "promoted").unwrap();

    let mut probation = Probation::new();
    probation.observe(ProbationOutcome::Success);
    assert!(!probation.must_rollback());
    probation.observe(ProbationOutcome::Catastrophic);
    assert!(!probation.must_rollback());
    probation.observe(ProbationOutcome::Regression);
    assert!(probation.must_rollback());

    let restored = seed_guardian::champion::rollback(&db).expect("rollback");
    assert_eq!(restored, "champ-a");
    assert_eq!(
        seed_guardian::champion::current(&db).unwrap(),
        Some("champ-a".to_string())
    );
}
