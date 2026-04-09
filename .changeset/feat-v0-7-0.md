---
'@bookedsolid/reagent': minor
---

feat: v0.7.0 — catalyze command, discord-ops integration, and tech stack profiles

Adds three major features:

**reagent catalyze** — analyze project stack and generate gap analysis reports

- Detects project types: astro, nextjs, lit-wc, drupal, react, node-api, monorepo
- Identifies missing hooks, gates, agents, and tests against a known catalog
- Generates markdown and HTML reports with ranked gaps
- Audit mode (--audit) shows drift against previous plan

**discord-ops integration** — opt-in Discord notifications

- New discord_ops section in gateway.yaml schema
- DiscordNotifier class for task, hook block, release, and audit alert events
- discord_notify MCP tool registered in native-tools
- reagent init --discord wires Discord config into gateway.yaml
- All notifications fail silently — never block workflows

**Tech stack profiles** — installable hooks and gates for specific frameworks

- profiles/lit-wc: shadow-dom-guard, cem-integrity-gate hooks + cem/wtr gates
- profiles/drupal: coding standards + hook-update-guard hooks + phpcs/phpunit gates
- profiles/astro: astro-ssr-guard hook + astro check/build gates
- profiles/nextjs: server-component-drift hook + next build/lint gates
- reagent init --profile <name> installs tech profile alongside base profile
