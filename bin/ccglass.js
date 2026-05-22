#!/usr/bin/env node
import { main } from "../src/cli.js";

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`ccglass: ${e.stack || e.message}\n`);
  process.exit(1);
});
