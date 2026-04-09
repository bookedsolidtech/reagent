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
 */

const isCI = process.env.CI === 'true';

if (!isCI) {
  console.error('');
  console.error('ERROR: Local npm publish is blocked.');
  console.error('');
  console.error('Publishing must go through GitHub Actions to ensure:');
  console.error('  - Secret scanning on publish payload');
  console.error('  - SBOM generation and artifact upload');
  console.error('  - npm provenance attestation (sigstore)');
  console.error('  - Changeset version bump committed before publish');
  console.error('');
  console.error('To publish: push to main, let publish.yml handle the rest.');
  console.error('');
  process.exit(1);
}
