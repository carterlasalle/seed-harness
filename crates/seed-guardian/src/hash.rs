// hash.rs — content hashing helpers.
//
// Purpose: sha256 digests for artifacts, candidates, and capability blobs.
// Why it exists: every stored blob is content-addressed so replay and
// promotion compare bytes, not claims.
// Responsibilities: hex digests for bytes/strings/files.
// Invariants: lowercase hex; streaming reads for files (no whole-file load).
// Public functions: sha256_hex, sha256_str, sha256_file.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// Sha256 hex digest of raw bytes.
// trace:v1 id=impl.hash-bytes work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Sha256 hex digest of a string slice.
// trace:v1 id=impl.hash-str work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn sha256_str(text: &str) -> String {
    sha256_hex(text.as_bytes())
}

/// Sha256 hex digest of a file, streamed in 64KiB chunks.
// trace:v1 id=impl.hash-file work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
