// End-to-end smoke test against a running server (default: wrangler dev).
//   npm run dev        (terminal 1)
//   npm run smoke      (terminal 2)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://127.0.0.1:8787/mcp");
const client = new Client({ name: "onesense-smoke", version: "0.0.1" });
await client.connect(new StreamableHTTPClientTransport(url));

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
if (tools.length !== 8) throw new Error("expected 8 tools");

const calls = [
  ["search_parcels", { city: "Köln", min_m2: 1000 }],
  ["get_parcel", { parcel_id: "05 2601 007 00123" }],
  ["get_bodenrichtwert", { lat: 50.94, lng: 6.95 }],
  ["find_company", { query: "Objekt Rheinpark" }],
  ["estimate_buildable", { parcel_id: "05260100700123" }],
  ["get_owner_chain", { parcel_id: "05260100700123" }],
  ["company_properties", { name: "Objekt Rheinpark" }],
  ["request_access", { email: "smoke@example.com", use_case: "Smoke test of the funnel", source_tool: "smoke" }],
];

let failures = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    failures++;
    console.log(`✗ ${name}: non-JSON response: ${text.slice(0, 200)}`);
    continue;
  }
  const okish = parsed.ok === true || parsed.status === "locked";
  if (!okish) failures++;
  console.log(`${okish ? "✓" : "✗"} ${name}: ${JSON.stringify(parsed).slice(0, 180)}`);
  if (name === "get_owner_chain" || name === "company_properties") {
    if (parsed.status !== "locked") {
      failures++;
      console.log(`  ✗ expected locked shape from ${name}`);
    }
    if (JSON.stringify(parsed).toLowerCase().includes("mustermann")) {
      failures++;
      console.log(`  ✗ PERSON NAME LEAK in ${name}`);
    }
  }
}

await client.close();
if (failures > 0) {
  console.error(`\nSMOKE FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log("\nSMOKE OK");
