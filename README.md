# ClubScope Insight Engine — concept prototype

**Grounded AI insights and an acting assistant over private-club operations data.**

> **Independent concept prototype.** Built by James Lorenz Santos as a discussion artifact for
> a conversation with [ClubScope](https://clubscope.ai) about their AI App Developer role.
> Not affiliated with, endorsed by, or connected to ClubScope. Every figure in this
> application comes from a **synthetic dataset generated from a fixed seed** — no real club,
> member, or financial data is used anywhere.

---

## Why I built it

ClubScope's brief for the role is unusually specific about the hard part:

> "You'd be building AI that works directly with real club data to surface insights and
> recommendations, as well as assistants that can answer questions and take actions."
>
> "…experience making AI output **reliable, testable, and grounded in real data**."

Most AI demos are strong on the first sentence and silent on the second. They generate
fluent narrative over a dataset and ask you to trust the numbers. That is precisely the
thing that cannot ship to a general manager who is about to spend money on the strength of
it.

So this prototype is organised around a single constraint:

> **The language model never produces a number.** It selects typed analysis tools; every
> figure it writes must cite the evidence it came from; and a deterministic verifier
> re-computes each figure from source data before anything renders. A figure that cannot be
> re-derived does not appear.

---

## The grounding contract

```
                 ┌──────────────────────────────────────────┐
  question ─────▶│  Assistant (tool-calling)                │
                 │  MAY: choose tools, choose arguments,     │
                 │       write prose, propose actions        │
                 │  MAY NOT: compute, aggregate, estimate    │
                 └───────────────┬──────────────────────────┘
                                 │ typed tool calls
                 ┌───────────────▼──────────────────────────┐
                 │  Analysis Tool Registry (pure functions)  │
                 │  every call returns an Evidence record:   │
                 │   { value, unit, method, params,          │
                 │     rowIds[], rowCount, computedAt }      │
                 └───────────────┬──────────────────────────┘
                                 │ claims cite [[e:<id>|figure]]
                 ┌───────────────▼──────────────────────────┐
                 │  Groundedness Verifier (deterministic)    │
                 │  re-runs each cited tool from source and  │
                 │  compares; sweeps prose for uncited       │
                 │  figures; FAILS CLOSED                    │
                 └───────────────┬──────────────────────────┘
                                 │ verified claims + receipts
                 ┌───────────────▼──────────────────────────┐
                 │  UI — every figure clicks through to the  │
                 │  rows and the recomputation               │
                 └──────────────────────────────────────────┘
```

### What the verifier does and does not prove

Stated plainly, because an honest scope is the point:

| Guarantee | Mechanism |
|---|---|
| The narrative's figures match what the tools actually returned | **Groundedness verifier** (recomputation, fails closed) |
| The tools compute the right thing | **Unit tests** on pure functions with hand-checked fixtures |
| The assistant chose the *right* tool for the question | **Eval suite** with golden cases and negative controls |

Three different guarantees, three different mechanisms. Any system claiming one gate covers
all three is overselling.

### Rounding is handled properly

A naive verifier rejects `$1.2M` for `1,241,880` — technically a mismatch, journalistically
correct — which trains the model toward unreadable prose. This one infers the *precision the
writer claimed* and accepts the figure only if the true value lies in the interval that
rounds to it. `$1.2M` asserts `[1.15M, 1.25M)`. `1,241,880` asserts `[1241879.5, 1241880.5)`.
Both are honest at their stated precision, and both are checkable.

---

## What this does

- **Insight feed** — findings are **detected by deterministic code with named thresholds**,
  not "found" by a model. A quiet week produces a quiet feed. The model's only job is
  narration, whose worst failure mode is awkward phrasing rather than an invented trend.
- **Member 360** — churn risk computed by transparent, versioned arithmetic with per-signal
  contributions, and baselines set **per member** (a Social member visiting twice a month has
  not disengaged; a Full Golf member doing the same has). A score that directs retention
  spend must be reproducible and defensible to a committee, which is not a language model's
  strength.
- **Ask ClubScope** — an assistant that answers *and* acts. Actions are **proposed, never
  executed**: a human confirms, and the audit log records which human, when, and that the
  assistant originated it. Accountability survives.
- **Reliability panel** — the eval suite in the browser, including a deliberately poisoned
  case that shows the verifier blocking a fabricated figure, and a sandbox where you can
  edit a number yourself and watch it fail.

---

## Honest limitations

This is a prototype, and the things it does not do are stated here rather than discovered:

1. **No model API key is configured in the public deployment.** The assistant runs in
   **replay mode**: the *wording* is scripted. Everything else is real on every request —
   tools execute, evidence is computed from the dataset, figures are the values those tools
   returned, and the verifier runs the full recomputation pass. With `ANTHROPIC_API_KEY` set,
   the identical pipeline runs with Claude choosing the tools and writing the prose, and it
   must satisfy the same citation contract to render.
2. **Action state is client-side only.** Confirming an action updates the page's audit log;
   nothing persists server-side. Each visitor gets a clean club.
3. **The dataset is synthetic**, generated from a fixed seed. It is behaviourally realistic —
   seasonality, per-category usage patterns, genuine pre-resignation decay, and a few planted
   anomalies so the detectors have something true to find — but it is not real club data.
4. **Single tenant, no auth.** Out of scope for a discussion artifact.

---

## Stack

Deliberately ClubScope's own: **TypeScript**, **NestJS**, **Next.js**.

```
packages/core     framework-free: domain, analysis tools, verifier, scoring, insights, evals
apps/api          NestJS service — REST + OpenAPI over the same core
apps/web          Next.js App Router UI
```

`packages/core` depends on no web framework and no model SDK, which is what makes its
guarantees testable in isolation. Both apps are thin shells over it — so the API and the UI
can never disagree about what a number means.

## Running it

```bash
pnpm install
pnpm dev          # web on :3100, api on :3101 (Swagger at :3101/docs)
pnpm test         # unit + integration across core, api and web
pnpm evals        # the eval suite, in the terminal
```

Optional, for live model mode:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Author

**James Lorenz Santos** — AI application developer. Agentic systems, production AI features,
and the evaluation harnesses that keep them honest.

[agentjames.vercel.app](https://agentjames.vercel.app) · [github.com/jamessuuu](https://github.com/jamessuuu)
