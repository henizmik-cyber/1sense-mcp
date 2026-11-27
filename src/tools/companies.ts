import { type Envelope, type ToolContext, err, ok } from "../lib/types.js";

interface CompanyRow {
  id: string;
  name: string;
  court: string | null;
  register_number: string | null;
  seat: string | null;
  status: string | null;
  purpose: string | null;
  is_spv: number;
}

interface OfficerRow {
  name: string;
  role: string | null;
}

const PERSON_POLICY_NOTE =
  "Officers listed are legal entities only. Natural persons are never returned by this API, by design.";

const SNAPSHOT_NOTE =
  "Company data: Handelsregister snapshot of 2019-02-05 (OffeneRegister/OpenCorporates, CC-BY 4.0). Live register updates are a later ingestion stage — verify before relying on currentness.";

export interface FindCompanyArgs {
  query: string;
}

/**
 * Company data only. Officer rows for natural persons (is_legal_entity = 0)
 * are excluded in SQL — no code path reads them.
 */
export async function findCompany(
  ctx: ToolContext,
  args: FindCompanyArgs,
): Promise<Envelope<unknown>> {
  const q = args.query.trim();
  if (q.length < 2) {
    return err("invalid_arguments", "`query` must be at least 2 characters (company name or register number like \"HRB 12345\").");
  }

  const { results: companies } = await ctx.env.DB.prepare(
    `SELECT id, name, court, register_number, seat, status, purpose, is_spv
     FROM companies
     WHERE name LIKE ?1 COLLATE NOCASE OR register_number LIKE ?2 COLLATE NOCASE
     LIMIT 10`,
  )
    .bind(`%${q}%`, `%${q.replace(/\s+/g, " ")}%`)
    .all<CompanyRow>();

  if (companies.length === 0) {
    const { total } = (await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS total FROM companies",
    ).first<{ total: number }>()) ?? { total: 0 };
    const note =
      total === 0
        ? "No company data ingested yet — the company graph (OffeneRegister/Handelsregister) is the next ingestion stage."
        : `No company matched "${q}".`;
    return ok("NRW", { count: 0, companies: [] }, note);
  }

  const out = [];
  for (const c of companies) {
    const { results: officers } = await ctx.env.DB.prepare(
      `SELECT name, role FROM officers WHERE company_id = ?1 AND is_legal_entity = 1`,
    )
      .bind(c.id)
      .all<OfficerRow>();

    // Related entities by name pattern: same leading name stem.
    const stem = c.name.split(/\s+/)[0];
    let related: { id: string; name: string }[] = [];
    if (stem && stem.length >= 4) {
      const { results } = await ctx.env.DB.prepare(
        `SELECT id, name FROM companies WHERE name LIKE ?1 AND id != ?2 LIMIT 5`,
      )
        .bind(`${stem}%`, c.id)
        .all<{ id: string; name: string }>();
      related = results;
    }

    out.push({
      id: c.id,
      name: c.name,
      court: c.court,
      register_number: c.register_number,
      seat: c.seat,
      status: c.status,
      purpose: c.purpose,
      spv_indicator: c.is_spv === 1,
      officers_legal_entities: officers,
      related_entities: related,
    });
  }

  return ok(
    "NRW",
    { count: out.length, companies: out },
    `${PERSON_POLICY_NOTE} ${SNAPSHOT_NOTE}`,
  );
}
