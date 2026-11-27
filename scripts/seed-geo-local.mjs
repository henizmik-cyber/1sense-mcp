// Seeds the local R2 bucket (wrangler dev) with the dev fixture geometry.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const square = (lng, lat, d) => [
  [
    [lng - d, lat - d],
    [lng + d, lat - d],
    [lng + d, lat + d],
    [lng - d, lat + d],
    [lng - d, lat - d],
  ],
];

const objects = {
  "geo/parcels/2601/007.json": {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { id: "05260100700123" },
        geometry: { type: "Polygon", coordinates: square(6.95, 50.94, 0.0005) },
      },
      {
        type: "Feature",
        properties: { id: "05260100700124/0005" },
        geometry: { type: "Polygon", coordinates: square(6.9508, 50.9406, 0.0002) },
      },
    ],
  },
  "geo/brw/BRW-K-001.json": {
    type: "Feature",
    properties: { zone_id: "BRW-K-001" },
    geometry: { type: "Polygon", coordinates: square(6.95, 50.94, 0.005) },
  },
};

const dir = mkdtempSync(join(tmpdir(), "onesense-seed-"));
for (const [key, value] of Object.entries(objects)) {
  const file = join(dir, key.replaceAll("/", "_"));
  writeFileSync(file, JSON.stringify(value));
  execFileSync(
    "npx",
    ["wrangler", "r2", "object", "put", `onesense-geo/${key}`, "--file", file,
     "--content-type", "application/json", "--local"],
    { stdio: "inherit" },
  );
}
console.log("local R2 seeded");
