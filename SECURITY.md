# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in reagent, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email **security@bookedsolid.tech** with:

1. A description of the vulnerability
2. Steps to reproduce
3. The potential impact
4. Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and provide an initial assessment within 5 business days.

## Scope

Reagent is a local CLI tool that installs safety hooks and configuration files into developer repositories. It does not operate as a hosted service, collect telemetry, or make network calls.

Security-relevant components include:

- **Shell hooks** (`hooks/*.sh`) — run on every Claude Code tool call in target repos
- **Git hooks** (`husky/*.sh`) — run on every commit and push in target repos
- **CLI** (`bin/init.js`) — writes files to the target repository
- **Profiles** (`profiles/*.json`) — define what gets installed

## Security Design

- Zero runtime dependencies (Node.js stdlib only)
- No network calls, no telemetry, no data collection
- Path traversal protection on profile loading (regex + containment check)
- No `child_process` usage — all operations are filesystem-only
- CI-only publish pipeline with secret scanning and provenance attestation
- All shell hooks use `set -uo pipefail` with proper variable quoting
