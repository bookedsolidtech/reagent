#!/usr/bin/env node

import { getPkgVersion } from './utils.js';
import { runInit } from './commands/init/index.js';
import { runCheck } from './commands/check.js';
import { runFreeze } from './commands/freeze.js';
import { runUnfreeze } from './commands/unfreeze.js';
import { runServe } from './commands/serve.js';
import { runCache } from './commands/cache.js';
import { runCatalyze } from './commands/catalyze/index.js';
import { runDaemon } from './commands/daemon/index.js';

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

switch (cmd) {
  case 'init':
    runInit(rest);
    break;
  case 'check':
    runCheck(rest);
    break;
  case 'freeze':
    runFreeze(rest);
    break;
  case 'unfreeze':
    runUnfreeze(rest);
    break;
  case 'serve':
    await runServe(rest);
    break;
  case 'cache':
    runCache(rest);
    break;
  case 'catalyze':
    runCatalyze(rest);
    break;
  case 'daemon':
    runDaemon(rest);
    break;
  default:
    console.error(`\nUnknown command: ${cmd}`);
    printHelp();
    process.exit(1);
}

function printHelp(): void {
  const PKG_VERSION = getPkgVersion();
  console.log(`
@bookedsolid/reagent v${PKG_VERSION} — zero-trust MCP gateway

Usage:
  npx @bookedsolid/reagent <command> [options]

Commands:
  init       Install reagent config into the current directory
  catalyze   Analyze project stack and generate gap analysis + improvement plan
  check      Check what reagent components are installed
  freeze     Create .reagent/HALT to suspend all agent operations
  unfreeze   Remove .reagent/HALT to resume agent operations
  serve      Start the MCP gateway server (stdio transport)
  daemon     Manage the persistent HTTP/SSE multi-project daemon
  cache      Manage review cache (check, set, clear)
  help       Show this help

Options for init:
  --profile <name>    Profile to install (default: client-engagement)
  --dry-run           Preview what would be installed without writing files
  --discord           Configure Discord notifications in gateway.yaml
  --guild-id <id>     Discord guild ID (used with --discord)
  --alerts-channel    Discord channel ID for security alerts
  --tasks-channel     Discord channel ID for task events
  --releases-channel  Discord channel ID for release events
  --dev-channel       Discord channel ID for dev activity

Options for catalyze [targetDir]:
  --plan              Analyze stack and generate report (default)
  --audit             Compare current state against last plan and show drift
  --dry-run           Print analysis without writing files

Options for freeze:
  --reason <text>     Reason for freeze (stored in HALT file)

Available base profiles:
  client-engagement   Zero-trust setup for client engagements (default)
  bst-internal        BST internal project setup

Available tech stack profiles (via --profile):
  astro               Astro framework hooks and gates
  nextjs              Next.js App Router hooks and gates
  lit-wc              Lit/Web Components hooks and gates
  drupal              Drupal CMS hooks and gates

Examples:
  npx @bookedsolid/reagent init
  npx @bookedsolid/reagent init --profile bst-internal
  npx @bookedsolid/reagent init --profile lit-wc
  npx @bookedsolid/reagent init --dry-run
  npx @bookedsolid/reagent catalyze
  npx @bookedsolid/reagent catalyze --audit
  npx @bookedsolid/reagent catalyze --dry-run
  npx @bookedsolid/reagent check
  npx @bookedsolid/reagent freeze --reason "security incident"
  npx @bookedsolid/reagent unfreeze
  npx @bookedsolid/reagent serve
  npx @bookedsolid/reagent daemon start
  npx @bookedsolid/reagent daemon status
  npx @bookedsolid/reagent daemon stop
  npx @bookedsolid/reagent daemon restart
`);
}
