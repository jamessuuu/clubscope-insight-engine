/**
 * Model provider abstraction.
 *
 * Two implementations ship: a live Anthropic client, and a replay client that serves
 * recorded transcripts.
 *
 * Replay is not a toy. It exists for three reasons that all matter in production:
 *
 *  1. **Demos must not depend on a network.** A conference-room wifi failure should not be
 *     able to break a product walkthrough.
 *  2. **Evals need determinism.** Scoring a suite against a live model conflates regression
 *     in your prompt with ordinary sampling variance. Replay pins the model's side so a
 *     failing case means *your* code changed.
 *  3. **Cost.** Re-running a suite hundreds of times during development against a frontier
 *     model is a real bill for no additional information.
 *
 * The recording is keyed by a hash of the exact request, so a changed prompt misses the
 * cache and is visibly reported as unrecorded rather than silently answered with a stale
 * response — a cache that quietly lies is worse than no cache.
 */

import { createHash } from 'node:crypto';

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  maxTokens: number;
  /** Zero by default: the same question should produce the same answer. */
  temperature: number;
  model: string;
}

export interface CompletionResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | string;
  usage: { inputTokens: number; outputTokens: number };
  /** Which provider actually served this turn — surfaced in the UI, never hidden. */
  servedBy: 'anthropic' | 'replay';
  latencyMs: number;
}

export interface ModelProvider {
  readonly kind: 'anthropic' | 'replay';
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/** Stable key for a request. Any change to system prompt, tools or history changes it. */
export function requestFingerprint(req: CompletionRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        system: req.system,
        messages: req.messages,
        tools: req.tools.map((t) => [t.name, t.description, t.input_schema]),
        model: req.model,
        temperature: req.temperature,
      }),
    )
    .digest('hex')
    .slice(0, 24);
}

export class UnrecordedRequestError extends Error {
  constructor(public readonly fingerprint: string) {
    super(
      `No recorded response for request ${fingerprint}. ` +
        `Run with ANTHROPIC_API_KEY set and RECORD=1 to capture it.`,
    );
    this.name = 'UnrecordedRequestError';
  }
}

export type Cassette = Record<string, { response: CompletionResponse; note?: string }>;

export class ReplayProvider implements ModelProvider {
  readonly kind = 'replay' as const;

  constructor(private readonly cassette: Cassette) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const fp = requestFingerprint(req);
    const hit = this.cassette[fp];
    if (!hit) throw new UnrecordedRequestError(fp);
    // Report honestly: this response did not cost tokens or time now, and the UI says so.
    return { ...hit.response, servedBy: 'replay', latencyMs: 0 };
  }
}

export interface AnthropicOptions {
  apiKey: string;
  baseUrl?: string;
  /** Called with (fingerprint, response) after every live call, for recording. */
  onRecord?: (fingerprint: string, response: CompletionResponse) => void;
}

export class AnthropicProvider implements ModelProvider {
  readonly kind = 'anthropic' as const;

  constructor(private readonly opts: AnthropicOptions) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const started = Date.now();
    const res = await fetch(`${this.opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        tools: req.tools,
        messages: req.messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      content: ContentBlock[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const response: CompletionResponse = {
      content: json.content,
      stopReason: json.stop_reason,
      usage: { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens },
      servedBy: 'anthropic',
      latencyMs: Date.now() - started,
    };

    this.opts.onRecord?.(requestFingerprint(req), response);
    return response;
  }
}

/**
 * Falls back to replay when no key is configured, and says which one it chose.
 * Silent fallbacks are a bug factory; this one is explicit and inspectable.
 */
export function selectProvider(args: {
  apiKey?: string;
  cassette: Cassette;
  onRecord?: (fp: string, r: CompletionResponse) => void;
}): ModelProvider {
  if (args.apiKey && args.apiKey.trim() !== '') {
    return new AnthropicProvider({ apiKey: args.apiKey, onRecord: args.onRecord });
  }
  return new ReplayProvider(args.cassette);
}
