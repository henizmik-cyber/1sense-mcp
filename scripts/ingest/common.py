"""Shared helpers for the NRW ingestion scripts."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path


def sql_quote(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        if value != value:  # NaN
            return "NULL"
        # float()/int() first: NumPy 2 scalars repr as "np.float64(…)".
        return repr(int(value) if isinstance(value, int) else float(value))
    text = str(value).replace("'", "''")
    return f"'{text}'"


def normalize_kennzeichen(raw: str) -> str | None:
    """Mirrors src/lib/parcel-id.ts: canonical id used as the D1 primary key."""
    text = str(raw).strip()
    # Fixed-width ALKIS form (18/20 chars, '_' as padding): read by position.
    # Stripping '_' first would shift fields when an inner part is padded —
    # Hamburg has no Flur ("020607___08752______").
    if "_" in text and len(text) in (18, 20) and re.fullmatch(r"[\d_]+", text):
        land, gmk, flur = text[0:2], text[2:6], text[6:9]
        zaehler, nenner = text[9:14], text[14:18]
        if not (land.isdigit() and gmk.isdigit()):
            return None
        flur = flur.replace("_", "0")
        zaehler = zaehler.replace("_", "")
        nenner = nenner.replace("_", "")
        if not zaehler.isdigit():
            return None
        base = f"{land}{gmk}{flur}{zaehler.zfill(5)}"
        if nenner and int(nenner) != 0:
            return f"{base}/{nenner.zfill(4)}"
        return base
    cleaned = re.sub(r"[\s_\-.]", "", text)
    if not re.fullmatch(r"\d+(/\d+)?", cleaned):
        return None
    if len(cleaned) < 10:
        return None
    land, gemarkung, flur, rest = (
        cleaned[0:2],
        cleaned[2:6],
        cleaned[6:9],
        cleaned[9:],
    )
    nenner = None
    if "/" in rest:
        zaehler, nenner = rest.split("/", 1)
        if nenner and int(nenner or "0") == 0:
            nenner = None
    elif len(rest) > 5:
        zaehler, nenner = rest[0:5], rest[5:9]
        if nenner and int(nenner) == 0:
            nenner = None
    else:
        zaehler = rest
    if not zaehler.isdigit():
        return None
    base = f"{land}{gemarkung}{flur.zfill(3)}{zaehler.zfill(5)}"
    return f"{base}/{nenner.zfill(4)}" if nenner else base


def pick_column(columns, candidates, what, required=True):
    """Finds the first matching column (case-insensitive). Fails loudly instead
    of guessing — never invent data."""
    lower = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand in lower:
            return lower[cand]
    if required:
        raise SystemExit(
            f"ERROR: could not find a column for {what}.\n"
            f"  Tried: {candidates}\n"
            f"  Available columns: {sorted(columns)}\n"
            "Fix the candidate list in this script after inspecting the data — do not guess."
        )
    return None


class SqlChunkWriter:
    """Writes INSERT OR REPLACE batches: 200 rows/statement, 2000 rows/file."""

    def __init__(self, out_dir: Path, prefix: str, table: str, columns: list[str],
                 rows_per_stmt: int = 200, rows_per_file: int = 2000):
        self.out_dir = out_dir
        self.prefix = prefix
        self.table = table
        self.columns = columns
        self.rows_per_stmt = rows_per_stmt
        self.rows_per_file = rows_per_file
        self._rows: list[str] = []
        self._file_rows = 0
        self._file_idx = 0
        self._fh = None
        out_dir.mkdir(parents=True, exist_ok=True)

    def _open_next(self):
        if self._fh:
            self._fh.close()
        self._file_idx += 1
        path = self.out_dir / f"{self.prefix}_{self._file_idx:04d}.sql"
        self._fh = open(path, "w", encoding="utf-8")
        self._file_rows = 0

    def _flush_stmt(self):
        if not self._rows:
            return
        if self._fh is None or self._file_rows >= self.rows_per_file:
            self._open_next()
        cols = ", ".join(self.columns)
        values = ",\n".join(f"({r})" for r in self._rows)
        self._fh.write(
            f"INSERT OR REPLACE INTO {self.table} ({cols}) VALUES\n{values};\n"
        )
        self._file_rows += len(self._rows)
        self._rows = []

    def add(self, values: list) -> None:
        self._rows.append(", ".join(sql_quote(v) for v in values))
        if len(self._rows) >= self.rows_per_stmt:
            self._flush_stmt()

    def close(self) -> int:
        self._flush_stmt()
        if self._fh:
            self._fh.close()
        return self._file_idx


class NdjsonWriter:
    """Appends one GeoJSON Feature per line — the input format for tippecanoe."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(path, "w", encoding="utf-8")
        self.count = 0

    def add(self, properties: dict, geometry) -> None:
        json.dump(
            {"type": "Feature", "properties": properties, "geometry": geometry},
            self._fh, ensure_ascii=False, separators=(",", ":"),
        )
        self._fh.write("\n")
        self.count += 1

    def close(self) -> int:
        self._fh.close()
        return self.count


def write_geojson(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


def round_coords(geom_mapping, ndigits: int = 7):
    """Rounds nested GeoJSON coordinates to keep files small."""

    def walk(c):
        if isinstance(c, (list, tuple)):
            return [walk(x) for x in c]
        return round(c, ndigits)

    out = dict(geom_mapping)
    out["coordinates"] = walk(out["coordinates"])
    return out
