#!/usr/bin/env python3
"""Ingest the OffeneRegister company dump (German Handelsregister snapshot).

Source (verified 2026-11-26):
  https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2
  ~260 MB bz2, OpenCorporates schema, snapshot of 2019-02-05.
  License: CC-BY 4.0, attribution to OpenCorporates — keep the attribution
  line in README.md.

Honesty notes baked into the output:
  - The dump is a 2019 snapshot; `retrieved_at` is stored per company? No —
    the schema has no column for it; the README states the snapshot date.
  - The dump has NO Unternehmensgegenstand (purpose) field, so `purpose` stays
    NULL and SPV detection uses the handoff's name patterns only.

Officer policy (HANDOFF-MCP.md: never return a person's name):
  - The dump marks natural persons explicitly with "type": "person"; those rows
    are stored with is_legal_entity = 0 and are never served by any tool.
  - Only officers without an end_date and not flagged dismissed are kept
    (current officers).

Outputs:
  out/sql-companies/companies_*.sql and officers_*.sql
    -> load with: ./load_d1.sh remote out/sql-companies
  Re-ingesting from scratch? Clear first:
    npx wrangler d1 execute onesense --remote --command "DELETE FROM officers; DELETE FROM companies"
  (companies use INSERT OR REPLACE, but officers have no primary key and
  would duplicate.)

Usage:
  python3 ingest_companies.py                 # full dump
  python3 ingest_companies.py --limit 1000    # smoke run
  python3 ingest_companies.py --land "North Rhine-Westphalia"
"""

from __future__ import annotations

import argparse
import bz2
import json
import re
from pathlib import Path

from common import SqlChunkWriter

DUMP_URL = "https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2"

COMPANY_COLUMNS = [
    "id", "name", "court", "register_number", "seat", "status", "purpose", "is_spv",
]
OFFICER_COLUMNS = ["company_id", "name", "role", "is_legal_entity"]

# HANDOFF-MCP.md §3: "Objekt", "Grundstücks-", "Projekt … GmbH & Co. KG"
SPV_PATTERNS = [
    re.compile(r"\bobjekt", re.IGNORECASE),
    re.compile(r"grundst(ü|ue)cks", re.IGNORECASE),
    re.compile(r"projekt.*gmbh\s*&\s*co\.?\s*kg", re.IGNORECASE),
]

# Legal-form markers for officers whose "type" field is absent.
LEGAL_FORM_RE = re.compile(
    r"\b(GmbH|mbH|AG|SE|KG|KGaA|UG|OHG|e\.?\s?V\.?|eG|Stiftung|"
    r"Verwaltungs|Beteiligungs|Holding|Gesellschaft|Limited|Ltd\.?|B\.?V\.?|S\.?A\.?)\b",
    re.IGNORECASE,
)


def is_spv(name: str) -> bool:
    return any(p.search(name) for p in SPV_PATTERNS)


def officer_is_legal_entity(off: dict) -> bool:
    """The dump flags natural persons explicitly; anything typed "person" is one."""
    typ = off.get("type")
    if typ == "person":
        return False
    if typ == "company":
        return True
    # No type flag: fall back to legal-form markers; when in doubt treat as a
    # person so it is never served.
    return bool(LEGAL_FORM_RE.search(off.get("name") or ""))


def officer_is_current(off: dict) -> bool:
    if off.get("end_date"):
        return False
    other = off.get("other_attributes") or {}
    return not other.get("dismissed")


def company_id(obj: dict) -> str:
    attrs = obj.get("all_attributes") or {}
    registrar = (attrs.get("registrar") or "").strip()
    art = (attrs.get("_registerArt") or "").strip()
    nr = (attrs.get("_registerNummer") or "").strip()
    if registrar and art and nr:
        return f"{registrar.replace(' ', '')}-{art}{nr}"
    return obj.get("company_number") or ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dump", default="downloads/de_companies_ocdata.jsonl.bz2",
                    help="path to the downloaded .jsonl.bz2")
    ap.add_argument("--out", default="out")
    ap.add_argument("--limit", type=int, default=None, help="stop after N companies (smoke runs)")
    ap.add_argument("--land", default=None,
                    help='filter by federal_state, e.g. "North Rhine-Westphalia"')
    args = ap.parse_args()

    dump = Path(args.dump)
    if not dump.exists():
        raise SystemExit(
            f"ERROR: {dump} not found. Download it first:\n  curl -o {dump} {DUMP_URL}"
        )

    out = Path(args.out)
    companies = SqlChunkWriter(out / "sql-companies", "companies", "companies",
                               COMPANY_COLUMNS, rows_per_stmt=250, rows_per_file=20000)
    officers = SqlChunkWriter(out / "sql-companies", "officers", "officers",
                              OFFICER_COLUMNS, rows_per_stmt=250, rows_per_file=20000)

    n_companies = n_officers = n_spv = n_persons_stored = skipped = 0
    seen_ids: set[str] = set()

    with bz2.open(dump, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue

            attrs = obj.get("all_attributes") or {}
            if args.land and attrs.get("federal_state") != args.land:
                continue

            cid = company_id(obj)
            name = (obj.get("name") or "").strip()
            if not cid or not name or cid in seen_ids:
                skipped += 1
                continue
            seen_ids.add(cid)

            registrar = attrs.get("registrar")
            art = attrs.get("_registerArt")
            nr = attrs.get("_registerNummer")
            spv = is_spv(name)
            companies.add([
                cid,
                name,
                f"Amtsgericht {registrar}" if registrar else None,
                f"{art} {nr}" if art and nr else None,
                attrs.get("registered_office"),
                obj.get("current_status"),
                None,  # purpose: not present in this dump — never guessed
                1 if spv else 0,
            ])
            n_companies += 1
            if spv:
                n_spv += 1

            for off in obj.get("officers") or []:
                if not officer_is_current(off):
                    continue
                oname = (off.get("name") or "").strip()
                if not oname:
                    continue
                legal = officer_is_legal_entity(off)
                officers.add([cid, oname, off.get("position"), 1 if legal else 0])
                n_officers += 1
                if not legal:
                    n_persons_stored += 1

            if n_companies % 200000 == 0:
                print(f"  {n_companies} companies…")
            if args.limit and n_companies >= args.limit:
                break

    cf = companies.close()
    of = officers.close()
    print(f"\nDone: {n_companies} companies ({n_spv} SPV-flagged by name pattern), "
          f"{n_officers} current officers ({n_persons_stored} natural persons, stored "
          f"with is_legal_entity=0, never served), {skipped} lines skipped.")
    print(f"SQL: {cf} companies file(s) + {of} officers file(s) in {out / 'sql-companies'}")
    print("Load with: ./load_d1.sh remote out/sql-companies")


if __name__ == "__main__":
    main()
