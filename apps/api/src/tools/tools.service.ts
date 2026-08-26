import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  getTool,
  TOOL_REGISTRY,
  type AnalysisTool,
  type ClubDataset,
  type Evidence,
  type ToolParamSpec,
} from '../clubscope-core';
import { DatasetService } from '../dataset/dataset.service';
import type { ToolCatalogueEntryDto, ToolCatalogueResponseDto } from './dto/tool.dto';

@Injectable()
export class ToolsService {
  private catalogueCache: ToolCatalogueResponseDto | null = null;

  constructor(private readonly datasets: DatasetService) {}

  /**
   * The registry, rendered for a human reader.
   *
   * Each entry carries an `exampleParams` set that is valid *for the loaded dataset*, so a
   * reviewer can copy it straight into `POST /tools/{name}/run` and see a real Evidence
   * record without first reading the domain model. Building that example also runs the tool
   * once, which is where `resultUnit` and `resultKind` come from — those are properties of
   * the computation, not of the declaration, so observing them beats asserting them from a
   * hand-maintained table that would drift the first time a tool changed.
   *
   * Memoised because the probe genuinely executes all sixteen tools, and the answer cannot
   * change while the dataset is fixed.
   */
  catalogue(): ToolCatalogueResponseDto {
    if (this.catalogueCache !== null) return this.catalogueCache;

    const ds = this.datasets.dataset();
    const tools = [...TOOL_REGISTRY.values()].map((tool) => this.describe(tool, ds));

    this.catalogueCache = { count: TOOL_REGISTRY.size, tools };
    return this.catalogueCache;
  }

  /**
   * Executes one tool and returns its Evidence.
   *
   * Argument validation is delegated to the tool rather than duplicated in a DTO. Core's
   * tools already guard every parameter at runtime — they have to, because in production
   * those arguments arrive from a language model — and re-implementing those rules here
   * would create two definitions of "valid" that drift apart. So a thrown tool error becomes
   * a 400 carrying the tool's own message, which is written to be actionable.
   */
  run(name: string, params: Record<string, unknown>): Evidence {
    const tool = getTool(name);
    if (!tool) {
      throw new NotFoundException(
        `No analysis tool named "${name}". Call GET /tools for the registry.`,
      );
    }

    try {
      return tool.run(params, this.datasets.dataset());
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : `Tool "${name}" rejected those arguments.`,
      );
    }
  }

  private describe(tool: AnalysisTool<unknown>, ds: ClubDataset): ToolCatalogueEntryDto {
    const params = Object.entries(tool.params).map(([name, spec]) => ({
      name,
      type: spec.type,
      required: spec.required === true,
      description: spec.description,
      ...(spec.enum ? { enum: spec.enum } : {}),
      ...(spec.default === undefined ? {} : { default: spec.default }),
    }));

    const exampleParams = this.synthesiseParams(tool, ds);
    let resultUnit: string | null = null;
    let resultKind: string | null = null;

    if (exampleParams) {
      try {
        const probe = tool.run(exampleParams, ds);
        resultUnit = probe.unit;
        resultKind = probe.value.kind;
      } catch {
        // A tool that rejects its own synthesised example is reported as unprobed rather
        // than crashing the catalogue. The catalogue is documentation; it must never be the
        // reason the API is down.
        return { ...base(tool), params, resultUnit: null, resultKind: null, exampleParams: null };
      }
    }

    return { ...base(tool), params, resultUnit, resultKind, exampleParams };
  }

  /**
   * Builds a valid argument set from a tool's own parameter specs plus the dataset.
   *
   * Four rules, in order, and no more: a declared default wins; an enum takes its first
   * allowed value; a period is the most recent twelve months of coverage; and the two
   * arguments only the data can supply — a member id and a note keyword — are read off real
   * rows. If a required parameter matches none of those, no example is produced and the
   * entry says so, because a plausible-looking example that does not actually run would be
   * worse than none.
   *
   * The period rule is the one worth explaining. Spanning the *entire* coverage window looks
   * like the obvious choice and is wrong: several tools compare a period against the equal
   * length window immediately before it, and for a period covering all the data that window
   * is empty — so `revenue_trend` and `visit_trend` would correctly refuse to divide by a
   * zero baseline and the catalogue would advertise two examples that 400. The most recent
   * year always leaves a full year of baseline behind it, and is the window a general
   * manager asks about anyway.
   */
  private synthesiseParams(
    tool: AnalysisTool<unknown>,
    ds: ClubDataset,
  ): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};

    for (const [name, spec] of Object.entries(tool.params) as Array<[string, ToolParamSpec]>) {
      const value = this.exampleValueFor(name, spec, ds);
      if (value !== undefined) out[name] = value;
      else if (spec.required === true) return null;
    }
    return out;
  }

  private exampleValueFor(
    name: string,
    spec: ToolParamSpec,
    ds: ClubDataset,
  ): unknown | undefined {
    if (spec.default !== undefined) return spec.default;
    if (spec.type === 'enum') return spec.enum?.[0];
    if (name === 'from') return oneYearBefore(ds.club.dataTo);
    if (name === 'to') return ds.club.dataTo;
    if (name === 'memberId') return ds.members[0]?.id;
    if (name === 'query') return keywordFromNotes(ds);
    return undefined;
  }
}

function base(tool: AnalysisTool<unknown>): Pick<
  ToolCatalogueEntryDto,
  'name' | 'version' | 'kind' | 'description'
> {
  return {
    name: tool.name,
    version: tool.version,
    kind: tool.kind,
    description: tool.description,
  };
}

/** The inclusive start of the 365-day window ending on `dataTo`. */
function oneYearBefore(dataTo: string): string {
  const start = Date.parse(`${dataTo}T00:00:00.000Z`) - 364 * 86_400_000;
  return new Date(start).toISOString().slice(0, 10);
}

/**
 * A keyword lifted from a real staff note, so the note-search example returns at least one
 * match instead of demonstrating the empty case.
 */
function keywordFromNotes(ds: ClubDataset): string | undefined {
  const words = (ds.notes[0]?.body ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5);
  return words[0];
}
