import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOLS } from "./tools/registry.js";
import { dispatchTool, toMcpResult } from "./lib/dispatch.js";
import type { ToolContext } from "./lib/types.js";
import { EMAIL_RE, accessPage, accessThanksPage } from "./access-page.js";
import { mapPage } from "./map-page.js";
import { sourcesPage } from "./sources-page.js";
import { handleParcelApi, handleTileRequest } from "./map-api.js";

export interface SessionProps extends Record<string, unknown> {
  ip: string;
  country: string;
}

export class OneSenseMcp extends McpAgent<Env, unknown, SessionProps> {
  server = new McpServer({
    name: "1sense-grundstueck",
    version: "0.1.0",
  });

  async init(): Promise<void> {
    for (const def of TOOLS) {
      this.server.tool(def.name, def.description, def.schema, def.annotations, async (args) => {
        const ctx: ToolContext = {
          env: this.env,
          ip: this.props?.ip ?? "unknown",
          country: this.props?.country ?? "unknown",
        };
        const payload = await dispatchTool(ctx, def, args);
        return toMcpResult(payload);
      });
    }
  }
}

const INFO = {
  name: "1Sense Data — German Property MCP",
  description:
    "Look up German land parcels, zoning values and company structures. Owner chains available via early access.",
  mcp_endpoint: "/mcp",
  coverage:
    "Parcels: most of Germany from the Länder's open cadastre data; Bavaria: not-available (no open parcel data). Bodenrichtwerte: Länder that publish them openly.",
  docs: "https://1sensedata.com/mcp",
  access: "https://1sensedata.com/access",
};

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      const props: SessionProps = {
        ip: request.headers.get("cf-connecting-ip") ?? "unknown",
        country:
          (request.cf as { country?: string } | undefined)?.country ?? "unknown",
      };
      // The generated type marks props read-only (it is runtime-populated for
      // service bindings), but assigning here is how McpAgent receives
      // per-request props in the authless setup.
      (ctx as { props?: SessionProps }).props = props;
      return OneSenseMcp.serve("/mcp").fetch(request, env, ctx);
    }

    if (url.pathname === "/access" || url.pathname === "/access/") {
      return handleAccessPage(request, env);
    }

    if (url.pathname === "/map" || url.pathname === "/map/") {
      return new Response(mapPage(), {
        headers: { ...HTML_HEADERS, "cache-control": "public, max-age=300" },
      });
    }

    if (url.pathname === "/map/quellen") {
      return new Response(sourcesPage(), {
        headers: { ...HTML_HEADERS, "cache-control": "public, max-age=3600" },
      });
    }

    if (url.pathname.startsWith("/map/tiles/")) {
      return handleTileRequest(request, env, url.pathname.slice("/map/tiles/".length), ctx);
    }

    if (url.pathname === "/map/api/parcel") {
      return handleParcelApi(request, env);
    }

    if (url.pathname === "/" || url.pathname === "") {
      return Response.json(INFO);
    }

    return Response.json(
      { error: "not_found", hint: "MCP endpoint is at /mcp (Streamable HTTP)" },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<Env>;

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

async function handleAccessPage(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const ok = new URL(request.url).searchParams.has("ok");
    return new Response(ok ? accessThanksPage() : accessPage(), {
      headers: HTML_HEADERS,
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let email = "";
  let useCase = "";
  let trap = "";
  try {
    const form = await request.formData();
    email = String(form.get("email") ?? "").trim();
    useCase = String(form.get("use_case") ?? "").trim();
    trap = String(form.get("website") ?? "");
  } catch {
    return new Response(accessPage({ error: "That did not go through. Please try again." }), {
      status: 400,
      headers: HTML_HEADERS,
    });
  }

  // Honeypot filled → pretend success, store nothing.
  if (trap !== "") {
    return Response.redirect(new URL("/access?ok=1", request.url).toString(), 303);
  }

  if (!EMAIL_RE.test(email)) {
    return new Response(
      accessPage({ error: "That does not look like an email address." }),
      { status: 400, headers: HTML_HEADERS },
    );
  }
  if (useCase.length < 5) {
    return new Response(
      accessPage({ error: "Please say in a sentence what you want to do with the data." }),
      { status: 400, headers: HTML_HEADERS },
    );
  }

  await env.DB.prepare(
    `INSERT INTO leads (email, use_case, source_tool, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(email, useCase.slice(0, 2000), "access_page", new Date().toISOString())
    .run();

  return Response.redirect(new URL("/access?ok=1", request.url).toString(), 303);
}
