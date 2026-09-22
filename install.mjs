#!/usr/bin/env node
import { PathError, USAGE, UsageError, main } from './lib/cli.mjs';

try {
  process.exitCode = await main();
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`エラー: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (err instanceof PathError || err?.code === 'BROKEN_STAMP' || err?.code === 'PATH') {
    console.error(`エラー: ${err.message}`);
    process.exitCode = 1;
  } else {
    console.error(`エラー: ${err?.stack ?? err}`);
    process.exitCode = 1;
  }
}
