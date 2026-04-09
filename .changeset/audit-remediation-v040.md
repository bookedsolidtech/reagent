---
'@bookedsolid/reagent': minor
---

Security audit remediation, policy hot-reload, and init improvements

- Security: tier downgrade floor prevents tool_overrides from lowering classification
- Security: blocked-paths middleware always protects .reagent/ directory
- Security: max_autonomy_level clamping in policy loader
- Security: HALT file read capped at 1024 bytes in shell hooks
- Security: argument redaction runs pre-execution with circular reference guard
- Feature: policy hot-reload re-reads policy.yaml per invocation for live autonomy changes
- Feature: gateway.yaml generated during init (idempotent, commented template)
- Feature: convention-based tier classification for tools (get_*, delete_*, etc.)
- Fix: audit write queue serialization for consistent log ordering
- Fix: client-manager timer leak on connection timeout
- Fix: tool-proxy uses z.unknown() instead of z.any()
- CI: Discord notification steps marked continue-on-error
- CI: roll-up status check job for branch protection
- Tests: 204 total (up from 153), including 45 init tests and 6 policy hot-reload tests
