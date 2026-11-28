/// <reference path="../worker-configuration.d.ts" />
import type { D1Migration } from "@cloudflare/workers-types/experimental";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
    TEST_SHARD_MIGRATIONS: D1Migration[];
  }
}
