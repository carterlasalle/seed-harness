/**
 * seed-core context codecs: encode/decode context payloads (spec section 36).
 *
 * Purpose: the ContextCodec contract used wherever harness context (session
 * state, task briefs, candidate metadata) is serialized for storage, transport
 * or replay, plus the default JSON implementation.
 * Why it exists: encode and decode must be paired and named, so sessions and
 * replays can state which codec produced a payload and refuse to guess.
 * Responsibilities: the codec interface and a strict JSON codec that throws
 * CodecError on malformed input instead of returning a partial value.
 * Invariants: encode -> decode round-trips every JSON-representable value;
 * decode of malformed text throws CodecError; codecs are pure.
 * Public: ContextCodec, JSON_CONTEXT_CODEC, CodecError.
 */

// trace:v1 id=impl.sc-codecs work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS

export interface ContextCodec<T = unknown> {
  readonly name: string;
  encode(value: T): string;
  decode(text: string): T;
}

// trace:v1 id=impl.sc-codecs-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export class CodecError extends Error {
  // trace:exempt reason=internal-detail
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

// trace:exempt reason=internal-detail
export const JSON_CONTEXT_CODEC: ContextCodec<unknown> = {
  name: "json",
  encode: (value) => JSON.stringify(value),
  decode: (text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new CodecError(`json codec could not decode payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// trace:exempt reason=internal-detail
export const SUMMARY_CONTEXT_CODEC: ContextCodec<unknown> = {
  name: "structured-summary",
  encode: (value) => JSON.stringify({ summary: value }),
  decode: (text) => {
    try {
      const parsed = JSON.parse(text) as { summary?: unknown };
      if (typeof parsed !== "object" || parsed === null || !("summary" in parsed)) {
        throw new CodecError("structured-summary payload misses summary");
      }
      return (parsed as { summary: unknown }).summary;
    } catch (error) {
      if (error instanceof CodecError) throw error;
      throw new CodecError(`structured-summary codec could not decode payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// trace:exempt reason=internal-detail
export const RETRIEVAL_CONTEXT_CODEC: ContextCodec<unknown> = {
  name: "retrieval-archive",
  encode: (value) => JSON.stringify({ archive: [value] }),
  decode: (text) => {
    try {
      const parsed = JSON.parse(text) as { archive?: unknown };
      if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { archive?: unknown }).archive)) {
        throw new CodecError("retrieval-archive payload misses archive array");
      }
      return ((parsed as { archive: unknown[] }).archive[0] as unknown);
    } catch (error) {
      if (error instanceof CodecError) throw error;
      throw new CodecError(`retrieval-archive codec could not decode payload: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

// trace:exempt reason=internal-detail
export const CONTEXT_CODECS: readonly ContextCodec<unknown>[] = [
  JSON_CONTEXT_CODEC,
  SUMMARY_CONTEXT_CODEC,
  RETRIEVAL_CONTEXT_CODEC,
];
