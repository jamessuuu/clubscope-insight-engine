import { NextResponse } from 'next/server';
import { TOOL_REGISTRY } from '@clubscope/core/tools';
import { verifyNarrative } from '@clubscope/core/verify';
import { club } from '@/lib/club';
import { sandboxEvidenceMap } from '@/lib/sandbox';

/**
 * The verifier sandbox endpoint.
 *
 * It runs the real `verifyNarrative` against the real tool registry and the real dataset. The
 * evidence map is restricted to the handful of records the sandbox publishes, which is not a
 * safety fudge but the honest scope: a citation to an id that was never produced by a tool
 * call in this context is exactly the `unknown-evidence` failure the gate is meant to catch,
 * and the sandbox should demonstrate that rather than paper over it.
 *
 * The length cap is the only guard that matters here. Verification is O(figures) over a
 * string, so a megabyte of digits is the one input that could turn a demo into a CPU sink.
 */
const MAX_NARRATIVE = 4000;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const narrative =
    typeof body === 'object' && body !== null && 'narrative' in body
      ? (body as { narrative: unknown }).narrative
      : undefined;

  if (typeof narrative !== 'string') {
    return NextResponse.json(
      { error: 'Expected { narrative: string }.' },
      { status: 400 },
    );
  }

  if (narrative.length > MAX_NARRATIVE) {
    return NextResponse.json(
      { error: `Narrative is limited to ${MAX_NARRATIVE} characters.` },
      { status: 413 },
    );
  }

  const report = verifyNarrative({
    narrative,
    evidence: sandboxEvidenceMap(),
    dataset: club(),
    tools: TOOL_REGISTRY,
  });

  return NextResponse.json({ report });
}
