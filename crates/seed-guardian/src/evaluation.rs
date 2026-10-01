// evaluation.rs — gate pipeline and candidate state machine.
//
// Purpose: cheapest-first gate order plus the CREATED..CHAMPION lifecycle.
// Why it exists: REQ-SEED-JJ5Q1072 — a broken candidate must fail at the
// earliest gate; promotion only considers CHAMPION-terminal candidates.
// Responsibilities: Gate order, GateResult, State, advance/evaluate.
// Invariants: gate order is STATIC>UNIT>MICROBENCH>REPLAY>HOLDOUT>XMODEL>
// PROBATION>CHAMPION; any failure jumps to Rejected; Archived is terminal
// and only reachable from Rejected or Champion.
// Public types/functions: Gate, State, GateResult, gate_order, advance,
// evaluate.

use serde::{Deserialize, Serialize};

/// Ordered evaluation gates, cheapest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
// trace:v1 id=impl.eval-gate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub enum Gate {
    /// Lint, schema, boundary checks.
    Static,
    /// Deterministic unit tests.
    Unit,
    /// Microbenchmarks (latency/tokens/cost).
    Microbench,
    /// Past tasks must still pass.
    Replay,
    /// Unseen holdout tasks.
    Holdout,
    /// Cross-model check.
    XModel,
    /// Live probation on 10 tasks.
    Probation,
    /// Champion comparison (non-inferiority + Pareto).
    Champion,
}

/// Candidate lifecycle states (terminal: Champion, Rejected, Archived).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
// trace:v1 id=impl.eval-state work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub enum State {
    /// Submitted, no gate run yet.
    Created,
    /// Passed static.
    StaticPassed,
    /// Passed unit.
    UnitPassed,
    /// Passed microbench.
    MicrobenchPassed,
    /// Passed replay.
    ReplayPassed,
    /// Passed holdout.
    HoldoutPassed,
    /// Passed cross-model.
    XModelPassed,
    /// In live probation.
    Probation,
    /// Promoted to champion.
    Champion,
    /// Rejected at some gate.
    Rejected,
    /// Moved to cold storage.
    Archived,
}

/// One gate outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.eval-gate-result work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct GateResult {
    /// Gate that ran.
    pub gate: Gate,
    /// Whether it passed.
    pub passed: bool,
    /// Human-readable detail.
    pub detail: String,
}

/// Canonical gate order, cheapest first.
// trace:v1 id=impl.eval-order work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn gate_order() -> Vec<Gate> {
    vec![
        Gate::Static,
        Gate::Unit,
        Gate::Microbench,
        Gate::Replay,
        Gate::Holdout,
        Gate::XModel,
        Gate::Probation,
        Gate::Champion,
    ]
}

// trace:exempt reason=internal-detail
fn state_for_gate(gate: Gate) -> State {
    match gate {
        Gate::Static => State::StaticPassed,
        Gate::Unit => State::UnitPassed,
        Gate::Microbench => State::MicrobenchPassed,
        Gate::Replay => State::ReplayPassed,
        Gate::Holdout => State::HoldoutPassed,
        Gate::XModel => State::XModelPassed,
        Gate::Probation => State::Probation,
        Gate::Champion => State::Champion,
    }
}

/// Advance one gate: pass moves to the gate's state, fail to Rejected.
/// Terminal states are returned unchanged.
// trace:v1 id=impl.eval-advance work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn advance(state: State, result: &GateResult) -> State {
    match state {
        State::Champion | State::Rejected | State::Archived => state,
        _ => {
            if result.passed {
                state_for_gate(result.gate)
            } else {
                State::Rejected
            }
        }
    }
}

/// Fold gate results from Created; stops at the first failure.
// trace:v1 id=impl.eval-evaluate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn evaluate(results: &[GateResult]) -> State {
    let mut state = State::Created;
    for result in results {
        state = advance(state, result);
        if state == State::Rejected {
            break;
        }
    }
    state
}

/// Archive a terminal candidate; errors on non-terminal states.
// trace:v1 id=impl.eval-archive work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn archive(state: State) -> Result<State, String> {
    match state {
        State::Rejected | State::Champion => Ok(State::Archived),
        _ => Err(format!("only terminal candidates archive, got {state:?}")),
    }
}
