#!/usr/bin/env python3
"""Upload the generated geometry tree (out/r2/**) to the R2 bucket.

Two modes:

1. S3 API (fast, parallel) — set these environment variables, then run:
     CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
   (create an R2 API token in the Cloudflare dashboard: R2 -> Manage API Tokens)

2. Wrangler fallback (slow, sequential; fine for small runs / local dev):
     python3 upload_r2.py --wrangler          # remote bucket
     python3 upload_r2.py --wrangler-local    # wrangler dev's local R2

Object keys are the paths relative to out/r2, e.g. geo/parcels/2601/007.json.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BUCKET = "onesense-geo"


def iter_files(root: Path, newer_than: float | None = None):
    for path in sorted(root.rglob("*.json")):
        if newer_than is not None and path.stat().st_mtime < newer_than:
            continue
        yield path, str(path.relative_to(root)).replace(os.sep, "/")


def upload_s3(root: Path, workers: int, newer_than: float | None = None) -> None:
    import time

    import boto3
    from botocore.config import Config

    account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(retries={"max_attempts": 10, "mode": "adaptive"},
                      connect_timeout=30, read_timeout=120,
                      max_pool_connections=max(workers, 10)),
    )

    def put(path: Path, key: str) -> str | None:
        # One dropped connection must not abort a run of 100k+ objects:
        # retry with backoff, then report the key instead of raising.
        for attempt in range(1, 6):
            try:
                client.upload_file(
                    str(path), BUCKET, key, ExtraArgs={"ContentType": "application/json"}
                )
                return None
            except Exception as e:  # noqa: BLE001
                if attempt == 5:
                    return f"{key}: {e}"
                time.sleep(5 * attempt)
        return None

    files = list(iter_files(root, newer_than))
    print(f"uploading {len(files)} objects to r2://{BUCKET} via S3 API…", flush=True)
    done = 0
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(put, p, k) for p, k in files]
        for fut in as_completed(futures):
            err = fut.result()
            if err:
                failed.append(err)
            done += 1
            if done % 5000 == 0:
                print(f"  {done}/{len(files)} ({len(failed)} failed)", flush=True)
    print(f"done: {done - len(failed)} uploaded, {len(failed)} failed", flush=True)
    if failed:
        Path("r2_upload_failures.txt").write_text("\n".join(failed), encoding="utf-8")
        print("failed keys listed in r2_upload_failures.txt — re-run to retry", flush=True)
        raise SystemExit(1)


def upload_wrangler(root: Path, local: bool) -> None:
    files = list(iter_files(root))
    flag = ["--local"] if local else ["--remote"]
    print(
        f"uploading {len(files)} objects via wrangler ({'local' if local else 'remote'}) — "
        "sequential and slow; use the S3 mode for large runs."
    )
    for i, (path, key) in enumerate(files, 1):
        subprocess.run(
            ["npx", "wrangler", "r2", "object", "put", f"{BUCKET}/{key}",
             "--file", str(path), "--content-type", "application/json", *flag],
            check=True,
            capture_output=True,
        )
        if i % 50 == 0 or i == len(files):
            print(f"  {i}/{len(files)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", default="out/r2", help="directory to upload (default: out/r2)")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--newer-than", default=None,
                    help="only upload files modified at/after this time "
                         "(ISO date like 2026-11-27, or epoch seconds) — "
                         "skips objects already uploaded by an earlier run")
    ap.add_argument("--wrangler", action="store_true", help="use wrangler instead of the S3 API")
    ap.add_argument("--wrangler-local", action="store_true",
                    help="use wrangler against the local dev bucket")
    args = ap.parse_args()

    root = Path(args.src)
    if not root.is_dir():
        raise SystemExit(f"ERROR: {root} does not exist — run the ingest scripts first.")

    if args.wrangler or args.wrangler_local:
        upload_wrangler(root, local=args.wrangler_local)
        return

    missing = [v for v in ("CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
               if v not in os.environ]
    if missing:
        print(f"S3 credentials missing ({', '.join(missing)}).", file=sys.stderr)
        print("Either export them, or re-run with --wrangler / --wrangler-local.",
              file=sys.stderr)
        raise SystemExit(2)
    newer_than = None
    if args.newer_than:
        try:
            newer_than = float(args.newer_than)
        except ValueError:
            from datetime import datetime

            newer_than = datetime.fromisoformat(args.newer_than).timestamp()
    upload_s3(root, args.workers, newer_than)


if __name__ == "__main__":
    main()
