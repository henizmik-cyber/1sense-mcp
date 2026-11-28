import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
for (const shard of [env.DB_NORTH, env.DB_WEST, env.DB_BW, env.DB_EAST]) {
  await applyD1Migrations(shard, env.TEST_SHARD_MIGRATIONS);
}
