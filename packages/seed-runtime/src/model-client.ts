// Seed-runtime model provider: OpenRouter chat completions over HTTPS.
//
// Purpose: the organism's only path to a real model — one function that
// turns (system, messages, tools) into either text or a tool call, so
// `seed run` executes a model→tool→result→model loop instead of a
// hard-coded probe.
// Why it exists: TOTALSPEC G1/G4/PHASE-2 need a real coding-agent loop;
// without a provider client there is no agent, only scaffolding.
// Responsibilities: OpenAI-compatible /chat/completions call, tool schema
// framing for the python primitive, usage extraction, fail-closed errors.
// Invariants: stdlib only (global fetch, no deps); never logs the API key;
// missing OPENROUTER_API_KEY throws before any network call; every call
// returns usage tokens (0 when the provider omits them).
// Public types/functions: ModelMessage, PythonToolSpec, ModelTurn,
// completeModelTurn, DEFAULT_MODEL.

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

export interface PythonToolSpec {
  code: string;
  timeout_ms?: number;
}

export interface ModelTurn {
  text: string;
  toolCall: PythonToolSpec | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// trace:exempt reason=internal-detail
export const DEFAULT_MODEL = process.env.SEED_MODEL ?? "anthropic/claude-sonnet-4";

const PYTHON_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "python",
    description:
      "Execute Python code in the confined workspace (30s default, 300s cap). " +
      "Use for reading/writing files, subprocesses (git, yarn, uv), scripts, tests. " +
      "cwd defaults to the workspace root and must stay inside it. " +
      "Helper scripts worth reusing go under $SEED_SCRATCH.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Python source to run on stdin" },
        timeout_ms: { type: "number", description: "Wall-clock timeout, max 300000" },
      },
      required: ["code"],
    },
  },
} as const;

/**
 * Build the chat-completions body. Exported so the wire contract — including
 * that "off" sends no reasoning field at all — is directly testable without a
 * network call.
 */
// trace:v1 id=impl.rt-model-body work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function buildChatRequest(init: {
  model?: string;
  system: string;
  messages: ModelMessage[];
  maxTokens?: number;
  reasoning?: string;
}): Record<string, unknown> {
  const wireMessages = [
    { role: "system", content: init.system },
    ...init.messages.map((m) =>
      m.role === "tool"
        ? { role: "tool", tool_call_id: m.tool_call_id ?? "", content: m.content }
        : { role: m.role, content: m.content },
    ),
  ];
  return {
    model: init.model ?? DEFAULT_MODEL,
    messages: wireMessages,
    tools: [PYTHON_TOOL_DEFINITION],
    tool_choice: "auto",
    max_tokens: init.maxTokens ?? 4096,
    // Absent or "off" sends nothing: a provider that does not reason must not
    // receive a meaningless parameter.
    ...(init.reasoning && init.reasoning !== "off" ? { reasoning: { effort: init.reasoning } } : {}),
  };
}

// trace:v1 id=impl.rt-model-turn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export async function completeModelTurn(init: {
  model?: string;
  system: string;
  messages: ModelMessage[];
  maxTokens?: number;
  /**
   * Requested reasoning effort (off|low|medium|high). Omitted or "off" sends
   * nothing, so a provider that does not reason is never sent a meaningless
   * parameter.
   */
  reasoning?: string;
}): Promise<ModelTurn> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (!apiKey) {
    throw new Error(
      "model call needs OPENROUTER_API_KEY (budget: credentials, limit: key present, requested: missing); " +
      "export it or add it to .env — see .env.example",
    );
  }
  let response: Response;
  const request = buildChatRequest(init);
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/carterlasalle/seed-harness",
        "X-Title": "seed-harness",
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    throw new Error(`model call failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`model call failed (status ${response.status}): ${body.slice(0, 300)}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string }>;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("model call returned no choices");
  const rawContent = message.content;
  const text =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((p) => p.text ?? "").join("")
        : "";
  const toolCall = message.tool_calls?.[0]?.function;
  let parsed: PythonToolSpec | null = null;
  if (toolCall?.name === "python" && typeof toolCall.arguments === "string") {
    try {
      const args = JSON.parse(toolCall.arguments) as { code?: unknown; timeout_ms?: unknown };
      if (typeof args.code === "string" && args.code.length > 0) {
        parsed = {
          code: args.code,
          timeout_ms: typeof args.timeout_ms === "number" ? args.timeout_ms : undefined,
        };
      }
    } catch {
      parsed = null;
    }
  }
  return {
    text,
    toolCall: parsed,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    model: typeof request.model === "string" ? request.model : DEFAULT_MODEL,
  };
}
