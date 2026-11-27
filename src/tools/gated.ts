/**
 * Gated tools (HANDOFF-MCP.md §2): they return the locked shape
 * { status: "locked", preview, unlock } and NEVER personal data.
 *
 * Hard rule enforced here and by tests: these handlers read only from
 * owner_chain_meta / company_properties_meta (counts + structure) and the
 * company name the caller already supplied/queried. No code path touches
 * officers or any person field.
 */
import {
  type Envelope,
  type LockedResponse,
  type ToolContext,
  err,
  locked,
  ok,
} from "../lib/types.js";
import {
  coverageForLandPrefix,
  coverageNoteForLandPrefix,
} from "../lib/coverage.js";
import { parseParcelId } from "../lib/parcel-id.js";

export interface GetOwnerChainArgs {
  parcel_id: string;
}

export async function getOwnerChain(
  ctx: ToolContext,
  args: GetOwnerChainArgs,
): Promise<Envelope<unknown> | LockedResponse> {
  const parsed = parseParcelId(args.parcel_id);
  if (!parsed) {
    return err(
      "invalid_arguments",
      `Could not parse "${args.parcel_id}" as a Flurstückskennzeichen.`,
    );
  }
  const coverage = coverageForLandPrefix(parsed.land);
  if (coverage !== "NRW") {
    return ok(coverage, null, coverageNoteForLandPrefix(parsed.land));
  }

  const meta = await ctx.env.DB.prepare(
    `SELECT owner_entity_type, intermediate_holdings, chain_depth
     FROM owner_chain_meta WHERE parcel_id = ?`,
  )
    .bind(parsed.normalized)
    .first<{
      owner_entity_type: string | null;
      intermediate_holdings: number;
      chain_depth: number;
    }>();

  if (!meta) {
    return locked(
      "No owner chain compiled for this parcel yet. Owner research runs on request for early-access users.",
    );
  }

  const holdings = meta.intermediate_holdings;
  const entityType = meta.owner_entity_type ?? "legal entity";
  return locked(
    `Owner identified: ${entityType}, ${holdings} intermediate holding${holdings === 1 ? "" : "s"} (chain depth ${meta.chain_depth}).`,
  );
}

export interface CompanyPropertiesArgs {
  company_id?: string;
  name?: string;
}

export async function companyProperties(
  ctx: ToolContext,
  args: CompanyPropertiesArgs,
): Promise<Envelope<unknown> | LockedResponse> {
  if (!args.company_id && !args.name) {
    return err(
      "invalid_arguments",
      "Provide `company_id` (from find_company) or `name`.",
    );
  }

  let companyId = args.company_id ?? null;
  let companyName: string | null = null;
  if (!companyId && args.name) {
    const row = await ctx.env.DB.prepare(
      "SELECT id, name FROM companies WHERE name LIKE ?1 COLLATE NOCASE LIMIT 1",
    )
      .bind(`%${args.name.trim()}%`)
      .first<{ id: string; name: string }>();
    if (row) {
      companyId = row.id;
      companyName = row.name;
    }
  }

  if (!companyId) {
    return locked(
      `No company matched "${args.name}" in the ingested register data. Property-ownership lookups run for early-access users.`,
    );
  }

  const meta = await ctx.env.DB.prepare(
    "SELECT property_count, cities FROM company_properties_meta WHERE company_id = ?",
  )
    .bind(companyId)
    .first<{ property_count: number; cities: string | null }>();

  if (!meta) {
    return locked(
      "No property links compiled for this company yet. Property-ownership research runs on request for early-access users.",
    );
  }

  let cities: string[] = [];
  try {
    cities = meta.cities ? (JSON.parse(meta.cities) as string[]) : [];
  } catch {
    cities = [];
  }

  return locked({
    company: companyName ?? companyId,
    property_count: meta.property_count,
    cities,
    detail: "Parcel-level detail is part of early access.",
  });
}
