/**
 * seed-core edit protocol: parse + apply task-agent edits (spec section 37).
 *
 * Purpose: one protocol interface plus parsers for the three edit formats the
 * task agent may emit — full-file, unified-diff, search-replace — and the
 * application of a parsed edit to file contents.
 * Why it exists: edits cross from model output into the worktree, so the
 * harness decides what the text means; ambiguity (a search block matching
 * twice, a hunk whose context does not match) must fail loudly instead of
 * corrupting a file.
 * Responsibilities: format detection, strict parsing, and application with
 * exactly-once search semantics and context-verified hunks.
 * Invariants: pure; parsing never applies; application is atomic per call
 * (throws before returning on any mismatch); unified-diff hunks must be
 * ordered, non-overlapping and fully context-verified; a search/replace search
 * section must contain at least one non-blank line and match exactly once.
 * Public: parseEdit, applyEdit, detectEditFormat, EDIT_PROTOCOLS, EditError,
 * EditFormat, EditOperation, DiffHunk, SearchReplaceBlock, EditProtocol.
 */

// trace:exempt reason=internal-detail
export type EditFormat = "full-file" | "unified-diff" | "search-replace";

// trace:exempt reason=internal-detail
export interface DiffLine {
  kind: "context" | "add" | "remove";
  text: string;
}

// trace:exempt reason=internal-detail
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

// trace:exempt reason=internal-detail
export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

// trace:exempt reason=internal-detail
export type EditOperation =
  | { format: "full-file"; content: string }
  | { format: "search-replace"; blocks: SearchReplaceBlock[] }
  | { format: "unified-diff"; hunks: DiffHunk[] };

// trace:exempt reason=internal-detail
export interface EditProtocol {
  readonly format: EditFormat;
  // trace:exempt reason=internal-detail
  parse(payload: string): EditOperation | null;
  // trace:exempt reason=internal-detail
  apply(original: string, operation: EditOperation): string;
}

// trace:v1 id=impl.sc-edits-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export class EditError extends Error {
  // trace:exempt reason=internal-detail
  constructor(message: string) {
    super(message);
    this.name = "EditError";
  }
}

// trace:exempt reason=internal-detail
const SEARCH_MARKER = "<<<<<<< SEARCH";
// trace:exempt reason=internal-detail
const REPLACE_MARKER = ">>>>>>> REPLACE";
// trace:exempt reason=internal-detail
const SEPARATOR = "=======";

// trace:exempt reason=internal-detail
function looksLikeUnifiedDiff(payload: string): boolean {
  return /^--- /m.test(payload) && /^@@/m.test(payload);
}

// trace:exempt reason=internal-detail
function looksLikeSearchReplace(payload: string): boolean {
  return payload.includes(SEARCH_MARKER);
}

// trace:exempt reason=internal-detail
function parseSearchReplaceBlocks(payload: string): SearchReplaceBlock[] {
  // trace:exempt reason=unit-test
  const lines = payload.split("\n");
  // trace:exempt reason=internal-detail
  const blocks: SearchReplaceBlock[] = [];
  // trace:exempt reason=internal-detail
  let mode: "idle" | "search" | "replace" = "idle";
  // trace:exempt reason=internal-detail
  let search: string[] = [];
  // trace:exempt reason=internal-detail
  let replace: string[] = [];
  for (const line of lines) {
    if (mode === "idle") {
      if (line === SEARCH_MARKER) {
        mode = "search";
        search = [];
        replace = [];
        continue;
      }
      if (line.trim() === "") continue;
      throw new EditError(`unexpected line outside a search/replace block: ${JSON.stringify(line)}`);
    }
    if (mode === "search") {
      if (line === SEPARATOR) {
        mode = "replace";
        continue;
      }
      search.push(line);
      continue;
    }
    if (line === REPLACE_MARKER) {
      if (!search.some((searchLine) => searchLine.trim() !== "")) {
        throw new EditError("search/replace block has an empty search section");
      }
      blocks.push({ search: search.join("\n"), replace: replace.join("\n") });
      mode = "idle";
      continue;
    }
    replace.push(line);
  }
  if (mode !== "idle") {
    throw new EditError(
      `unterminated search/replace block (missing ${mode === "search" ? SEPARATOR : REPLACE_MARKER})`,
    );
  }
  if (blocks.length === 0) throw new EditError("no search/replace blocks found");
  return blocks;
}

// trace:exempt reason=internal-detail
function parseUnifiedDiffHunks(payload: string): DiffHunk[] {
  // trace:exempt reason=unit-test
  const lines = payload.split("\n");
  // trace:exempt reason=internal-detail
  let cursor = 0;
  while (cursor < lines.length && !(lines[cursor] ?? "").startsWith("--- ")) cursor += 1;
  if (cursor === lines.length) throw new EditError("unified diff is missing the '--- ' header line");
  // trace:exempt reason=internal-detail
  const target = lines[cursor + 1];
  if (target === undefined || !target.startsWith("+++ ")) {
    throw new EditError("unified diff is missing the '+++ ' header line");
  }
  cursor += 2;
  // trace:exempt reason=internal-detail
  const hunks: DiffHunk[] = [];
  while (cursor < lines.length) {
    // trace:exempt reason=internal-detail
    const line = lines[cursor] ?? "";
    if (line === "" && cursor === lines.length - 1) break;
    if (!line.startsWith("@@ ")) {
      if (line === "") {
        cursor += 1;
        continue;
      }
      throw new EditError(`unexpected line outside a hunk: ${JSON.stringify(line)}`);
    }
    // trace:exempt reason=internal-detail
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header === null) throw new EditError(`malformed hunk header: ${JSON.stringify(line)}`);
    // trace:exempt reason=internal-detail
    const oldStart = Number(header[1]);
    // trace:exempt reason=internal-detail
    const oldCount = header[2] === undefined ? 1 : Number(header[2]);
    // trace:exempt reason=internal-detail
    const newStart = Number(header[3]);
    // trace:exempt reason=internal-detail
    const newCount = header[4] === undefined ? 1 : Number(header[4]);
    cursor += 1;
    // trace:exempt reason=internal-detail
    const hunkLines: DiffLine[] = [];
    while (cursor < lines.length && !(lines[cursor] ?? "").startsWith("@@ ")) {
      // trace:exempt reason=internal-detail
      const hunkLine = lines[cursor] ?? "";
      cursor += 1;
      if (hunkLine === "" && cursor === lines.length) break;
      // trace:exempt reason=internal-detail
      const marker = hunkLine.charAt(0);
      if (marker === "+") hunkLines.push({ kind: "add", text: hunkLine.slice(1) });
      else if (marker === "-") hunkLines.push({ kind: "remove", text: hunkLine.slice(1) });
      else if (marker === " ") hunkLines.push({ kind: "context", text: hunkLine.slice(1) });
      else if (hunkLine === "") hunkLines.push({ kind: "context", text: "" });
      else throw new EditError(`unexpected line inside a hunk: ${JSON.stringify(hunkLine)}`);
    }
    // trace:exempt reason=internal-detail
    const removed = hunkLines.filter((entry) => entry.kind === "remove").length;
    // trace:exempt reason=internal-detail
    const added = hunkLines.filter((entry) => entry.kind === "add").length;
    // trace:exempt reason=internal-detail
    const context = hunkLines.length - removed - added;
    if (removed + context !== oldCount) {
      throw new EditError(
        `hunk at old line ${oldStart} declares ${oldCount} old line(s) but contains ${removed + context}`,
      );
    }
    if (added + context !== newCount) {
      throw new EditError(
        `hunk at old line ${oldStart} declares ${newCount} new line(s) but contains ${added + context}`,
      );
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }
  if (hunks.length === 0) throw new EditError("unified diff contains no hunks");
  return hunks;
}

// trace:exempt reason=internal-detail
function applyUnifiedDiffHunks(original: string, hunks: readonly DiffHunk[]): string {
  // trace:exempt reason=unit-test
  const lines = original.split("\n");
  // trace:exempt reason=internal-detail
  const result: string[] = [];
  // trace:exempt reason=internal-detail
  let cursor = 0;
  for (const hunk of hunks) {
    // trace:exempt reason=internal-detail
    const start = hunk.oldStart - 1;
    if (start < cursor) throw new EditError(`hunk at line ${hunk.oldStart} overlaps or is out of order`);
    if (start > lines.length) throw new EditError(`hunk at line ${hunk.oldStart} starts past end of file`);
    for (let index = cursor; index < start; index += 1) {
      // trace:exempt reason=internal-detail
      const line = lines[index];
      if (line !== undefined) result.push(line);
    }
    cursor = start;
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        result.push(line.text);
        continue;
      }
      // trace:exempt reason=internal-detail
      const actual = lines[cursor];
      if (actual === undefined || actual !== line.text) {
        throw new EditError(
          `hunk context mismatch at line ${cursor + 1}: expected ${JSON.stringify(line.text)} got ${JSON.stringify(actual ?? null)}`,
        );
      }
      cursor += 1;
      if (line.kind === "context") result.push(line.text);
    }
  }
  for (let index = cursor; index < lines.length; index += 1) {
    // trace:exempt reason=internal-detail
    const line = lines[index];
    if (line !== undefined) result.push(line);
  }
  return result.join("\n");
}

// trace:exempt reason=internal-detail
function applySearchReplaceBlocks(original: string, blocks: readonly SearchReplaceBlock[]): string {
  // trace:exempt reason=internal-detail
  let result = original;
  for (const block of blocks) {
    // trace:exempt reason=internal-detail
    const first = result.indexOf(block.search);
    if (first < 0) {
      throw new EditError(`search text not found: ${JSON.stringify(truncate(block.search))}`);
    }
    // trace:exempt reason=internal-detail
    const second = result.indexOf(block.search, first + 1);
    if (second >= 0) {
      throw new EditError(`search text is ambiguous (multiple matches): ${JSON.stringify(truncate(block.search))}`);
    }
    result = result.slice(0, first) + block.replace + result.slice(first + block.search.length);
  }
  return result;
}

// trace:exempt reason=internal-detail
function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

// trace:exempt reason=internal-detail
function stripFence(payload: string): string {
  // trace:exempt reason=internal-detail
  const match = /^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/.exec(payload.trim());
  return match?.[1] ?? payload;
}

// trace:exempt reason=internal-detail
const unifiedDiffProtocol: EditProtocol = {
  format: "unified-diff",
  parse: (payload) => {
    if (!looksLikeUnifiedDiff(payload)) return null;
    return { format: "unified-diff", hunks: parseUnifiedDiffHunks(payload) };
  },
  apply: (original, operation) => {
    if (operation.format !== "unified-diff") throw new EditError("operation is not a unified diff");
    return applyUnifiedDiffHunks(original, operation.hunks);
  },
};

// trace:exempt reason=internal-detail
const searchReplaceProtocol: EditProtocol = {
  format: "search-replace",
  parse: (payload) => {
    if (!looksLikeSearchReplace(payload)) return null;
    return { format: "search-replace", blocks: parseSearchReplaceBlocks(payload) };
  },
  apply: (original, operation) => {
    if (operation.format !== "search-replace") throw new EditError("operation is not a search/replace edit");
    return applySearchReplaceBlocks(original, operation.blocks);
  },
};

// trace:exempt reason=internal-detail
const fullFileProtocol: EditProtocol = {
  format: "full-file",
  parse: (payload) => ({ format: "full-file", content: stripFence(payload) }),
  apply: (_original, operation) => {
    if (operation.format !== "full-file") throw new EditError("operation is not a full-file edit");
    return operation.content;
  },
};

// trace:exempt reason=internal-detail
export const EDIT_PROTOCOLS: readonly EditProtocol[] = [
  unifiedDiffProtocol,
  searchReplaceProtocol,
  fullFileProtocol,
];

// trace:v1 id=impl.sc-edits-detect work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function detectEditFormat(payload: string): EditFormat {
  if (looksLikeUnifiedDiff(payload)) return "unified-diff";
  if (looksLikeSearchReplace(payload)) return "search-replace";
  return "full-file";
}

// trace:v1 id=impl.sc-edits-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function parseEdit(payload: string): EditOperation {
  for (const protocol of EDIT_PROTOCOLS) {
    const operation = protocol.parse(payload);
    if (operation !== null) return operation;
  }
  throw new EditError("unrecognized edit payload");
}

// trace:v1 id=impl.sc-edits-apply work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function applyEdit(original: string, operation: EditOperation): string {
  for (const protocol of EDIT_PROTOCOLS) {
    if (protocol.format === operation.format) return protocol.apply(original, operation);
  }
  throw new EditError(`no protocol registered for format "${operation.format}"`);
}
