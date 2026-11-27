import { type Envelope, type ToolContext, err, ok } from "../lib/types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface RequestAccessArgs {
  email: string;
  use_case: string;
  source_tool?: string;
}

/** The funnel: writes a lead, returns a confirmation. Exempt from rate limiting. */
export async function requestAccess(
  ctx: ToolContext,
  args: RequestAccessArgs,
): Promise<Envelope<unknown>> {
  const email = args.email.trim();
  if (!EMAIL_RE.test(email)) {
    return err("invalid_arguments", `"${email}" does not look like a valid email address.`);
  }
  const useCase = args.use_case.trim();
  if (useCase.length < 5) {
    return err(
      "invalid_arguments",
      "`use_case` is required — one or two sentences on what you want to do with the data.",
    );
  }

  const createdAt = new Date().toISOString();
  await ctx.env.DB.prepare(
    `INSERT INTO leads (email, use_case, source_tool, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
  )
    .bind(email, useCase.slice(0, 2000), args.source_tool ?? null, createdAt)
    .run();

  return ok("NRW", {
    received: true,
    email,
    message:
      "Request recorded. You'll hear from us at the address above about early access — owner chains, company-property links and higher limits.",
  });
}
