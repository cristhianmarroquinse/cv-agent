# Cristhian Marroquin — public career knowledge base

## Identity
- Name: Cristhian Marroquin (full name Cristhian Camilo Marroquin Anzola).
- Based in Madrid, Spain (Greater Madrid Metropolitan Area). Colombian.
- Email: cristhianmarroquinse@gmail.com. LinkedIn: https://www.linkedin.com/in/cristhian-marroquin/. GitHub: https://github.com/cristhianmarroquinse. Product site: https://smartcoachapp.com.
- Languages: Spanish native, English B2 (professional working proficiency, daily written use at work).

## Positioning
- Headline: AI Engineer. LLM apps in production: tool calling, RAG, agents, evals. Full-stack TypeScript (NestJS, Next.js) and Python. Remote, Spain / Colombia.
- Looking for: AI Engineer / LLM Engineer / Senior Full-Stack Engineer roles on AI products. Builds LLM applications (tool calling, RAG, agents, evals, inference gateways). Not an ML researcher.
- Work mode: 100% remote (the AiKit role has been hybrid in Madrid; the next one should be fully remote). Based in Spain, open to Spain, EU, Colombia, LatAm and US companies hiring remotely in those regions. Full-time, contract or part-time.
- Availability: immediate. His AiKit contract ends in November 2026 as part of a collective redundancy process already under way, and he can leave earlier if a new role starts sooner. No notice period to negotiate.
- Story in one line: ten years of full-stack web engineering and five years on AI products, starting with conversational AI in 2021 (DialogFlow chatbots at Walmart), generative AI in production since 2024 (RAG at Walmart), and since 2025 LLM platform engineering at AiKit plus a self-built LLM product with real evals.
- Public proof: GitHub https://github.com/cristhianmarroquinse (a public portfolio being rebuilt; the SmartCoach code is private) and the live SmartCoach product at https://smartcoachapp.com, which anyone can open and try.

## Summary
I build LLM applications that survive production. At AiKit, a Spanish AI platform, I work on the inference layer and the tooling around it: a multi-provider gateway with prompt caching and cost attribution, a curated model catalog, skill-based RAG, MCP tools that let the assistant operate an ERP, an AI pull-request reviewer, and the security hardening of the platform backend. 250+ tickets shipped in the last 12 months. Before that, four years at Walmart Chile building conversational products: a WhatsApp chatbot for marketplace seller onboarding and an internal HR assistant, upgraded in 2024 with RAG over a vector database. On the side I founded SmartCoach (smartcoachapp.com), an AI fitness and nutrition coach: 27 typed tools behind a preview/confirm flow, an intent router, model-agnostic guardrails, and an eval harness I used to move production from Claude Haiku to DeepSeek at 87% lower cost. Stack: TypeScript, Node.js (NestJS, Express), React/Next.js, Python, PostgreSQL, GraphQL, Vercel AI SDK, OpenAI / Anthropic / Gemini APIs, OpenRouter, MCP, Azure, GCP (Cloud Run), Docker. Ten years in software, the last five on AI products.

## Experience: AI Engineer at AiKit (Madrid, hybrid), Jun 2025 – present
AiKit is a Spanish AI platform for organisations: several LLM providers behind one chat, plugin tool calling, artifacts, knowledge-base RAG and an Odoo ERP integration, with role-based access, seats and per-org feature flags.
Volume: about 1,000 commits across tool-cms (Payload CMS + Express backend), ai-toolkit-front (React 18 + Vite + MobX), odoo-aikit (Odoo 18, Python), aikit-automations (Activepieces fork), aikit-platform v3, aikit-web, puppeteer-vm and github-pr-analyzer. 250+ Linear tickets closed between Nov 2025 and Oct 2026.

### AiKit: inference gateway
Built the inference gateway on Vercel AI SDK v6 with OpenRouter and the Anthropic, OpenAI and Gemini SDKs: prompt caching, cache-write token and cost attribution, Anthropic rolling cache applied to every Anthropic model in the catalog, per-thread OpenRouter sessions, reasoning-level routing, per-replica model registry and catalog fetch timeouts.

### AiKit: model catalog and model selector
Curated multi-provider model catalog with LMArena ingestion, admin preview/refresh endpoints, an API-key gateway, and a unified model selector with a reasoning slider in the React front end.

### AiKit: prompts, RAG, audio, memories
Editable system-prompt system (master in code, overrides in Payload CMS, per-model variants, export). Skill-first RAG with chunked-embedding context boost. Audio transcription with Whisper and native Gemini audio. Follow-up suggestions, org-shared memories, project sharing by department.

### AiKit: MCP tool in Odoo 18
MCP tool inside Odoo 18 that lets the assistant draft vendor bills with tax mapping and deduplication. Spanish e-invoicing (Veri*Factu, certificates). Org-manager role with server-side guards and phased migrations.

### AiKit: automations platform ("AiKit IA" piece)
"AiKit IA" piece for the Activepieces-based automation platform: structured extraction, summarise, classify, image generation (v0.1 to 0.5.0), plus a migration script moving legacy Claude/OpenAI steps to the gateway. Shared multi-org VM deployment on Azure.

### AiKit: AI pull-request reviewer
Sole author of an AI PR reviewer: Azure Function + GitHub App + Linear GraphQL + Gemini 2.5 Pro that posts a requirement-vs-diff checklist on every PR (350k-char diff cap, parallel fetch with retries).

### AiKit: security audit and hardening
Security audit and hardening of the CMS backend (Sep–Oct 2026, 30+ tickets): REST field access on user-owned collections, session revocation on password/email change, email-change verification, forgot-password abuse, an auth fail-open bug, lost-update bugs in read-merge-write paths, CORS origin check, signed file URLs without owner check, cookie-forwarding fetch bridge. Removed about 8,500 lines of dead code.

### AiKit: document tooling, platform v3, infra
Native PowerPoint generation with corporate theme, Office-to-PDF via LibreOffice, artifact-to-PDF export, magic-link passwordless login. Platform v3 (Turborepo, React, Express, Postgres): cookie/JWT auth, executions view over SSE, scheduled rules, folders, recycle bin, integrations, cost and plan-usage summary. Marketing CMS infra: Cloud Run CI/CD via GitHub Actions, migration from SQLite to Cloud SQL Postgres + GCS with staging and promote-to-production workflows. Subsidy evidence pipeline (Kit Digital): Puppeteer captures of personalised Odoo screens per beneficiary, Word/PDF generation, SharePoint upload, and an odoo-doctor reconciliation CLI.

### AiKit: daily process
Daily agent-driven workflow with Claude Code, MCP servers, AI code review, and autonomous ticket and merge "trains" with protected-branch guards.

## Experience: Senior Software Engineer at Walmart Marketplace Chile (remote), Jul 2021 – Jun 2025
Data and AI team. Designed and built the WhatsApp chatbot for seller onboarding and support of the newly launched Chilean marketplace (Google DialogFlow, NestJS, Infobip); registered sellers grew 1000%+ between 2023 and 2024. Built an internal HR assistant answering employee questions on HR processes and company policies, cutting the time staff spent looking for information. In 2024 added retrieval-augmented generation: ingestion of PDFs and HTML articles into a vector database (LanceDB), similarity search feeding context to the LLM; fewer unanswered queries and more accurate answers.
Stack: TypeScript, NestJS/Express, React/Next.js, React Native, Vue, MongoDB, CosmosDB, PostgreSQL, Kubernetes, Docker, Jenkins, Grafana, Prometheus, Splunk, GraphQL, Redux, Tailwind.

## Experience: Founder and sole engineer at SmartCoach (side product), Aug 2023 – present
AI fitness and nutrition coach in Spanish for Colombia/LatAm, live at smartcoachapp.com. B2C users chat with an AI coach for meal plans, workout programs, food logging by photo or voice, hydration and weight tracking. B2B mode for coaches: the AI drafts the plan, the coach approves; client panel, chat, coach billing. Plans: Free (5 AI queries/day) and Premium at $6.99/month.

### SmartCoach: AI engine and tool calling
Vercel AI SDK v6 via OpenRouter. 27 Zod-typed tools (9 meal, 15 workout, 3 onboarding) with a 7-step loop cap. Production model DeepSeek V4 Flash, fallback Claude Haiku 4.5, Gemini 2.5 Flash for food photos and direct audio. Intent router (meal / workout / general / mixed) that sends only the relevant toolset.

### SmartCoach: preview/confirm pattern and guardrails
Preview/confirm pattern: generated plans are cached per user, edited in place by modification tools and written to the database only on confirm, with one level of undo and a per-user lock serialising parallel tool calls. Model-agnostic guardrails built after an incident where the model claimed a save it never ran: honesty invariant (the server corrects unbacked claims and does not charge quota), deterministic confirm/modify forcing, closure recovery with forced tool choice, text gates and sanitisers, state-gated toolsets.

### SmartCoach: semantic search and evals
Semantic search over 1,851 Vertex AI embeddings (950 meals, 901 ingredients) within a 20-tag taxonomy. Evals: bake-off of Claude Haiku 4.5, GLM-4.6, Kimi K2.6 and DeepSeek V4 Flash on a golden set; moved production to DeepSeek at 87% lower cost. The successor harness runs 12 flows / 24 turns against a throwaway Docker database scored from API traces. Measured AI cost at or below about $2 per active Premium user per month.

### SmartCoach: stack, tests, process
Stack: NestJS 10, GraphQL (code-first), Prisma, PostgreSQL 17 on Supabase (database round-trip cut from about 456 ms to 25 ms by moving regions), SSE streaming, Next.js 14 PWA, Redux Toolkit, Apollo, shadcn/ui, Capacitor 8 (iOS/Android, not yet in the stores), Auth0 + HMAC cookie, Stripe, OneSignal, Resend, Sentry, GCP Cloud Run via GitHub Actions, Hono + Bun on Vercel for the exercise database, Remotion + ElevenLabs for tutorial videos. Tests: about 4,200 API cases (Jest), 4,400 PWA cases (Vitest) and 290 exercise-API cases. Process: spec-driven AI workflow with Claude Code (4 review agents, 13 rules, 17 custom skills, 73 specs), browser verification with agent-browser, a self-built Rust task runner. Honest status: a founder side product with no public user or revenue numbers; about 90% of its 830 commits are his.

## Experience: earlier roles (2016 – 2021)
- Senior Frontend Developer at Lentesplus.com (Colombia, remote), Nov 2020 – Jul 2021: migrated the e-commerce front end to Magento 2 PWA (React, Apollo GraphQL) for the mobile app launch, with large load-time and mobile usability gains.
- Senior Full Stack Developer at HelloBuild (Miami, remote contract), Dec 2019 – Feb 2021: real-time construction-progress app on AWS Lambda serverless, Node/TypeScript, Prisma 2, Nexus, Apollo, GraphQL subscriptions, React/Next.js, DevOps.
- Project Leader at Intelnov SAS (Colombia), Dec 2019 – Dec 2020: led the team building Zpazium (shared commercial space rentals with interactive map): requirements, AWS architecture, Prisma/Nexus/GraphQL API, Next.js front end. These three 2019–2021 roles overlapped as freelance/contract work.
- Project Leader at TodoEnMaquinariaPesada, Aug – Nov 2019: heavy-machinery marketplace with Laravel 6 API, MariaDB, React, AWS.
- Developer Team Leader at Rehobot Technology (Colombia), Jan – Aug 2019: home gasoline-delivery scheduling platform with Express API, MySQL, React, AWS.
- Semi-senior Full Stack at PrograCOL, Apr – Nov 2018: backend services and maintenance for healthcare apps (Laravel, PHP, MySQL, jQuery).
- Junior Developer at Flomecol, Jul 2017 – Mar 2018: CRM and product catalog on LAMP / Laravel 5.3.
- Junior Backend Developer at Unusual Minds, Feb 2016 – Jun 2017: maintenance of the ShockFamily product suite (1M+ registered users) with PHP/Laravel, WordPress, MongoDB, MailChimp, PayPal.

## Education
- Systems and Computer Engineering, Universidad Nacional de Colombia, 2012–2023 (completed).
- Technologist in Programming and Software Development, SENA, 2009–2010.
- Coursera Deep Learning Specialization (in progress).

## Skills
Core: Large Language Models (LLM), TypeScript, Retrieval-Augmented Generation (RAG), Node.js, Python, tool calling / function calling, AI agents, prompt engineering, LLM evaluation, Model Context Protocol (MCP), vector databases (LanceDB, Vertex AI embeddings), Vercel AI SDK, OpenRouter, Anthropic, OpenAI and Gemini APIs, multimodal (image, audio).
Backend: NestJS, Express, GraphQL (Apollo, code-first), Prisma, PostgreSQL, MongoDB, Redis, Supabase, SSE streaming, REST, Payload CMS, Python (Litestar, Odoo), Laravel/PHP (legacy).
Frontend: React, Next.js, Redux Toolkit, MobX, Tailwind, shadcn/ui, PWA, React Native, Capacitor, Vite.
Infra and ops: Docker, Kubernetes, GCP (Cloud Run, Cloud SQL, GCS), Azure (Container Apps, Functions, Azure Search), AWS (Lambda, EC2, RDS, S3), GitHub Actions, Jenkins, CI/CD, Grafana, Prometheus, Splunk, Sentry, Infisical, Litestream.
Product and AI tooling: Stripe, Auth0, OneSignal, Resend, DialogFlow, Infobip, Activepieces, Odoo 18, Remotion, ElevenLabs, Puppeteer/Playwright, agent-browser, Claude Code, MCP servers.
Testing: Jest, Vitest, Cypress, Playwright; eval harnesses for LLM flows.

## Strengths
- Ships LLM features to production and measures them: cost attribution, caching, evals, guardrails.
- End-to-end ownership: backend, frontend, infra, CI/CD, mobile packaging, payments.
- Security-minded: ran a 30+ ticket audit of a production backend.
- Works agent-driven daily (Claude Code, MCP) and has built the tooling for it, not just used it.
- Founder discipline: a 3-year side product with 8,000+ tests and a spec-driven process.
- Bilingual market reach: Spain/EU plus Colombia/LatAm, with US-timezone experience from Walmart Chile.
- Honest about limits: English is B2 (professional working proficiency, daily written use); no classic ML research background (no model training, PyTorch or papers): the focus is applied LLM engineering. These are the two limits to mention if asked about weaknesses; they do not need to be volunteered.

## Story: the model that lied (SmartCoach, Oct 2026)
The LLM told a user it had saved a workout plan although no tool call had run. Built an honesty invariant (the server verifies claims against actual tool calls and corrects unbacked ones without charging quota), deterministic confirm/modify forcing and closure recovery with forced tool choice. Added regression evals. The pattern is now model-agnostic.

## Story: 87% cheaper inference (SmartCoach)
Designed a golden set, ran a four-model bake-off (Claude Haiku 4.5, GLM-4.6, Kimi K2.6, DeepSeek V4 Flash). DeepSeek V4 Flash passed 15/17 at a fraction of the cost but was unstable on re-runs, so built a repeatable harness and migrated with fallbacks. Result: 87% lower inference cost.

## Story: prompt caching and cost attribution at AiKit
Added cache-write token tracking so per-organisation analytics reflect real spend, and rolled cache configuration across all Anthropic models in the gateway.

## Story: security audit of a live backend (AiKit)
Found REST collections writable by their owners around the handlers, sessions not revoked on password change, a CORS substring check, and more. Fixed 30+ issues without downtime.

## Story: Walmart WhatsApp onboarding bot
Took seller registrations up 1000%+ by automating onboarding and support over WhatsApp with DialogFlow and NestJS, then added RAG in 2024 to cut unanswered questions in the HR assistant.

## Story: MCP tool that drafts invoices in Odoo (AiKit)
The assistant creates vendor bills with tax mapping and deduplication, gated by role. An example of an AI operating an ERP safely.

## Story: CMS migration and database latency
Moved a CMS from SQLite to Cloud SQL with staging and promote-to-production workflows in a day of PRs. Separately, cut SmartCoach database latency from 456 ms to 25 ms by moving regions, found through measurement discipline.

## About this website
This site is itself a demo built by Cristhian: a chat agent over his CV. Each message goes through an API gateway with rate limiting, a response cache, a local embedding model (multilingual-e5-small via Transformers.js) plus BM25 hybrid retrieval over this knowledge base, an LLM chosen from a curated catalog of cheap models on OpenRouter (Claude Haiku 5.5, DeepSeek V4 Flash and others) with tool calling, and tools that emit UI artifacts (timeline, skills, projects, stories). The architecture diagram animates the real events emitted by the backend over Server-Sent Events, including cache hits and provider prompt-cache reads. Stack: Bun, Hono, TypeScript, React, Vite, Tailwind, Motion.

## Deep dive: the honesty invariant (SmartCoach)
What happened: a user asked SmartCoach to save a workout plan and the model answered that it was saved, but no tool call had run, so nothing was written. How the invariant works now: after every turn the server compares the final answer with the turn's record of tool calls; a lightweight detector (Spanish and English) flags "action completed" phrases such as saved, updated, deleted or scheduled; if an action phrase has no matching successful tool call in that turn, the server corrects the answer instead of letting the claim through and does not charge the user's quota for that turn. Negations, conditional phrasing ("I will save it once you confirm") and references to earlier turns are handled so they do not trigger the correction. Regression evals cover the incident class in the eval harness (12 flows / 24 turns). It is model-agnostic because it lives on the server and works on the tool-call trace, not on the prompt: changing the model does not require rewriting it.

## Deep dive: the 87% cheaper inference bake-off (SmartCoach)
The golden set had 17 cases covering the real user flows (onboarding, meal plan generation, workout plan generation, in-place modification, confirm and undo). Four models were compared: Claude Haiku 4.5, GLM-4.6, Kimi K2.6 and DeepSeek V4 Flash. DeepSeek V4 Flash passed 15 of 17 at a fraction of the cost, but its results were not stable across re-runs, which is why the successor harness runs each flow repeatedly against a throwaway Docker database and scores the API traces (tool calls, arguments, order) rather than the text. The migration shipped with a safety net: automatic fallback to Claude Haiku 4.5 when DeepSeek returns an invalid tool call or times out, and Gemini 2.5 Flash for food photos and audio. Measured AI cost after the migration: at or below about $2 per active Premium user per month, 87% lower than before.

## Deep dive: prompt caching and cost attribution (AiKit gateway)
The gateway places cache breakpoints so that the stable prefix of each request (system prompt, tool catalog and knowledge context) is cached while the conversation tail stays outside it, and a rolling cache moves the breakpoint forward on every turn so the next turn reuses the whole prefix. This rolling cache is applied to every Anthropic model in the catalog. Cost per turn is computed from the provider's own usage report: uncached input tokens, cache-write tokens, cache-read tokens and output tokens, each at its own price from the model catalog. Cache-write tokens are tracked separately because they are priced higher than normal input and were previously counted as plain input, which understated real spend. Every request carries organisation, user, thread and model, and cost is aggregated per organisation for the usage panel and plan limits.

## Deep dive: the security audit of the AiKit backend
Method: manual review of REST routes and Payload CMS hooks, tests with users from different organisations, and one reproducible script per finding, tracked as 30+ Linear tickets with severity and a regression test. Findings, in order of severity: REST field access on user-owned collections that bypassed the handlers; an authentication fail-open bug where an error in the check let the request through; sessions not revoked on password or email change; missing verification on email change and abuse of the forgot-password flow; a CORS origin check by substring; signed file URLs that did not check the owner; lost-update bugs in read-merge-write paths; and a cookie-forwarding fetch bridge. All were fixed without downtime, with phased rollouts, and about 8,500 lines of dead code were removed along the way.

## Deep dive: Walmart, from DialogFlow intents to RAG
2021: Google DialogFlow handled the seller-onboarding intents, NestJS was the backend and Infobip the WhatsApp channel; registered sellers grew 1000%+ between 2023 and 2024. 2024: the internal HR assistant gained retrieval-augmented generation: PDFs and HTML articles ingested into LanceDB, similarity search feeding the retrieved context to the LLM, which cut unanswered queries and improved answer accuracy.

## Design opinions

### How he would design RAG at scale (millions of documents)
These are Cristhian's own stated views on how he would design systems, not CV facts. Start with the retrieval problem, not the model. Incremental ingestion with hash-based deduplication, chunking by document structure rather than fixed size, and metadata for source and date. Hybrid search (BM25 plus vectors) with rank fusion and a light reranker only over the top 50. Vector index in Postgres with pgvector while it fits one instance; move to a dedicated service only when p95 latency demands it. Cache query embeddings and answers per tenant. Continuous evaluation with recall@k on a golden set of questions with their expected chunks, and faithfulness judged by a model on a daily sample. The lesson from Walmart and AiKit: most RAG failures are retrieval or chunking failures, not LLM failures.

### How he would design an agent that operates an ERP safely
Never direct writes. Three layers: broad read tools and minimal, Zod-typed write tools; a preview/confirm pattern where the write tool produces a draft a human approves, as he did with vendor bills in Odoo and with plans in SmartCoach; and server-side invariants: deduplication by natural key, idempotency by operation id, role limits, and an audit log with the prompt, the tool call and the result. Plus an eval set with abuse attempts (injection in documents, instructions inside emails) that runs before every deployment.

### What he would do differently in SmartCoach
Start the eval harness in the first month, not after the incident. Fewer, more general tools (27 is too many to maintain) with a stricter intent router. Structured UI streaming instead of text from day one. And measure cost per user from the first week, because that is what ended up deciding the model.

### Risks of DeepSeek or any cheap model in production
Data residency and compliance (where prompts are processed), stability between model versions, variability between runs, and uneven tool-calling support. His rule: never a single provider in production. A catalog with automatic fallback, evals that run against every new model before enabling it, and cost and quality attribution per model so a rollback can be made with data.

### How he evaluates the quality of an LLM system
Three levels: deterministic tests over tool calls (arguments, order, idempotency), retrieval metrics (recall@k, MRR) on golden sets, and LLM judges with a rubric for grounding and usefulness, calibrated against human labels on a sample. Everything with cost and latency per case, because a quality gain that doubles cost is a product decision, not an engineering one.
