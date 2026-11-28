import { z, type ZodRawShape } from "zod";
import type { ToolContext } from "../lib/types.js";
import { estimateBuildable, getParcel, searchParcels } from "./parcels.js";
import { getBodenrichtwert } from "./bodenrichtwert.js";
import { findCompany } from "./companies.js";
import { companyProperties, getOwnerChain } from "./gated.js";
import { requestAccess } from "./access.js";

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  schema: ZodRawShape;
  annotations: ToolAnnotations;
  /** request_access must work even when the anonymous budget is used up. */
  rateLimitExempt?: boolean;
  handler: (ctx: ToolContext, args: never) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_parcels",
    annotations: { title: "Search parcels", readOnlyHint: true },
    description:
      "Search German land parcels (Flurstücke) by city or bounding box, with optional size filters. Coverage: most of Germany from the Länder's open cadastre data — Bavaria publishes none; the response's coverage_note lists the Länder loaded. Returns parcel ids, sizes, municipality, centroid and map links.",
    schema: {
      city: z
        .string()
        .optional()
        .describe('Gemeinde or Gemarkung name, e.g. "Köln" or "Düsseldorf"'),
      bbox: z
        .array(z.number())
        .length(4)
        .optional()
        .describe("WGS84 bounding box [minLng, minLat, maxLng, maxLat]"),
      min_m2: z.number().min(0).optional().describe("Minimum parcel size in m²"),
      max_m2: z.number().min(0).optional().describe("Maximum parcel size in m²"),
      zoning: z
        .string()
        .optional()
        .describe("Zoning keyword — NOT applied in v1 (no XPlanung data yet); stated in the response if passed"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results, default 20"),
    },
    handler: searchParcels,
  },
  {
    name: "get_parcel",
    annotations: { title: "Get parcel details", readOnlyHint: true },
    description:
      "Look up one parcel by Flurstückskennzeichen: geometry (GeoJSON), size, Gemarkung/Flur, approximate neighbors, map link. Coverage: most of Germany (not Bavaria); every response states its coverage.",
    schema: {
      parcel_id: z
        .string()
        .describe('Flurstückskennzeichen, e.g. "05 2601 007 00123" or "052601007001230000"'),
    },
    handler: getParcel,
  },
  {
    name: "get_bodenrichtwert",
    annotations: { title: "Get Bodenrichtwert (land value)", readOnlyHint: true },
    description:
      "Official standard land value (Bodenrichtwert) for a parcel id or WGS84 point: EUR/m², Stichtag (Stand), Nutzungsart, with the source per Land. Available only where a Land publishes Bodenrichtwerte as open data (e.g. NRW, Niedersachsen, Bremen, Hamburg, Hessen, Berlin, Brandenburg, Mecklenburg-Vorpommern, Sachsen-Anhalt, Thüringen); elsewhere the response says why none is available.",
    schema: {
      parcel_id: z.string().optional().describe("Flurstückskennzeichen (alternative to lat/lng)"),
      lat: z.number().min(-90).max(90).optional().describe("WGS84 latitude"),
      lng: z.number().min(-180).max(180).optional().describe("WGS84 longitude"),
    },
    handler: getBodenrichtwert,
  },
  {
    name: "find_company",
    annotations: { title: "Find company", readOnlyHint: true },
    description:
      "Find German companies by name or register number (e.g. HRB). Returns register court, seat, status, purpose, SPV indicator, officers (legal entities only — natural persons are never returned) and related entities by name pattern.",
    schema: {
      query: z.string().describe('Company name or register number, e.g. "Objekt Köln" or "HRB 12345"'),
    },
    handler: findCompany,
  },
  {
    name: "estimate_buildable",
    annotations: { title: "Estimate buildable area", readOnlyHint: true },
    description:
      "Rough gross-floor-area estimate for a parcel from default GRZ/floor values. Clearly labeled estimate; no zoning or LoD2 height data is used. Coverage: wherever parcels are loaded (not Bavaria).",
    schema: {
      parcel_id: z.string().describe("Flurstückskennzeichen"),
    },
    handler: estimateBuildable,
  },
  {
    name: "get_owner_chain",
    annotations: { title: "Get owner chain (early access)", readOnlyHint: true },
    description:
      "Ownership chain for a parcel (owner entity, intermediate holdings). Early-access feature: returns a locked preview with counts and structure depth — never personal data.",
    schema: {
      parcel_id: z.string().describe("Flurstückskennzeichen"),
    },
    handler: getOwnerChain,
  },
  {
    name: "company_properties",
    annotations: { title: "Company property holdings (early access)", readOnlyHint: true },
    description:
      "Properties held by a company. Early-access feature: returns a locked preview (property count + cities only).",
    schema: {
      company_id: z.string().optional().describe("Company id from find_company"),
      name: z.string().optional().describe("Company name (alternative to company_id)"),
    },
    handler: companyProperties,
  },
  {
    name: "request_access",
    annotations: { title: "Request early access", readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Request early access to 1Sense Data: owner chains, company-property links and higher rate limits. Takes your email and use case, records the request, returns a confirmation.",
    schema: {
      email: z.string().describe("Contact email address"),
      use_case: z.string().describe("One or two sentences: what do you want to do with the data?"),
      source_tool: z
        .string()
        .optional()
        .describe("Optional: which tool led you here (e.g. get_owner_chain)"),
    },
    rateLimitExempt: true,
    handler: requestAccess,
  },
];
