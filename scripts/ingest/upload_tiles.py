#!/usr/bin/env python3
"""Upload the PMTiles tilesets (out/tiles/*.pmtiles) to the R2 bucket under
tiles/. The Worker serves them via the /map/tiles/* range proxy.

Needs the same S3 credentials as upload_r2.py:
  CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
(e.g. `set -a; source .r2.env; set +a`).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BUCKET = "onesense-geo"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="*", help="pmtiles files (default: out/tiles/*.pmtiles)")
    args = ap.parse_args()

    files = [Path(f) for f in args.files] or sorted(Path("out/tiles").glob("*.pmtiles"))
    if not files:
        raise SystemExit("ERROR: no .pmtiles files found — run tippecanoe first.")

    missing = [v for v in ("CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
               if v not in os.environ]
    if missing:
        raise SystemExit(f"S3 credentials missing: {', '.join(missing)}")

    import boto3
    from boto3.s3.transfer import TransferConfig

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['CLOUDFLARE_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    # R2 needs multipart for big objects; 100 MB parts keep the part count low.
    config = TransferConfig(multipart_threshold=256 * 1024 * 1024,
                            multipart_chunksize=100 * 1024 * 1024)

    for path in files:
        key = f"tiles/{path.name}"
        size_mb = path.stat().st_size / 1e6
        print(f"uploading {path} -> r2://{BUCKET}/{key} ({size_mb:.0f} MB)")
        client.upload_file(
            str(path), BUCKET, key,
            ExtraArgs={"ContentType": "application/octet-stream"},
            Config=config,
        )
    print("done")


if __name__ == "__main__":
    main()
