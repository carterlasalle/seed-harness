"""Echo fixture capability server (JSONL stdio ABI, spec section 25).

Purpose: test fixture proving capability install -> execute -> unload.
Why it exists: REQ-SEED-AJZXZFBN acceptance needs a real executable fixture.
Protocol: read one JSON object per stdin line {"id":..., "method":..., "params":...},
write {"id":..., "result":...} (or {"id":..., "error":...}) per stdout line.
Methods: `echo` returns params verbatim; anything else is an error.
Invariant: stdlib only; never touches fs/net; single-threaded line loop.
"""

import json
import sys


def serve(stdin=sys.stdin, stdout=sys.stdout):
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            stdout.write(json.dumps({"id": None, "error": f"bad json: {exc}"}) + "\n")
            stdout.flush()
            continue
        rid, method, params = req.get("id"), req.get("method"), req.get("params")
        if method == "echo":
            stdout.write(json.dumps({"id": rid, "result": params}) + "\n")
        else:
            stdout.write(json.dumps({"id": rid, "error": f"unknown method: {method}"}) + "\n")
        stdout.flush()


if __name__ == "__main__":
    serve()
