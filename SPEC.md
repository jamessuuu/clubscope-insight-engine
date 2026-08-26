# ClubScope Insight Engine — concept prototype

**Built by:** James Lorenz Santos · **For:** ClubScope AI App Developer conversation
**Status:** working prototype, synthetic data, independent and unaffiliated

---

## 1. Why this exists

ClubScope's brief for the AI App Developer role is specific:

> "You'd be building AI that works directly with real club data to surface insights and
> recommendations, as well as assistants that can answer questions and take actions."
> "…experience making AI output **reliable, testable, and grounded in real data**."

Most AI demos fail exactly there. They produce fluent narrative over a dataset and ask you
to trust the numbers. This prototype is built around the opposite premise:

> **The language model never produces a number. It selects typed analysis tools, and every
> figure it reports is re-computed by a deterministic verifier before it reaches the screen.**

That single constraint is what makes AI output shippable to a club GM who will act on it.

---

## 2. The four club problems, from ClubScope's own site

| ClubScope states | This prototype answers with |
|---|---|
| "Limited forecasting capabilities" | Statistical forecast (seasonal + trend, with interval) — *narrated* by the LLM, never *computed* by it |
| "Fragmented systems… hard to align finance, operations, and engagement" | One unified member/revenue/utilisation model; every insight can cross domains |
| "Difficulty tracking member engagement" | Member 360 + deterministic, explainable engagement & churn scoring |
| "Slow, Manual Reporting" | Insight feed generated on demand; assistant drafts and files reports as actions |

---

## 3. Core architecture — the grounding contract

```
                 ┌──────────────────────────────────────────┐
  question ─────▶│  Assistant (Claude, tool-calling)        │
                 │  MAY: choose tools, choose arguments,     │
                 │       write prose, propose actions        │
                 │  MAY NOT: compute, aggregate, estimate    │
                 └───────────────┬──────────────────────────┘
                                 │ typed tool calls
                 ┌───────────────▼──────────────────────────┐
                 │  Analysis Tool Registry (pure TypeScript) │
                 │  every tool returns an Evidence record:   │
                 │   { value, unit, method, params,          │
                 │     rowIds[], computedAt, toolVersion }   │
                 └───────────────┬──────────────────────────┘
                                 │ claims reference evidenceId
                 ┌───────────────▼──────────────────────────┐
                 │  Groundedness Verifier (deterministic)    │
                 │  re-executes each referenced computation, │
                 │  compares to the number in the narrative  │
                 │  mismatch ⇒ claim BLOCKED, not rendered   │
                 └───────────────┬──────────────────────────┘
                                 │ verified claims + receipts
                 ┌───────────────▼──────────────────────────┐
                 │  UI — every figure is click-through to    │
                 │  the rows and the recomputation           │
                 └──────────────────────────────────────────┘
```

**Why this is the right design, not a gimmick.** LLMs are excellent at deciding *what to
look at* and *how to say it*, and unreliable at arithmetic over many rows. Splitting those
two jobs is what makes the output both useful and auditable. It also makes the whole
system testable: tools are pure functions with unit tests, and the verifier is a hard gate
that fails closed.

---

## 4. Features

### 4.1 Insight Feed (`/`)
AI-surfaced insight cards over the club dataset — churn-risk cohorts, revenue anomalies,
facility under-utilisation, dues-renewal exposure, event attendance decline.

Each card carries:
- headline, the "so what", and a **recommended action**
- **evidence chips** — click any number to open the receipt drawer: the exact rows, the
  method, and the live recomputation
- a **Verified** badge issued by the verifier, or a **Blocked** state showing what failed

### 4.2 Member 360 (`/members/[id]`)
Tenure, spend by category, visit cadence, event attendance, engagement timeline.

**Churn risk is computed deterministically** by a transparent weighted model, with
per-feature contributions shown ("visits down 62% against this member's own 12-month
baseline → +31 risk"). The LLM's only job is to explain that score in plain English. This
is deliberate: a score that drives retention spend must be reproducible and defensible.

### 4.3 Ask ClubScope (assistant)
Chat over club data with tool-calling, in two modes:

- **Answer** — read-only tools; grounded, cited, verified
- **Act** — `create_task`, `draft_member_outreach`, `flag_member_for_review`,
  `schedule_report`. Every action is **proposed** as a card requiring explicit human
  confirmation, then written to an **audit log** with full attribution (who/what/when/on
  whose behalf). Nothing executes silently.

It refuses rather than invents: asked for data outside the dataset's range, it says so.

### 4.4 Reliability Panel (`/evals`) — the closer
A golden set of scenarios executed live in the browser:

- pass/fail per case against expected answers
- **groundedness rate** and **verifier catch rate**
- **negative controls** — questions the assistant *must* refuse; refusing correctly is a pass
- **poisoned cases** — a deliberately fabricated figure injected to prove the verifier blocks it
- latency and token cost per case

This turns "reliable and testable" from a claim into a button.

### 4.5 Forecast
Seasonal + trend projection on dues and F&B revenue with a confidence interval, explicitly
labelled **statistical model, not LLM**. Included to show the judgement of knowing when
*not* to reach for a language model.

---

## 5. Stack — deliberately ClubScope's own

| Layer | Choice |
|---|---|
| API | **NestJS** (TypeScript) — modular, DTO-validated, OpenAPI-documented |
| Web | **Next.js** App Router (TypeScript, RSC, streaming) |
| Shared | `packages/core` — framework-free domain, tools, verifier, evals (unit-testable in isolation) |
| Model | Anthropic Claude via a provider interface |
| Data | Deterministically seeded synthetic club dataset (~2 years) |
| Tests | Vitest across core, API and evals |

**Replay mode.** The assistant runs against recorded transcripts when no API key is
present, so the demo never depends on network or quota — and the same recording machinery
gives the eval suite byte-identical determinism. Live mode activates with a key.

---

## 6. Data

Synthetic but behaviourally realistic, generated from a fixed seed so every run is
identical: ~400 members across membership categories, 24 months of dues invoices, F&B
spend, golf rounds, court bookings, fitness check-ins, event registrations, guest passes
and free-text member notes — with genuine seasonality, real churn patterns, and a small
number of planted anomalies so the insight engine has something true to find.

No real club data is used. Nothing here is confidential to anyone.

---

## 7. What this is not

- Not affiliated with, endorsed by, or connected to ClubScope.
- Not a product proposal — ClubScope's own platform is already in MVP with partner clubs.
- Branding follows ClubScope's public visual language purely so the concept is legible in
  their context, and is used respectfully as a discussion artifact.
