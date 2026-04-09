# drupal profile

Reagent profile for Drupal CMS projects (Drupal 9/10/11).

## When to use

Install this profile when your project:

- Is built on Drupal (any modern version)
- Uses custom modules or themes
- Has update hooks (`.install` files)
- Requires Drupal coding standards enforcement

## What this profile installs

### Hooks

- **drupal-coding-standards.sh** — PostToolUse/Write: warns on raw superglobals (`$_GET`, `$_POST`), hardcoded entity IDs, `hook_update_N` without schema management, and `t()` string concatenation.
- **hook-update-guard.sh** — PostToolUse/Write: guards `.install` files for destructive schema operations and update hook numbering gaps.

### Quality gates (gates.yaml)

| Gate                 | Command                               | On failure |
| -------------------- | ------------------------------------- | ---------- |
| phpcs-drupal         | `vendor/bin/phpcs --standard=Drupal`  | block      |
| drupal-cache-rebuild | `vendor/bin/drush cr`                 | warn       |
| phpunit-drupal       | `vendor/bin/phpunit --testsuite=unit` | block      |

### Agents

- `drupal-specialist` — Drupal architecture and module development
- `drupal-integration-specialist` — third-party integrations (APIs, payment, CRM)
- `backend-engineer-payments` — commerce and payment flows
- `security-engineer` — Drupal security review

## Recommended additions

- Behat behavioral tests for content workflows
- Playwright e2e for rendered frontend
- `phpstan` with Drupal extension for static analysis

## Prerequisites

```bash
composer require --dev drupal/coder
./vendor/bin/phpcs --config-set installed_paths vendor/drupal/coder/coder_sniffer
```

## Installation

```bash
reagent init --profile drupal
```
