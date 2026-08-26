import { NextResponse } from 'next/server';
import { recomputeEvidence } from '@/lib/receipts';

/**
 * On-demand recomputation for the receipt drawer.
 *
 * The whole product argument is that a figure can be re-derived from source rather than
 * merely retrieved, so the panel that makes that argument does the re-derivation at the
 * moment someone asks — not at build time, with the result cached into the page.
 *
 * The request names a tool, a version and the parameters recorded on the evidence. Nothing
 * else is trusted: the tool must be in the registry, the version must match it, and the
 * value that comes back is whatever the registry computes today. A caller can ask for a
 * recomputation of anything; it cannot influence the answer.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Body must be an object.' }, { status: 400 });
  }

  const { tool, toolVersion, params } = body as {
    tool?: unknown;
    toolVersion?: unknown;
    params?: unknown;
  };

  if (typeof tool !== 'string' || typeof toolVersion !== 'string') {
    return NextResponse.json(
      { error: 'Expected { tool: string, toolVersion: string, params: object }.' },
      { status: 400 },
    );
  }

  const result = recomputeEvidence({
    tool,
    toolVersion,
    params:
      typeof params === 'object' && params !== null
        ? (params as Record<string, unknown>)
        : {},
  });

  return NextResponse.json({ result });
}
