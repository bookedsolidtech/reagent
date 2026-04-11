// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://bookedsolidtech.github.io',
  base: '/reagent/',
  integrations: [
    starlight({
      title: 'Reagent',
      description: 'Zero-trust MCP server for AI-assisted development. Every tool call — policy enforced.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/bookedsolidtech/reagent',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/bookedsolidtech/reagent/edit/staging/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Why Zero-Trust?', slug: 'concepts/zero-trust' },
            { label: 'Autonomy Levels', slug: 'concepts/autonomy-levels' },
            { label: 'Middleware Chain', slug: 'concepts/middleware-chain' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'MCP Server Proxy', slug: 'guides/mcp-gateway' },
            { label: 'Config Scaffolder', slug: 'guides/config-scaffolder' },
            { label: 'Stack Analyzer', slug: 'guides/stack-analyzer' },
            { label: 'Project Management', slug: 'guides/project-management' },
            { label: 'Discord Integration', slug: 'guides/discord-integration' },
            { label: 'Agent Teams', slug: 'guides/agent-teams' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli-commands' },
            { label: 'Policy File', slug: 'reference/policy-file' },
            { label: 'Gateway Config', slug: 'reference/gateway-config' },
            { label: 'Hooks', slug: 'reference/hooks' },
            { label: 'MCP Tools', slug: 'reference/mcp-tools' },
            { label: 'Profiles', slug: 'reference/profiles' },
            { label: 'Package Exports', slug: 'reference/package-exports' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Overview', slug: 'architecture/overview' },
            { label: 'Security Model', slug: 'architecture/security-model' },
            {
              label: 'Multi-Token Workstreams',
              slug: 'architecture/multi-token-workstream',
            },
          ],
        },
      ],
    }),
  ],
});
