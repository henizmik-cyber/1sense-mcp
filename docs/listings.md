# Registry listing drafts

Drafts for MCP registry submissions — **nothing here has been submitted**.
The production endpoint is `https://1sensedata.com/mcp`.

Shared fields:

- **Name:** 1Sense Data — German Property
- **One-liner (HANDOFF §1):** Look up German land parcels, zoning values and
  company structures. Owner chains available via early access.
- **Endpoint:** `https://1sensedata.com/mcp` (Streamable HTTP, no auth; 10 calls/day/IP
  anonymous)
- **Categories/tags:** real-estate, geodata, germany, property, land-registry,
  due-diligence, company-data
- **Repository:** https://github.com/henizmik-cyber/1sense-mcp (make public
  before submitting)

## Long description (shared basis)

> 1Sense Data is the MCP server for German property research. AI agents doing
> site acquisition, deal screening, collateral checks or expansion planning can
> query official German data directly:
>
> - **Parcels (Flurstücke):** search by city or bounding box with size filters;
>   full geometry, Gemarkung/Flur, neighbors, map links (ALKIS open data).
> - **Bodenrichtwerte:** official standard land values (EUR/m², Stichtag,
>   Nutzungsart) for any parcel or coordinate, from BORIS-NRW.
> - **Companies:** German register data — court, seat, status, SPV indicator,
>   officers (legal entities only), related entities (OffeneRegister).
> - **Buildable estimate:** rough GFA from default density values, clearly
>   labeled as an estimate.
> - **Owner chains & company property holdings:** available via early access —
>   open tools preview counts and structure depth, never personal data.
>
> Coverage v1: all of Nordrhein-Westfalen (~9.4M parcels). Every response
> states its coverage honestly; Bavaria returns `not-available` because Bavaria
> publishes no open parcel data. Anonymous use is rate-limited; `request_access`
> gets you early access and higher limits.

## Per-registry notes

### Anthropic MCP directory
- Submission: https://docs.claude.com (directory submission form) — requires
  public repo + privacy/usage statement.
- Emphasize: remote Streamable HTTP server, no local install, no credentials.
- Statement: no personal data served; register and geodata are from open/licensed
  sources (dl-de/zero-2.0, CC-BY 4.0 OpenCorporates attribution).

### Smithery (smithery.ai)
- Listing type: remote server. Provide `smithery.yaml` later if we add the CLI
  install path; the hosted URL listing is enough for v1.
- Install snippet to show:
  `claude mcp add --transport http 1sense https://1sensedata.com/mcp`

### mcp.so
- Simple directory entry: name, one-liner, endpoint, GitHub link, tags.

### PulseMCP
- Same as mcp.so; include the three example prompts below — PulseMCP renders
  usage examples prominently.

### Glama (glama.ai/mcp)
- Reads the GitHub repo (README badges, license). Make the repo public first;
  the README already contains install snippets for Claude Desktop/Code and
  Cursor.

## Example prompts (all registries)

1. "Find parcels over 5.000 m² in Köln and tell me the Bodenrichtwert for the
   three largest."
2. "What is the Bodenrichtwert at lat 50.94, lng 6.95, and roughly how much GFA
   could a 5.200 m² parcel there support?"
3. "Look up 'Objekt Rheinpark' in the company register, show its structure, and
   check who owns parcel 05 2601 007 00123."

## Pre-submission checklist

- [ ] Repo public (currently private)
- [x] Custom domain `1sensedata.com/mcp` live
- [ ] `request_access` lead handling monitored (locked-hit KPI dashboards)
- [ ] Rate limits verified under directory-crawler traffic
