/**
 * API metadata, in one place.
 *
 * `/health` and the OpenAPI document both report the version; keeping a single constant
 * means they cannot drift and disagree about which build a reviewer is looking at.
 */
export const API_TITLE = 'ClubScope Insight Engine API';
export const API_VERSION = '0.1.0';
export const DEFAULT_PORT = 3101;
export const SWAGGER_PATH = 'docs';

/** Swagger tags, declared once so every controller groups under a known name. */
export const API_TAGS = {
  health: 'health',
  club: 'club',
  members: 'members',
  insights: 'insights',
  tools: 'tools',
  assistant: 'assistant',
  verification: 'verification',
} as const;

export const API_DESCRIPTION = `
HTTP surface over the ClubScope insight engine.

**The premise.** The language model never produces a number. It selects typed analysis
tools; every figure it reports is re-computed by a deterministic verifier before it reaches
a screen. This API exposes each layer of that contract separately so the claim can be
checked rather than believed:

| To inspect | Call |
|---|---|
| the grounding layer | \`GET /tools\`, then \`POST /tools/{name}/run\` — every call returns an **Evidence** record: value, unit, method, and the exact source row ids |
| the gate | \`POST /verify\` — post a narrative with a deliberately wrong figure and watch it come back \`blocked\` |
| the detected feed | \`GET /insights\` — each insight carries its evidence and its verification report |
| the deterministic scoring | \`GET /members/{id}\` — a churn score with per-signal point contributions, no model involved |
| the assistant | \`GET /assistant/turns\`, then \`POST /assistant/ask\` |

**Replay mode.** With no \`ANTHROPIC_API_KEY\` configured the assistant answers from scripted
turns: the tool calls, the Evidence and the verification are all computed live against the
dataset on every request — only the choice of tools and the wording of the prose are fixed
in advance. \`GET /health\` reports which mode is active, and every assistant response
carries \`servedBy\`. That boundary is stated rather than hidden, because a reviewer who
finds one undisclosed limitation stops believing the disclosed parts too.

**Data.** Deterministically seeded synthetic club data — around 420 members over 24 months.
No real club data is used. Independent work by James Lorenz Santos; not affiliated with
ClubScope.
`.trim();
