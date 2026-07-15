/**
 * Runs real `codex exec` smoke evaluations against copied Codex custom agents.
 *
 * This is intentionally separate from `pnpm test`: it requires Codex auth,
 * network/model access, and spends model tokens.
 */

import { runExecSmoke } from "./exec-smoke/orchestrator.mjs";

runExecSmoke(process.argv.slice(2))
  .then((success) => {
    if (!success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(error.stack ?? error.message);
    process.exit(1);
  });
