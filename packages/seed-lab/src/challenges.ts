// Seed lab challenges: deterministic mutation operators plus admission gate.
//
// Purpose: generate holdout-style discrimination tasks by mutating champion
// code with reproducible operators, and admit only mutations that prove a
// real weakness (baseline passes, mutation fails, repair passes).
// Why it exists: challenges must target observed champion weaknesses without
// leaking evals/core; determinism makes every challenge reproducible from seed.
// Responsibilities: seeded PRNG, 10 text mutation operators, triple-check admission.
// Invariants: same (source, operator, seed) always yields the same mutant;
// admission is baseline-pass AND mutation-fail AND repair-pass, else discard.
// Public types/functions: MutationOperator, MUTATION_OPERATORS, mulberry32,
// applyOperator, Admission, admitChallenge.

// trace:exempt reason=internal-detail
export type PickOne = (n: number) => number;

// trace:exempt reason=internal-detail
export interface MutationOperator {
  id: string;
  description: string;
  // trace:exempt reason=internal-detail
  apply(src: string, pick: PickOne): string;
}

// trace:exempt reason=internal-detail
function replaceOne(src: string, pattern: RegExp, make: (m: RegExpMatchArray) => string, pick: PickOne): string {
  // trace:exempt reason=internal-detail
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  // trace:exempt reason=internal-detail
  const matches = [...src.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0 || matches[0]?.index === undefined) return src;
  // trace:exempt reason=internal-detail
  const chosen = matches[pick(matches.length) % matches.length];
  if (chosen?.index === undefined) return src;
  return src.slice(0, chosen.index) + make(chosen) + src.slice(chosen.index + chosen[0].length);
}

// trace:exempt reason=internal-detail
const swapMap: Record<string, string> = { "<": ">", ">": "<", "===": "!==", "!==": "===", true: "false", false: "true" };

export const MUTATION_OPERATORS: MutationOperator[] = [
  { id: "comparison-flip", description: "swap one < with >", apply: (s, p) => replaceOne(s, /<|>/, (m) => swapMap[m[0]] ?? m[0], p) },
  { id: "equality-flip", description: "swap one === with !==", apply: (s, p) => replaceOne(s, /===|!==/, (m) => swapMap[m[0]] ?? m[0], p) },
  { id: "off-by-one", description: "widen one strict < to <=", apply: (s, p) => replaceOne(s, /<(?![=])/, () => "<=", p) },
  { id: "negate-condition", description: "negate one if condition", apply: (s, p) => replaceOne(s, /if \((.+?)\)/, (m) => `if (!(${m[1]}))`, p) },
  { id: "invert-boolean", description: "flip one boolean literal", apply: (s, p) => replaceOne(s, /\btrue\b|\bfalse\b/, (m) => swapMap[m[0]] ?? m[0], p) },
  { id: "plus-to-minus", description: "turn one + into -", apply: (s, p) => replaceOne(s, /\+(?![+=])/, () => "-", p) },
  { id: "drop-negation", description: "remove one ! guard", apply: (s, p) => replaceOne(s, /!\s*(?=[\w(])/, () => "", p) },
  { id: "early-return", description: "insert an early return in the first block", apply: (s, p) => replaceOne(s, /\{/, () => "{\nreturn;", p) },
  { id: "shrink-loop-bound", description: "shorten one .length bound", apply: (s, p) => replaceOne(s, /\.length\b/, () => ".length - 1", p) },
  { id: "bump-integer", description: "increment one integer literal", apply: (s, p) => replaceOne(s, /\b\d+\b/, (m) => String(Number(m[0]) + 1), p) },
];

// trace:v1 id=impl.challenges-prng work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// trace:v1 id=impl.challenges-apply work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function applyOperator(src: string, opId: string, seed: number): string {
  const op = MUTATION_OPERATORS.find((o) => o.id === opId);
  if (!op) throw new Error(`unknown mutation operator: ${opId}`);
  const rand = mulberry32(seed);
  return op.apply(src, (n) => Math.floor(rand() * n));
}

// trace:exempt reason=internal-detail
export interface Admission {
  decision: "admit" | "discard";
  reason: string;
}

// trace:v1 id=impl.challenges-admit work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function admitChallenge(checks: {
  baselinePass: boolean;
  mutationPass: boolean;
  repairPass: boolean;
}): Admission {
  if (!checks.baselinePass) return { decision: "discard", reason: "baseline-fails" };
  if (checks.mutationPass) return { decision: "discard", reason: "mutation-does-not-fail" };
  if (!checks.repairPass) return { decision: "discard", reason: "repair-fails" };
  return { decision: "admit", reason: "baseline-pass-mutation-fail-repair-pass" };
}

// trace:v1 id=impl.challenges-generate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function generateChallenges(
  sources: readonly string[],
  seed: number,
  verify: (mutant: string) => { baselinePass: boolean; mutationPass: boolean; repairPass: boolean },
): { operator: string; admitted: number; discarded: number }[] {
  return MUTATION_OPERATORS.map((op) => {
    let admitted = 0;
    let discarded = 0;
    for (const source of sources) {
      const mutant = applyOperator(source, op.id, seed);
      const verdict = admitChallenge(verify(mutant));
      if (verdict.decision === "admit") admitted += 1;
      else discarded += 1;
    }
    return { operator: op.id, admitted, discarded };
  });
}
