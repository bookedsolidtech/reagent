# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.7.x   | Yes       |
| < 0.7   | No        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Public issues expose vulnerabilities to attackers before users can patch. We follow coordinated disclosure — vulnerabilities are disclosed publicly only after a patch is released.

> Note: reagent enforces this policy automatically. The `security-disclosure-gate` hook intercepts `gh issue create` commands containing security-sensitive keywords and blocks them with instructions to use private disclosure instead.

### Private Disclosure (preferred)

Email **security@bookedsolid.tech** with the details below. This is monitored and treated as confidential.

Alternatively, use [GitHub Security Advisories](https://github.com/bookedsolidtech/reagent/security/advisories/new) to report privately. This creates a private discussion thread visible only to maintainers.

### What to include

- Description of the vulnerability and affected component
- Steps to reproduce (minimal PoC if possible)
- Potential impact and attack scenario
- Your suggested fix (optional but appreciated)

### Response timeline

| Step                      | Target                                |
| ------------------------- | ------------------------------------- |
| Acknowledgement           | Within 24 hours                       |
| Patch for critical issues | Within 7 days of confirmed report     |
| Public disclosure         | After patch is available and released |

## Scope

The following components are **in scope**:

- **Hook scripts** — all `.sh` files in `hooks/` and `.claude/hooks/`. reagent ships shell scripts that execute on every Claude Code tool call with the full permissions of the user running Claude Code. Vulnerabilities in these scripts are treated as critical, equivalent to arbitrary code execution in the developer's environment.
- **CLI commands** — `reagent init`, `reagent freeze`, `reagent serve`, `reagent upgrade`, and related entry points in `src/cli/`
- **MCP server and middleware chain** — policy enforcement, tier classification, blocked-path enforcement, secret redaction, audit logging, kill-switch, and injection detection layers
- **Prompt injection** — via proxied tool descriptions, tool names, or tool results
- **Tool name collision / shadowing** — native tool override via malicious downstream server config
- **Secret redaction gaps** — credential patterns not caught, encoding-based bypasses
- **Audit chain tampering** — hash chain bypass, log suppression techniques
- **Shell hook injection** — techniques to inject arbitrary commands through hook input parsing

**Out of scope:**

- Vulnerabilities in Claude Code itself — report those to Anthropic
- Bugs in the MCP protocol implementation — report those to the MCP maintainers or Anthropic
- Vulnerabilities in downstream MCP servers proxied through `gateway.yaml` — report those to the respective project maintainers
- Social engineering
- Denial of service via resource exhaustion (unless it bypasses a security control)
- Issues requiring physical access to the machine

## Coordinated Disclosure

Once a patch is ready:

1. We release the patched version to npm
2. We publish a GitHub Security Advisory with full technical details
3. We credit the reporter (unless they prefer anonymity)

We ask reporters to wait for our patch before publishing their own writeup. Critical issues are patched within 7 days; other issues within a reasonable timeline based on complexity.

## Security Architecture

Reagent's security model is defense-in-depth across two independent layers:

**Gateway layer** (runtime, `reagent serve`):

- Governance middleware chain — every tool call is audited, classified, and policy-checked
- Secret redaction on arguments (pre-execution) and results (post-execution)
- HALT kill switch — a single `.reagent/HALT` file immediately blocks all tool calls
- Blocked path enforcement — `.reagent/` and operator-defined paths are always protected

**Hook layer** (development-time, Claude Code hooks):

- 20 Claude Code hooks enforce security at the point of tool invocation
- `security-disclosure-gate` blocks public issue creation for security topics
- `settings-protection` prevents agents from modifying their own safety rails
- `dangerous-bash-interceptor` blocks 16 categories of destructive shell commands

Both layers operate independently — compromising one does not disable the other.

## Security Design Notes

- No telemetry or network calls from the CLI or gateway (gateway only connects to operator-configured downstream servers)
- Path traversal protection on profile loading (regex + path containment check)
- CI publish pipeline includes gitleaks secret scanning, npm publish payload validation, and SBOM generation
- All shell hooks use `set -euo pipefail` with explicit variable quoting
