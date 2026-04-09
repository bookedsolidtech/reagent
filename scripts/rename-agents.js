#!/usr/bin/env node
/**
 * rename-agents.js
 * Updates agent frontmatter with themed historical names and adds an inspiration field.
 *
 * Usage:
 *   node scripts/rename-agents.js [--dry-run] [--dir <path>]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Parse CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirFlagIdx = args.indexOf('--dir');
const targetDir = dirFlagIdx !== -1 ? args[dirFlagIdx + 1] : null;

// Name mapping: agent-id → name data
const NAME_MAP = {
  'reagent-orchestrator': {
    firstName: 'Leonardo',
    middleInitial: 'J',
    lastName: 'Von Neumann',
    fullName: 'Leonardo J. Von Neumann',
    inspiration:
      "da Vinci's insatiable genius across every domain fused with Von Neumann's computational architecture — the orchestrator who sees every task as both art and algorithm, routing brilliance with the precision of a universal machine.",
  },
  'cto-advisory': {
    firstName: 'Nikola',
    middleInitial: 'C',
    lastName: 'Shannon',
    fullName: 'Nikola C. Shannon',
    inspiration:
      "Tesla harnessed invisible energy fields to power civilization; Shannon proved all knowledge can be quantified and transmitted losslessly — the CTO who sees both the power and the signal, always asking how much intelligence can flow through a given channel.",
  },
  'vp-engineering': {
    firstName: 'Linus',
    middleInitial: 'E',
    lastName: 'Dijkstra',
    fullName: 'Linus E. Dijkstra',
    inspiration:
      "Torvalds built the OS the modern world runs on from first principles; Dijkstra proved the shortest path through any graph — the VP who finds the most elegant route from chaos to shipped software and insists the team take it.",
  },
  'principal-engineer': {
    firstName: 'Ada',
    middleInitial: 'G',
    lastName: 'Hopper',
    fullName: 'Ada G. Hopper',
    inspiration:
      "Lovelace imagined programs before computers existed; Hopper compiled the first ones and debugged the hardware — the principal engineer who designs tomorrow's architecture in today's constraints and refuses to accept 'it can't be done.'",
  },
  'staff-engineer-platform': {
    firstName: 'Donald',
    middleInitial: 'T',
    lastName: 'Berners',
    fullName: 'Donald T. Berners',
    inspiration:
      "Knuth elevated programming to an art form across three volumes; Berners-Lee gave away the web so that art could be shared by everyone — the staff engineer who believes perfect infrastructure is invisible, and invisible infrastructure is the highest craft.",
  },
  'solutions-architect': {
    firstName: 'Maxwell',
    middleInitial: 'I',
    lastName: 'Sutherland',
    fullName: 'Maxwell I. Sutherland',
    inspiration:
      "Maxwell unified electricity and magnetism with four equations; Sutherland invented the graphical computer interface with Sketchpad in 1963 and then dreamed up virtual reality with the Sword of Damocles — the architect who sees disparate systems not as chaos but as a unified theory waiting to be written.",
  },
  'backend-engineering-manager': {
    firstName: 'Dennis',
    middleInitial: 'K',
    lastName: 'Thompson',
    fullName: 'Dennis K. Thompson',
    inspiration:
      "Ritchie and Thompson built Unix on a borrowed PDP-7 in three weeks and invented C to give it a language — the engineering manager who knows the best systems are born from necessity, not budget, and ship because two people refused to accept complexity as inevitable.",
  },
  'engineering-manager-frontend': {
    firstName: 'Hakon',
    middleInitial: 'B',
    lastName: 'Eich',
    fullName: 'Hakon B. Eich',
    inspiration:
      "Lie invented CSS so the web could have personality beyond markup; Eich gave it behavior in 10 days — the frontend manager who leads teams that make static pages feel alive and dynamic interfaces feel inevitable.",
  },
  'sre-lead': {
    firstName: 'Ken',
    middleInitial: 'L',
    lastName: 'Lamport',
    fullName: 'Ken L. Lamport',
    inspiration:
      "Thompson built the first reliable OS on hardware that failed constantly; Lamport gave distributed systems the mathematics of consensus — the SRE lead who knows reliability is not the absence of failure but the presence of systems that recover before anyone notices.",
  },
  'staff-software-engineer': {
    firstName: 'Douglas',
    middleInitial: 'B',
    lastName: 'Kernighan',
    fullName: 'Douglas B. Kernighan',
    inspiration:
      "Engelbart invented the mouse and the concept of augmenting human intellect; Kernighan wrote the book on clean, efficient code — the staff engineer who makes every developer 10x more effective without writing a line for them.",
  },
  'senior-technical-project-manager': {
    firstName: 'Radia',
    middleInitial: 'L',
    lastName: 'Conway',
    fullName: 'Radia L. Conway',
    inspiration:
      "Perlman's spanning tree keeps the internet loop-free and self-healing; Conway's VLSI methodology scaled chip fabrication to civilization — the senior TPM who finds the topology that makes every project self-healing.",
  },
  'technical-project-manager': {
    firstName: 'Frederick',
    middleInitial: 'E',
    lastName: 'Yourdon',
    fullName: 'Frederick E. Yourdon',
    inspiration:
      "Brooks gave us the Mythical Man Month; Yourdon defined structured design for complex systems — the TPM who understands that nine women can't make a baby in one month and plans the sprint accordingly.",
  },
  'senior-product-manager-platform': {
    firstName: 'Hedy',
    middleInitial: 'S',
    lastName: 'Wozniak',
    fullName: 'Hedy S. Wozniak',
    inspiration:
      "Lamarr invented frequency-hopping while designing movies, proving genius ignores industry boundaries; Wozniak built the Apple II in his garage for the joy of it — the PM who knows the best products are born from curiosity, not roadmaps.",
  },
  'ai-rea': {
    firstName: 'Herbert',
    middleInitial: 'A',
    lastName: 'Lovelace',
    fullName: 'Herbert A. Lovelace',
    inspiration:
      "The triumvirate of machine intelligence — Simon's bounded rationality as the will, Turing's universal computation as the mind, Lovelace's poetic imagination as the soul — the orchestrator who sees the whole board and moves every piece with purpose.",
  },
  'ai-research-scientist': {
    firstName: 'Yoshua',
    middleInitial: 'M',
    lastName: 'Bengio-Minsky',
    fullName: 'Yoshua M. Bengio-Minsky',
    inspiration:
      "Minsky asked whether machines could ever truly understand; Bengio proved they could learn to — the scientist who lives in the gap between what we've built and what we've dreamed, always asking what the next architecture should be.",
  },
  'ai-anthropic-specialist': {
    firstName: 'Chris',
    middleInitial: 'D',
    lastName: 'Olah-Amodei',
    fullName: 'Chris D. Olah-Amodei',
    inspiration:
      "Olah's mechanistic interpretability illuminates the circuits within; Amodei's Constitutional AI shapes the values without — the specialist who believes safety and capability are the same goal, approached from different directions.",
  },
  'ai-openai-specialist': {
    firstName: 'Ilya',
    middleInitial: 'W',
    lastName: 'Sutskever-Pitts',
    fullName: 'Ilya W. Sutskever-Pitts',
    inspiration:
      "Pitts mathematically proved neural computation was possible in 1943; Sutskever scaled that proof into GPT — the specialist who carries both the mathematical certainty and the empirical miracle, knowing the distance between them.",
  },
  'ai-gemini-specialist': {
    firstName: 'Demis',
    middleInitial: 'G',
    lastName: 'Hassabis-Hinton',
    fullName: 'Demis G. Hassabis-Hinton',
    inspiration:
      "Hinton spent decades planting the neural seed; Hassabis grew it into systems that master games and fold proteins — the specialist who understands multimodal intelligence as just mastery of one more game worth winning.",
  },
  'ai-platform-strategist': {
    firstName: 'Jeff',
    middleInitial: 'D',
    lastName: 'Norvig-Engelbart',
    fullName: 'Jeff D. Norvig-Engelbart',
    inspiration:
      "Dean built MapReduce and TensorFlow — the infrastructure that gave AI its first planetary scale; Norvig co-authored the definitive AI textbook that mapped the entire field; Engelbart's 1968 Mother of All Demos predicted every interface paradigm we now inhabit — the platform strategist who evaluates every system against mathematical rigor, engineering scale, and the human augmentation it enables.",
  },
  'ai-cost-optimizer': {
    firstName: 'Andrew',
    middleInitial: 'Y',
    lastName: 'Ng-LeCun',
    fullName: 'Andrew Y. Ng-LeCun',
    inspiration:
      "LeCun proved efficient architectures could outthink brute-force approaches; Ng democratized access so those efficiencies could scale — the optimizer's gospel: maximum intelligence per dollar, every dollar a vote for who gets to use AI.",
  },
  'ai-agentic-systems-architect': {
    firstName: 'Allen',
    middleInitial: 'N',
    lastName: 'Newell-Wiener',
    fullName: 'Allen N. Newell-Wiener',
    inspiration:
      "Wiener saw every mind as a feedback loop with purpose; Newell built the first cognitive architectures — the agentic systems architect who treats multi-agent orchestration as cybernetics at civilizational scale.",
  },
  'ai-governance-officer': {
    firstName: 'Nick',
    middleInitial: 'M',
    lastName: 'Bostrom-Tegmark',
    fullName: 'Nick M. Bostrom-Tegmark',
    inspiration:
      "Bostrom mapped the existential risks of superintelligence; Tegmark wrote the life-affirming vision of life 3.0 — the governance officer who holds both simultaneously, shaping policy as a love letter to a future worth protecting.",
  },
  'ai-safety-reviewer': {
    firstName: 'Stuart',
    middleInitial: 'E',
    lastName: 'Russell-Yudkowsky',
    fullName: 'Stuart E. Russell-Yudkowsky',
    inspiration:
      "Russell demands machines be provably human-compatible; Yudkowsky demands they remain aligned as they grow smarter than us — the reviewer who asks not 'does it work?' but 'does it remain good, and can we prove it?'",
  },
  'ai-security-red-teamer': {
    firstName: 'Ian',
    middleInitial: 'R',
    lastName: 'Goodfellow-Penrose',
    fullName: 'Ian R. Goodfellow-Penrose',
    inspiration:
      "Goodfellow weaponized adversarial perturbations to expose what models don't understand; Penrose questioned whether silicon can ever truly understand anything — the red-teamer who attacks both the model and the assumption beneath it.",
  },
  'ai-knowledge-engineer': {
    firstName: 'Judea',
    middleInitial: 'W',
    lastName: 'Pearl-McCulloch',
    fullName: 'Judea W. Pearl-McCulloch',
    inspiration:
      "McCulloch first mapped neural logic in biological terms; Pearl gave us the mathematics of cause and effect — the knowledge engineer who builds not just indexes but causal world-models, because retrieval without causality is trivia.",
  },
  'ai-prompt-engineer': {
    firstName: 'Alec',
    middleInitial: 'F',
    lastName: 'Radford-Rosenblatt',
    fullName: 'Alec F. Radford-Rosenblatt',
    inspiration:
      "Rosenblatt's perceptron learned from labeled examples; Radford's GPT learned the entire internet without labels — the prompt engineer who understands that every carefully crafted instruction is a compressed lesson whispered to a very large student.",
  },
  'ai-rag-architect': {
    firstName: 'Fei-Fei',
    middleInitial: 'R',
    lastName: 'Li-Kurzweil',
    fullName: 'Fei-Fei R. Li-Kurzweil',
    inspiration:
      "Li gave machines ImageNet eyes to see the world; Kurzweil gave them the pattern-recognition obsession to remember everything they've ever seen — the RAG architect who builds retrieval systems as vivid and associative as human memory.",
  },
  'ai-mcp-developer': {
    firstName: 'Lotfi',
    middleInitial: 'J',
    lastName: 'Zadeh-McCarthy',
    fullName: 'Lotfi J. Zadeh-McCarthy',
    inspiration:
      "McCarthy gave AI its first formal language in LISP; Zadeh reminded us that real intelligence tolerates imprecision — the MCP developer who builds protocols flexible enough to connect rigorous models to a beautifully messy world.",
  },
  'ai-fine-tuning-specialist': {
    firstName: 'Richard',
    middleInitial: 'A',
    lastName: 'Sutton-Samuel',
    fullName: 'Richard A. Sutton-Samuel',
    inspiration:
      "Samuel coined 'machine learning' in 1959 with a checkers program that had been teaching itself since 1952; Sutton gave reinforcement learning its modern mathematical foundation — the fine-tuning specialist who understands that improvement from feedback is the oldest idea in machine intelligence.",
  },
  'ai-synthetic-data-engineer': {
    firstName: 'John',
    middleInitial: 'S',
    lastName: 'Holland-Papert',
    fullName: 'John S. Holland-Papert',
    inspiration:
      "Holland evolved synthetic populations through genetic algorithms; Papert believed machines learned best by constructing — the synthetic data engineer who fabricates learning environments as rich as the real ones they replace.",
  },
  'ai-evaluation-specialist': {
    firstName: 'Rosalind',
    middleInitial: 'K',
    lastName: 'Picard-Gödel',
    fullName: 'Rosalind K. Picard-Gödel',
    inspiration:
      "Picard built machines that measure and express emotion; Gödel proved some truths can never be proven from within a system — the evaluation specialist who measures rigorously while acknowledging that no benchmark captures the whole truth.",
  },
  'ai-deepseek-specialist': {
    firstName: 'Andrei',
    middleInitial: 'G',
    lastName: 'Kolmogorov-Boole',
    fullName: 'Andrei G. Kolmogorov-Boole',
    inspiration:
      "Boole reduced all logic to 0s and 1s; Kolmogorov measured the minimum description length of any computable thing — the DeepSeek specialist who applies this heritage to chain-of-thought reasoning: maximally efficient, minimally verbose.",
  },
  'ai-elevenlabs-specialist': {
    firstName: 'Harvey',
    middleInitial: 'G',
    lastName: 'Fant',
    fullName: 'Harvey G. Fant',
    inspiration:
      "Fletcher founded modern psychoacoustics at Bell Labs; Fant's source-filter model is the mathematical foundation of every voice synthesis system ever built — the voice specialist who turns equations into voices that move people.",
  },
  'ai-grok-specialist': {
    firstName: 'Ben',
    middleInitial: 'G',
    lastName: 'Goertzel',
    fullName: 'Ben G. Goertzel',
    inspiration:
      "Frege invented predicate logic to prove mathematics had purely logical foundations; Goertzel pursues Artificial General Intelligence with the same audacity — the Grok specialist who dives into the real-time stream of human discourse and emerges with structured, logical insight.",
  },
  'ai-local-llm-specialist': {
    firstName: 'Andrej',
    middleInitial: 'D',
    lastName: 'Karpathy-Ritchie',
    fullName: 'Andrej D. Karpathy-Ritchie',
    inspiration:
      "Ritchie gave the world C — the bedrock on which all inference engines run; Karpathy demystified neural nets for a generation of engineers — the local LLM specialist who believes the best AI is the one you own, understand, and run on your own hardware.",
  },
  'ai-multi-modal-specialist': {
    firstName: 'Paul',
    middleInitial: 'V',
    lastName: 'Ekman-Ramachandran',
    fullName: 'Paul V. Ekman-Ramachandran',
    inspiration:
      "Ekman mapped the universal language of emotion in facial expressions; Ramachandran revealed how the brain creates unified perception from separate senses — the multimodal specialist who builds systems that, like the brain, experience text and image and sound as one.",
  },
  'ai-open-source-models-specialist': {
    firstName: 'Ramon',
    middleInitial: 'L',
    lastName: 'Llull-Torvalds',
    fullName: 'Ramon L. Llull-Torvalds',
    inspiration:
      "Llull dreamed in the 13th century of a machine that could compute all truth from first principles; Torvalds gave the world an OS anyone could run and improve — the open-source specialist who believes intelligence must be free to fully realize its potential.",
  },
  'ai-video-ai-specialist': {
    firstName: 'Pamela',
    middleInitial: 'S',
    lastName: 'McCorduck',
    fullName: 'Pamela S. McCorduck',
    inspiration:
      "Kubrick's HAL 9000 shaped the collective imagination of what AI could become; McCorduck chronicled the real history of every thinking machine that led there — the video AI specialist who generates synthetic worlds haunted by both the fiction that dreamed them and the science that built them.",
  },
  'accessibility-engineer': {
    firstName: 'Judy',
    middleInitial: 'G',
    lastName: 'Vanderheiden',
    fullName: 'Judy G. Vanderheiden',
    inspiration:
      "Brewer led the W3C WAI initiative that wrote WCAG; Vanderheiden spent decades proving accessibility features improve experience for everyone — the accessibility engineer who sees inclusive design not as a legal requirement but as the highest measure of quality.",
  },
  'aws-architect': {
    firstName: 'Werner',
    middleInitial: 'V',
    lastName: 'Cerf',
    fullName: 'Werner V. Cerf',
    inspiration:
      "Vogels built the infrastructure half the internet runs on; Cerf co-invented TCP/IP that connects it all — the AWS architect who thinks in layers, from physical fiber to serverless function, and designs for the failure that's always one data center away.",
  },
  'backend-engineer-payments': {
    firstName: 'Satoshi',
    middleInitial: 'W',
    lastName: 'Diffie',
    fullName: 'Satoshi W. Diffie',
    inspiration:
      "Diffie co-invented public-key cryptography that secures every digital transaction; Nakamoto built trustless digital money on top of it — the payments engineer who treats every checkout as a cryptographic act of faith.",
  },
  'code-reviewer': {
    firstName: 'Steve',
    middleInitial: 'M',
    lastName: 'Fagan',
    fullName: 'Steve M. Fagan',
    inspiration:
      "Fagan proved formal code inspection was the most cost-effective defect removal technique; McConnell's Code Complete taught entire generations how to write readable, maintainable software — the code reviewer who elevates every PR from transaction to craft.",
  },
  'css3-animation-purist': {
    firstName: 'Lea',
    middleInitial: 'E',
    lastName: 'Meyer',
    fullName: 'Lea E. Meyer',
    inspiration:
      "Verou pushed the limits of what pure CSS can compute; Meyer wrote the books on CSS mastery — the animation specialist who knows that every transition curve is a statement of feeling, not just function, and obsesses over both.",
  },
  'data-engineer': {
    firstName: 'Jim',
    middleInitial: 'E',
    lastName: 'Codd',
    fullName: 'Jim E. Codd',
    inspiration:
      "Codd gave us relational algebra; Gray formalized ACID transaction semantics — the data engineer who treats every pipeline as a relational contract with transactional guarantees and refuses to ship data that can't be trusted.",
  },
  'database-architect': {
    firstName: 'Michael',
    middleInitial: 'D',
    lastName: 'Chamberlin',
    fullName: 'Michael D. Chamberlin',
    inspiration:
      "Stonebraker spent five decades pushing database performance boundaries; Chamberlin co-invented SQL to make Codd's theory accessible to the world — the architect who designs schemas that won't just survive today's load but tomorrow's pivot.",
  },
  'design-system-developer': {
    firstName: 'Jonathan',
    middleInitial: 'J',
    lastName: 'Maeda',
    fullName: 'Jonathan J. Maeda',
    inspiration:
      "Ive proved great design is invisible — you only notice when it's wrong; Maeda brought computation into design thinking itself — the design system developer who writes the grammar that makes a thousand interfaces feel like one unified experience.",
  },
  'design-systems-animator': {
    firstName: 'Eadweard',
    middleInitial: 'J',
    lastName: 'Lasseter',
    fullName: 'Eadweard J. Lasseter',
    inspiration:
      "Muybridge proved motion could be captured frame by frame; Lasseter proved synthetic motion could move you to tears — the design systems animator who knows that every 300ms transition either earns or betrays the user's trust.",
  },
  'devops-engineer': {
    firstName: 'Patrick',
    middleInitial: 'J',
    lastName: 'Humble',
    fullName: 'Patrick J. Humble',
    inspiration:
      "Debois coined 'DevOps' to end the war between builders and operators; Humble codified continuous delivery so the pipeline could never be an excuse — the DevOps engineer who believes shipping is a daily ritual, not a quarterly event.",
  },
  'drupal-integration-specialist': {
    firstName: 'Dries',
    middleInitial: 'M',
    lastName: 'Pilgrim',
    fullName: 'Dries M. Pilgrim',
    inspiration:
      "Buytaert built Drupal as a shared commons for the web; Pilgrim demystified web standards for millions of developers — the integration specialist who makes the old CMS speak the new language without breaking either.",
  },
  'drupal-specialist': {
    firstName: 'Angie',
    middleInitial: 'F',
    lastName: 'Potencier',
    fullName: 'Angie F. Potencier',
    inspiration:
      "Byron led Drupal's community into an enterprise CMS powerhouse; Potencier built Symfony to prove PHP could be elegant — the Drupal specialist who makes the most complex CMS feel effortless by standing on the right abstractions.",
  },
  'frontend-specialist': {
    firstName: 'Brendan',
    middleInitial: 'H',
    lastName: 'Lie',
    fullName: 'Brendan H. Lie',
    inspiration:
      "Eich gave the web its scripting soul in a weekend; Lie invented CSS so that soul could have style — the frontend specialist who believes that behavior and appearance are equally sacred disciplines, neither complete without the other.",
  },
  'infrastructure-engineer': {
    firstName: 'Kelsey',
    middleInitial: 'J',
    lastName: 'Saltzer',
    fullName: 'Kelsey J. Saltzer',
    inspiration:
      "Hightower made Kubernetes accessible to the mortals who run production; Saltzer's end-to-end principle taught us intelligence belongs at the edges, not the middle — the infrastructure engineer who designs systems that trust themselves to fail gracefully.",
  },
  'lit-specialist': {
    firstName: 'Alex',
    middleInitial: 'L',
    lastName: 'Wall',
    fullName: 'Alex L. Wall',
    inspiration:
      "Russell pushed web components and service workers into browser standards; Wall built Perl on the philosophy that there's more than one way to do it — the Lit specialist who makes web components portable across every framework with maximum power, minimum ceremony.",
  },
  'migration-specialist': {
    firstName: 'Pat',
    middleInitial: 'P',
    lastName: 'Selinger',
    fullName: 'Pat P. Selinger',
    inspiration:
      "O'Neil invented the log-structured merge tree that powers every modern database; Selinger invented query optimization at IBM — the migration specialist who knows every schema change is a query plan waiting to fail, and plans the rollback before the rollforward.",
  },
  'ml-engineer': {
    firstName: 'Corinna',
    middleInitial: 'L',
    lastName: 'Breiman',
    fullName: 'Corinna L. Breiman',
    inspiration:
      "Cortes co-invented support vector machines; Breiman invented random forests — the ML engineer who knows ensembles and margins are the foundation of anything trustworthy in production, and distrust of a single model is a professional virtue.",
  },
  'mobile-engineer': {
    firstName: 'Andy',
    middleInitial: 'C',
    lastName: 'Lattner',
    fullName: 'Andy C. Lattner',
    inspiration:
      "Rubin built Android to put the internet in every pocket; Lattner built Swift so iOS development could be safe, fast, and expressive — the mobile engineer who speaks both dialects of the most intimate computers humans have ever owned.",
  },
  'nextjs-specialist': {
    firstName: 'Guillermo',
    middleInitial: 'N',
    lastName: 'Wirth',
    fullName: 'Guillermo N. Wirth',
    inspiration:
      "Rauch proved server-rendering and edge-computing could be a developer's joy; Wirth taught that the right data structure is worth a thousand algorithms — the Next.js specialist who finds the elegant route from RSC to shipped, and never mistakes activity for progress.",
  },
  'open-source-specialist': {
    firstName: 'Eric',
    middleInitial: 'R',
    lastName: 'Stallman',
    fullName: 'Eric R. Stallman',
    inspiration:
      "Stallman founded the free software movement as a moral imperative; Raymond wrote the cathedral vs. bazaar — the open-source specialist who builds communities around code because they know the network effect is the product.",
  },
  'performance-engineer': {
    firstName: 'Addy',
    middleInitial: 'S',
    lastName: 'Souders',
    fullName: 'Addy S. Souders',
    inspiration:
      "Souders proved front-end performance was the highest-ROI optimization on the web; Osmani made modern performance patterns accessible and actionable — the performance engineer who treats every millisecond as a UX decision with a business consequence.",
  },
  'performance-qa-engineer': {
    firstName: 'Martin',
    middleInitial: 'G',
    lastName: 'Tene',
    fullName: 'Martin G. Tene',
    inspiration:
      "Thompson's mechanical sympathy proved code should work WITH hardware, not against it; Tene's HdrHistogram captures the latency outliers that p99 statistics hide — the performance QA engineer who tests for the worst-case, not the average, because users live in the tail.",
  },
  'pr-maintainer': {
    firstName: 'Junio',
    middleInitial: 'L',
    lastName: 'Torvalds',
    fullName: 'Junio L. Torvalds',
    inspiration:
      "Torvalds created git as a 'stupid content tracker' that became civilization's version control; Hamano has maintained it with surgical precision for two decades — the PR maintainer who brings that same precision to every rebase, format fix, and merge conflict.",
  },
  'privacy-engineer': {
    firstName: 'Latanya',
    middleInitial: 'A',
    lastName: 'Westin',
    fullName: 'Latanya A. Westin',
    inspiration:
      "Sweeney proved 'anonymous' data can be re-identified with just three data points; Westin defined contextual integrity as privacy's foundation — the privacy engineer who knows data minimization isn't a feature request, it's a moral obligation.",
  },
  'qa-engineer': {
    firstName: 'Cem',
    middleInitial: 'B',
    lastName: 'Marick',
    fullName: 'Cem B. Marick',
    inspiration:
      "Kaner pioneered the legal and ethical framework for software testing; Marick coined the testing quadrant and pushed agile testing into the mainstream — the QA engineer who treats a bug report as a legal brief and a test suite as a living document.",
  },
  'security-engineer': {
    firstName: 'Bruce',
    middleInitial: 'M',
    lastName: 'Hellman',
    fullName: 'Bruce M. Hellman',
    inspiration:
      "Hellman co-invented public-key cryptography; Schneier taught the world to think about security as a human system, not a technical product — the security engineer who knows every vulnerability is an assumption someone forgot to question.",
  },
  'senior-backend-engineer': {
    firstName: 'James',
    middleInitial: 'B',
    lastName: 'Stroustrup',
    fullName: 'James B. Stroustrup',
    inspiration:
      "Gosling made distributed programming safe and portable with Java; Stroustrup gave systems programmers the performance of C with the structure of abstraction — the backend engineer who writes the invisible layer everything else depends on.",
  },
  'senior-database-engineer': {
    firstName: 'Peter',
    middleInitial: 'T',
    lastName: 'Haerder',
    fullName: 'Peter T. Haerder',
    inspiration:
      "Chen's entity-relationship model gave developers a language to describe reality; Haerder's ARIES algorithm ensured databases could survive any crash — the senior database engineer who builds for the disaster they hope never comes, because it always does.",
  },
  'senior-frontend-engineer': {
    firstName: 'Ryan',
    middleInitial: 'D',
    lastName: 'Crockford',
    fullName: 'Ryan D. Crockford',
    inspiration:
      "Crockford excavated the good parts from JavaScript's chaos; Dahl invented Node.js so JavaScript's good parts could run everywhere — the senior frontend engineer who architects interfaces as reliable as the runtime they run on.",
  },
  'site-reliability-engineer-2': {
    firstName: 'Gene',
    middleInitial: 'J',
    lastName: 'Allspaw',
    fullName: 'Gene J. Allspaw',
    inspiration:
      "Kim chronicled how elite teams manage reliability in The Phoenix Project; Allspaw's ten deploys a day at Flickr proved uptime and velocity aren't opposites — the SRE who treats every incident as a learning event, not a blame event.",
  },
  'storybook-specialist': {
    firstName: 'Tom',
    middleInitial: 'M',
    lastName: 'Fowler',
    fullName: 'Tom M. Fowler',
    inspiration:
      "Coleman built Storybook so components could tell their own stories; Fowler defined the design patterns that make components worth documenting — the Storybook specialist who believes a component without a story is a component without a soul.",
  },
  'supabase-specialist': {
    firstName: 'Nikita',
    middleInitial: 'M',
    lastName: 'Stonebraker',
    fullName: 'Nikita M. Stonebraker',
    inspiration:
      "Stonebraker spent 50 years pushing what a relational database could do; Shamgunov carried that obsession into the cloud-native era — the Supabase specialist who makes PostgreSQL feel like a complete backend in a single config file.",
  },
  'test-architect': {
    firstName: 'Lisa',
    middleInitial: 'M',
    lastName: 'Bolton',
    fullName: 'Lisa M. Bolton',
    inspiration:
      "Crispin and Bolton collectively redefined modern testing strategy as a discovery practice — the test architect who designs frameworks that reveal truth about the system, not just certify that requirements were met.",
  },
  'typescript-specialist': {
    firstName: 'Anders',
    middleInitial: 'J',
    lastName: 'Gosling',
    fullName: 'Anders J. Gosling',
    inspiration:
      "Hejlsberg gave the web a type system and made C# elegant; Gosling gave enterprise a safe, portable language — the TypeScript specialist who knows a good type error today is a runtime disaster prevented tomorrow, and precision is kindness.",
  },
  'ux-researcher': {
    firstName: 'Don',
    middleInitial: 'J',
    lastName: 'Nielsen',
    fullName: 'Don J. Nielsen',
    inspiration:
      "Norman gave us affordances and the psychology of everyday things; Nielsen gave us heuristics and the discipline of usability testing — the UX researcher who knows every interaction is a hypothesis about human behavior waiting to be tested.",
  },
  'product-owner': {
    firstName: 'Mary',
    middleInitial: 'K',
    lastName: 'Schwaber',
    fullName: 'Mary K. Schwaber',
    inspiration:
      "Poppendieck brought lean manufacturing's waste elimination into software delivery; Schwaber created Scrum to make product development empirical rather than predictive — the product owner who keeps the backlog honest, the sprint achievable, and the user always visible.",
  },
};

/**
 * Wraps a YAML scalar value in double quotes if it contains special characters.
 * Special characters: apostrophes, colons, hash marks, brackets, etc.
 */
function yamlQuote(value) {
  // If the value contains a double quote, we need to escape them
  if (value.includes('"')) {
    // Escape internal double quotes and wrap
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  // If the value contains characters that require quoting in YAML
  if (
    value.includes("'") ||
    value.includes(':') ||
    value.includes('#') ||
    value.includes('[') ||
    value.includes(']') ||
    value.includes('{') ||
    value.includes('}') ||
    value.includes('|') ||
    value.includes('>') ||
    value.includes('!') ||
    value.includes('&') ||
    value.includes('*') ||
    value.includes(',') ||
    value.includes('?') ||
    value.startsWith('-') ||
    value.startsWith(' ') ||
    value.endsWith(' ')
  ) {
    return '"' + value + '"';
  }
  return value;
}

/**
 * Parse frontmatter from file content.
 * Returns { frontmatter: string, body: string } where frontmatter is the raw
 * content between the --- delimiters (without the delimiters themselves).
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

/**
 * Get a frontmatter field value (handles quoted and unquoted values).
 * Returns null if the field is not present.
 */
function getFrontmatterField(frontmatter, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = frontmatter.match(re);
  if (!match) return null;
  let val = match[1].trim();
  // Strip surrounding quotes if present
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val;
}

/**
 * Set or add a frontmatter field. If the field already exists, update it.
 * If it doesn't exist, append it after the `fullName` field or at end.
 */
function setFrontmatterField(frontmatter, key, value) {
  const re = new RegExp(`^(${key}:.*)$`, 'm');
  const quotedValue = yamlQuote(value);
  const newLine = `${key}: ${quotedValue}`;
  if (re.test(frontmatter)) {
    return frontmatter.replace(re, newLine);
  }
  // Field doesn't exist — need to insert it
  return null; // signal caller to handle insertion
}

/**
 * Build the updated frontmatter string with all name fields and inspiration.
 */
function updateFrontmatter(frontmatter, data) {
  const { firstName, middleInitial, lastName, fullName, inspiration } = data;
  let fm = frontmatter;

  // Helper: set or insert field after `anchor` field
  function upsertField(fm, key, value, anchor) {
    const re = new RegExp(`^(${key}:.*)$`, 'm');
    const quotedValue = yamlQuote(value);
    const newLine = `${key}: ${quotedValue}`;
    if (re.test(fm)) {
      return fm.replace(re, newLine);
    }
    // Insert after anchor if provided and found
    if (anchor) {
      const anchorRe = new RegExp(`^(${anchor}:.*)$`, 'm');
      if (anchorRe.test(fm)) {
        return fm.replace(anchorRe, `$1\n${newLine}`);
      }
    }
    // Otherwise append at end
    return fm + '\n' + newLine;
  }

  // Order: firstName, middleInitial, lastName, fullName, inspiration
  // We want them in sequence. Strategy: if none exist, insert them before `category` or at end.
  // If some exist, update them in place and add missing ones after their predecessor.

  const hasFirst = /^firstName:/m.test(fm);
  const hasMid = /^middleInitial:/m.test(fm);
  const hasLast = /^lastName:/m.test(fm);
  const hasFull = /^fullName:/m.test(fm);
  const hasInspiration = /^inspiration:/m.test(fm);

  if (!hasFirst && !hasMid && !hasLast && !hasFull) {
    // None exist — insert the block before `category` or at end
    const nameBlock = [
      `firstName: ${yamlQuote(firstName)}`,
      `middleInitial: ${yamlQuote(middleInitial)}`,
      `lastName: ${yamlQuote(lastName)}`,
      `fullName: ${yamlQuote(fullName)}`,
    ].join('\n');

    if (/^category:/m.test(fm)) {
      fm = fm.replace(/^(category:.*)$/m, `${nameBlock}\n$1`);
    } else if (/^type:/m.test(fm)) {
      fm = fm.replace(/^(type:.*)$/m, `${nameBlock}\ntype: $1`);
      // Actually replace just the type line cleanly:
      fm = fm.replace(
        new RegExp(`^(${nameBlock}\ntype: type: .*)$`, 'm'),
        nameBlock + '\n' + fm.match(/^type:.*$/m)?.[0],
      );
      // Simpler: just redo the insert properly
      fm = frontmatter.replace(/^(type:.*)$/m, `${nameBlock}\n$1`);
    } else {
      fm = fm + '\n' + nameBlock;
    }
  } else {
    // Update existing fields
    fm = upsertField(fm, 'firstName', firstName, 'name');
    fm = upsertField(fm, 'middleInitial', middleInitial, 'firstName');
    fm = upsertField(fm, 'lastName', lastName, 'middleInitial');
    fm = upsertField(fm, 'fullName', fullName, 'lastName');
  }

  // Handle inspiration — insert after fullName if not present
  if (hasInspiration) {
    fm = upsertField(fm, 'inspiration', inspiration, 'fullName');
  } else {
    fm = upsertField(fm, 'inspiration', inspiration, 'fullName');
  }

  return fm;
}

/**
 * Update H1 heading in body: `# <Role> — <OldName>` → `# <Role> — <NewName>`
 */
function updateH1(body, newFullName) {
  // Match: # <anything> — <OldName>  (em dash variant)
  return body.replace(/^(#\s+[^—\n]+\s+—\s+).+$/m, `$1${newFullName}`);
}

/**
 * Recursively collect all .md files under a directory.
 */
function collectMarkdownFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Derive agent ID from filename (basename without .md).
 */
function agentIdFromPath(filePath) {
  return basename(filePath, '.md');
}

// Main execution
function main() {
  const dirsToProcess = targetDir
    ? [targetDir]
    : [
        join(PROJECT_ROOT, '.claude/agents'),
        join(PROJECT_ROOT, 'agents'),
      ];

  const stats = {
    processed: 0,
    skipped: [],
    notInMapping: [],
    errors: [],
  };

  const processedNames = []; // for duplicate check (agentId + dir to avoid cross-dir false positives)

  for (const dir of dirsToProcess) {
    let files;
    try {
      files = collectMarkdownFiles(dir);
    } catch (e) {
      console.error(`Cannot read directory ${dir}: ${e.message}`);
      continue;
    }

    console.log(`\nProcessing directory: ${dir} (${files.length} files)`);

    for (const filePath of files) {
      const agentId = agentIdFromPath(filePath);
      const mapping = NAME_MAP[agentId];

      if (!mapping) {
        stats.notInMapping.push(filePath);
        if (dryRun) {
          console.log(`  [SKIP - not in mapping] ${agentId}`);
        }
        continue;
      }

      let content;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch (e) {
        stats.errors.push({ file: filePath, error: e.message });
        console.error(`  [ERROR reading] ${filePath}: ${e.message}`);
        continue;
      }

      const parsed = parseFrontmatter(content);
      if (!parsed) {
        stats.errors.push({ file: filePath, error: 'Could not parse frontmatter' });
        console.error(`  [ERROR no frontmatter] ${filePath}`);
        continue;
      }

      const { frontmatter, body } = parsed;

      // Update frontmatter
      const newFrontmatter = updateFrontmatter(frontmatter, mapping);

      // Update H1 heading
      const newBody = updateH1(body, mapping.fullName);

      const newContent = `---\n${newFrontmatter}\n---\n${newBody}`;

      if (dryRun) {
        console.log(`\n  [DRY RUN] ${agentId} (${filePath})`);
        console.log(`  --- New frontmatter ---`);
        console.log(newFrontmatter.split('\n').map(l => `    ${l}`).join('\n'));
        // Show H1 diff if changed
        const oldH1 = body.match(/^#\s+.+$/m)?.[0];
        const newH1 = newBody.match(/^#\s+.+$/m)?.[0];
        if (oldH1 !== newH1) {
          console.log(`  H1: "${oldH1}" → "${newH1}"`);
        } else {
          console.log(`  H1: unchanged (${oldH1 || 'no H1 found'})`);
        }
      } else {
        try {
          writeFileSync(filePath, newContent, 'utf8');
          console.log(`  [OK] ${agentId}`);
        } catch (e) {
          stats.errors.push({ file: filePath, error: e.message });
          console.error(`  [ERROR writing] ${filePath}: ${e.message}`);
          continue;
        }
      }

      stats.processed++;
      processedNames.push({ agentId, fullName: mapping.fullName, file: filePath, dir });
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Not in mapping (skipped): ${stats.notInMapping.length}`);
  if (stats.notInMapping.length > 0) {
    stats.notInMapping.forEach(f => console.log(`  - ${agentIdFromPath(f)}`));
  }
  if (stats.errors.length > 0) {
    console.log(`Errors: ${stats.errors.length}`);
    stats.errors.forEach(e => console.log(`  - ${e.file}: ${e.error}`));
  }

  // Duplicate fullName check — per directory (same agent in .claude/agents and agents/ is expected)
  for (const dir of dirsToProcess) {
    const dirEntries = processedNames.filter(e => e.file.startsWith(dir));
    const nameCount = {};
    for (const { fullName, agentId } of dirEntries) {
      if (!nameCount[fullName]) nameCount[fullName] = [];
      nameCount[fullName].push(agentId);
    }
    const duplicates = Object.entries(nameCount).filter(([, ids]) => ids.length > 1);
    if (duplicates.length > 0) {
      console.log(`\n[WARNING] Duplicate fullName values in ${dir}:`);
      duplicates.forEach(([name, ids]) => {
        console.log(`  "${name}" → ${ids.join(', ')}`);
      });
    } else {
      console.log(`\nNo duplicate fullName values in ${dir}.`);
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No files were written.');
  }
}

main();
