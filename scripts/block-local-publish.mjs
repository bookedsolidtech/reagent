#!/usr/bin/env node
/**
 * block-local-publish.mjs
 * Runs as `prepublishOnly` — blocks `npm publish` outside CI.
 *
 * Publishing must happen through GitHub Actions (publish.yml) to ensure:
 *   - Secret scanning passes on the publish payload
 *   - SBOM is generated and attached
 *   - Provenance attestation is recorded (NPM_CONFIG_PROVENANCE=true)
 *   - Changeset version bump is committed before publish
 *
 * Exception: explicitly set ALLOW_LOCAL_PUBLISH=1 to bypass (for emergency use only).
 */

const isCI = process.env.CI === 'true';
const isAllowed = process.env.ALLOW_LOCAL_PUBLISH === '1';

if (!isCI && !isAllowed) {
  console.error('');
  console.error('ERROR: Local npm publish is blocked.');
  console.error('');
  console.error('Publishing must go through GitHub Actions to ensure:');
  console.error('  - Secret scanning on publish payload');
  console.error('  - SBOM generation and artifact upload');
  console.error('  - npm provenance attestation (sigstore)');
  console.error('  - Changeset version bump committed before publish');
  console.error('');
  console.error('To publish: push to main, merge the Version Packages PR,');
  console.error('then let publish.yml handle the rest.');
  console.error('');
  console.error('Emergency bypass: ALLOW_LOCAL_PUBLISH=1 npm publish');
  console.error('');
  process.exit(1);
}
