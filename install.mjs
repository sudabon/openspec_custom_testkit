#!/usr/bin/env node
import { USAGE, UsageError, exitCodeFor, main } from './lib/cli.mjs';

try {
  process.exitCode = await main();
} catch (err) {
  const code = exitCodeFor(err);
  // Known errors print their message; anything else prints the stack for a bug report.
  const detail = code == null ? (err?.stack ?? err) : err.message;
  console.error(`エラー: ${detail}${err instanceof UsageError ? `\n\n${USAGE}` : ''}`);
  process.exitCode = code ?? 1;
}
