<!-- purpose: CAPABILITY_ABI.md: capability manifest plus JSONL-stdio process contract, with the echo fixture as reference. -->
# Capability ABI

<!-- trace:v1 id=impl.doc-capability-abi work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN -->
Manifests validate against `schemas/capability.schema.json` (`kind:
python | process`, entrypoint, tools, permissions, limits). Process
capabilities speak JSONL over stdio (spec section 25): one request line
`{"id", "method", "params"}` in, one `{"id", "result" | "error"}` line out.
Reference: `capabilities/fixtures/echo/server.py` (`echo` returns params;
unknown method errors). Router ranks manifest text with BM25, exposes max 8.
