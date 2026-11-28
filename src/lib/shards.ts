/** Parcel shard routing. D1 caps a database at 10 GB; Germany-wide parcels
 * need ~15-20 GB, so the parcel index is split by Bundesland group:
 *
 *   DB        (onesense)         05 NRW — plus every non-parcel table
 *   DB_NORTH  (onesense-p-north) 01 SH, 02 HH, 03 NI, 04 HB, 13 MV
 *   DB_WEST   (onesense-p-west)  06 HE, 07 RP, 10 SL
 *   DB_BW     (onesense-p-bw)    08 BW
 *   DB_EAST   (onesense-p-east)  11 BE, 12 BB, 14 SN, 15 ST, 16 TH
 *
 * Bavaria (09) has no open parcel data and lives nowhere.
 * The first two digits of a Flurstückskennzeichen are the Land, so id-based
 * lookups hit exactly one shard; city/bbox searches fan out over all of them.
 */

const SHARD_BINDINGS = ["DB", "DB_NORTH", "DB_WEST", "DB_BW", "DB_EAST"] as const;
type ShardBinding = (typeof SHARD_BINDINGS)[number];

const SHARD_BY_LAND: Record<string, ShardBinding> = {
  "05": "DB",
  "01": "DB_NORTH",
  "02": "DB_NORTH",
  "03": "DB_NORTH",
  "04": "DB_NORTH",
  "13": "DB_NORTH",
  "06": "DB_WEST",
  "07": "DB_WEST",
  "10": "DB_WEST",
  "08": "DB_BW",
  "11": "DB_EAST",
  "12": "DB_EAST",
  "14": "DB_EAST",
  "15": "DB_EAST",
  "16": "DB_EAST",
};

/** The shard holding parcels for a Land prefix, or null for an unknown/
 * uncovered prefix (Bavaria included — callers decide what that means). */
export function dbForLand(env: Env, land: string): D1Database | null {
  const binding = SHARD_BY_LAND[land];
  return binding ? env[binding] : null;
}

/** Every parcel shard, for fan-out searches. */
export function allParcelDbs(env: Env): D1Database[] {
  return SHARD_BINDINGS.map((b) => env[b]);
}
