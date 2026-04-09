#!/usr/bin/env node

import { getPkgVersion } from './utils.js';
import { runInit } from './commands/init/index.js';
import { runCheck } from './commands/check.js';
import { runFreeze } from './commands/freeze.js';
import { runUnfreeze } from './commands/unfreeze.js';
import { runServe } from './commands/serve.js';
import { runCache } from './commands/cache.js';

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
  check      Check what reagent components are installed
  freeze     Create .reagent/HALT to suspend all agent operations
  unfreeze   Remove .reagent/HALT to resume agent operations
  serve      Start the MCP gateway server (stdio transport)
  cache      Manage review cache (check, set, clear)
  help       Show this help

Options for init:
  --profile <name>    Profile to install (default: client-engagement)
  --dry-run           Preview what would be installed without writing files

Options for freeze:
  --reason <text>     Reason for freeze (stored in HALT file)

Available profiles:
  client-engagement   Zero-trust setup for client engagements (default)
  bst-internal        BST internal project setup

Examples:
  npx @bookedsolid/reagent init
  npx @bookedsolid/reagent init --profile bst-internal
  npx @bookedsolid/reagent init --dry-run
  npx @bookedsolid/reagent check
  npx @bookedsolid/reagent freeze --reason "security incident"
  npx @bookedsolid/reagent unfreeze
  npx @bookedsolid/reagent serve
`);
}
