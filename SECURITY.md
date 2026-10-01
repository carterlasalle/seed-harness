<!-- purpose: SECURITY.md: reporting channel and trust boundary summary. -->
<!-- trace:v1 id=impl.doc-security-root work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
# Security

Report vulnerabilities by opening a GitHub issue labeled `security`.
Do not post exploit details publicly; describe impact and reproduction privately to maintainers.

Trust boundary: the guardian never executes organism code outside the
sandbox (`crates/seed-guardian/src/sandbox.rs`: `/candidate` rw,
`/workspace` rw, `/seed-fixture` ro, network off, CPU 4 / mem 8g / pids
512). The organism client allowlists 9 agent RPC methods and refuses
promotion/rollback/evict/override/destroy/db.query client-side
(`scripts/verify-boundaries.ts` fails CI on leaks). Sessions pin the
champion sha; resume with a different sha throws. State lives in
`~/.seed`, never in the user project.
