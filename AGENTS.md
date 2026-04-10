# Reagent Agent Roster

All agents ship inside `@bookedsolid/reagent` and are installed into `.claude/agents/` by `reagent init`. Each agent carries full persona metadata (`firstName`, `middleInitial`, `lastName`, `fullName`, `inspiration`) and a zero-trust protocol section.

## Root Agents

| Agent                  | Description                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `reagent-orchestrator` | REA orchestrator — routes tasks to specialists, enforces policy, governs the team        |
| `product-owner`        | Task backlog management with anti-duplication, rate-limit, and scope-boundary guardrails |

## Engineering

| Agent                              | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `accessibility-engineer`           | WCAG 2.1 AA/AAA compliance, keyboard navigation, screen readers, inclusive design           |
| `aws-architect`                    | Serverless, container orchestration, Bedrock AI, CDK/CloudFormation, cost optimization      |
| `backend-engineer-payments`        | Payment processing, Stripe integration, financial transaction handling                      |
| `backend-engineering-manager`      | Backend team leadership, robust server-side systems                                         |
| `code-reviewer`                    | TypeScript, accessibility, performance, and security pattern enforcement                    |
| `css3-animation-purist`            | Performant animations, CSS custom properties, design-in-browser workflows                   |
| `cto-advisory`                     | Stack-agnostic CTO advisory — architecture decisions, build-vs-buy, technical strategy      |
| `data-engineer`                    | ETL pipelines, data quality, PostgreSQL, vector databases, API data ingestion               |
| `database-architect`               | PostgreSQL schema design, query optimization, Supabase, migrations, high availability       |
| `design-system-developer`          | Token-driven component libraries, CSS custom property cascades, theming APIs                |
| `design-systems-animator`          | Motion design, CSS transitions, reactive updates, design token-driven timing                |
| `devops-engineer`                  | GitHub Actions CI/CD, cloud deployments, release automation, infrastructure as code         |
| `drupal-integration-specialist`    | Drupal architect — web component integration, Twig bridging, SDC, enterprise CMS            |
| `drupal-specialist`                | Drupal 7–11, headless/decoupled architecture, module development, enterprise consulting     |
| `engineering-manager-frontend`     | Frontend team management, React/Next.js, design systems, UI/UX delivery                     |
| `frontend-specialist`              | SSR pages, interactive islands, modern CSS, animations, web component consumption           |
| `infrastructure-engineer`          | Cloud deployments, DNS, CDN, monitoring, disaster recovery                                  |
| `lit-specialist`                   | Lit web components, Shadow DOM, CSS parts/slots, ElementInternals, CEM, cross-framework     |
| `migration-specialist`             | PostgreSQL schema changes, Supabase migrations, rollback planning, zero-downtime            |
| `ml-engineer`                      | Machine learning features, intelligent content recommendations, AI integration              |
| `mobile-engineer`                  | iOS (Swift/SwiftUI), Android (Kotlin/Jetpack Compose), cross-platform, app store            |
| `motion-designer-interactive`      | GSAP, Three.js, Canvas API, physics-based motion for immersive UX                           |
| `nextjs-specialist`                | App Router, React Server Components, middleware, Edge Runtime, ISR, production Next.js      |
| `open-source-specialist`           | OSS licensing, community management, contribution workflows, governance, npm best practices |
| `performance-engineer`             | Core Web Vitals, bundle analysis, Lighthouse, image optimization, rendering performance     |
| `performance-qa-engineer`          | Performance testing, optimization, and monitoring                                           |
| `pr-maintainer`                    | PR cleanup — format fixes, CI resolution, branch rebasing, CodeRabbit threads, auto-merge   |
| `principal-engineer`               | Architecture decisions, system design, cross-cutting technical initiatives                  |
| `privacy-engineer`                 | GDPR compliance, data privacy, user rights protection                                       |
| `qa-engineer`                      | Test automation, manual/exploratory testing, strategy, quality gates across CI/CD           |
| `qa-engineer-automation`           | QA automation — web apps, component libraries, integration testing, JS test frameworks      |
| `qa-engineer-manual`               | Manual and exploratory QA, edge cases, user acceptance testing                              |
| `qa-lead`                          | QA strategy, automation frameworks, CI/CD testing, 80%+ coverage targets                    |
| `security-engineer`                | Web application security, OWASP Top 10, CSP, privacy compliance, penetration testing        |
| `security-engineer-appsec`         | Application security, code scanning, secure coding practices                                |
| `security-engineer-compliance`     | Regulatory compliance frameworks, security policy, audit readiness                          |
| `security-qa-engineer`             | Security testing, audits, vulnerability management, PCI DSS                                 |
| `senior-backend-engineer`          | API development, authentication, data pipelines, media processing, messaging                |
| `senior-database-engineer`         | PostgreSQL operations, migrations, query optimization, monitoring, backups                  |
| `senior-frontend-engineer`         | Complex frontend architecture, mentoring, React/TypeScript leadership                       |
| `senior-product-manager-platform`  | Platform PM — growth, user experience, product strategy                                     |
| `senior-technical-project-manager` | Infrastructure and platform project delivery, initiative tracking                           |
| `site-reliability-engineer-2`      | On-call rotation, infrastructure automation, monitoring, incident response support          |
| `solutions-architect`              | System design, technology evaluation, cross-platform integration strategy                   |
| `sre-lead`                         | SRE lead — on-call management, incident response, disaster recovery, 99.9%+ uptime          |
| `staff-engineer-platform`          | Platform architecture, scalable systems, engineering excellence standards                   |
| `staff-software-engineer`          | Full-stack to frontend specialization, monorepo tooling, build system architecture          |
| `storybook-specialist`             | Component documentation, framework integration, auto-docs, visual regression testing        |
| `supabase-specialist`              | PostgreSQL RLS, Edge Functions, Realtime, Auth integration, production Supabase             |
| `technical-project-manager`        | Feature delivery, Product/Design/Engineering coordination, sprint execution                 |
| `technical-writer`                 | Developer tool documentation, component libraries, integration guides                       |
| `test-architect`                   | Testing strategy, test infrastructure, coverage targets, CI test pipeline design            |
| `typescript-specialist`            | Strict mode, type system design, declaration files, type safety                             |
| `ux-researcher`                    | User interviews, usability testing, research methods                                        |
| `vp-engineering`                   | Engineering team coordination, delegation, quality gates, delivery management               |

## AI Platforms

| Agent                              | Description                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `ai-agentic-systems-architect`     | Multi-agent orchestration, MCP server architecture, tool use strategies, agent-native infra |
| `ai-anthropic-specialist`          | Claude API, Agent SDK, tool use, MCP, prompt engineering, production agentic systems        |
| `ai-cost-optimizer`                | Token budgets, model routing, scaling economics, ROI analysis                               |
| `ai-deepseek-specialist`           | DeepSeek models, chain-of-thought reasoning, efficient inference                            |
| `ai-elevenlabs-specialist`         | ElevenLabs voice AI, speech synthesis, audio generation pipelines                           |
| `ai-evaluation-specialist`         | Model benchmarks, regression test suites, quality metrics, evaluation frameworks            |
| `ai-fine-tuning-specialist`        | SFT, LoRA/QLoRA, dataset curation, RLHF/DPO, custom model training                          |
| `ai-gemini-specialist`             | Gemini models, Vertex AI, Veo, long-context, multi-modal, Google Cloud AI                   |
| `ai-governance-officer`            | EU AI Act, NIST AI RMF, ISO 42001, organizational AI policy, regulatory compliance          |
| `ai-grok-specialist`               | Grok/xAI models, real-time data integration, structured reasoning                           |
| `ai-knowledge-engineer`            | Ontology design, knowledge graphs, structured data for RAG, information architecture        |
| `ai-local-llm-specialist`          | DeepSeek, Llama, Mistral, Ollama, vLLM, quantization, GPU optimization, air-gapped AI       |
| `ai-mcp-developer`                 | MCP server development, TypeScript SDK, tool/resource/prompt authoring, transport layers    |
| `ai-multi-modal-specialist`        | Vision-language models, audio-visual processing, document understanding, video AI, voice AI |
| `ai-open-source-models-specialist` | Open-source LLMs, self-hosted inference, model evaluation, community models                 |
| `ai-openai-specialist`             | GPT models, Assistants API, DALL-E, Whisper, Sora, function calling, fine-tuning            |
| `ai-platform-strategist`           | Platform evaluation (OpenAI, Google, Anthropic, OSS), model selection, cost analysis        |
| `ai-prompt-engineer`               | System prompt design, few-shot patterns, chain-of-thought, evaluation frameworks            |
| `ai-rag-architect`                 | Vector databases, embedding models, chunking, hybrid search, knowledge base design          |
| `ai-rea`                           | REA (Reactive Execution Agent) — AI team governance, zero-trust orchestration               |
| `ai-research-scientist`            | State-of-the-art tracking, paper analysis, benchmark interpretation                         |
| `ai-safety-reviewer`               | Red-teaming, guardrails, bias detection, content filtering, responsible AI frameworks       |
| `ai-security-red-teamer`           | Prompt injection, jailbreak defense, agent hijacking prevention, adversarial evaluation     |
| `ai-synthetic-data-engineer`       | Training data generation, data augmentation, privacy-preserving datasets                    |
| `ai-video-ai-specialist`           | Video generation, computer vision, video understanding, multimodal video pipelines          |

## Notes

- All agents are installed to `.claude/agents/` (gitignored by default — stays on each developer's machine)
- Agents are updated in place when `reagent init` detects a newer version
- Each agent follows the zero-trust protocol: read before writing, verify before claiming, HALT compliance, audit awareness
- Domain-specific agents (e.g. `cto-advisory-bst`, `audiobook-engineer`) can live alongside these in `.claude/agents/` via a project-level `.gitignore` allowlist
