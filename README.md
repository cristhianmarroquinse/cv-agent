# cv-agent

Interactive CV: a chat agent over Cristhian Marroquin's career that visualises its own pipeline
(gateway → cache → local embeddings → hybrid RAG → LLM with tool calling → artifacts) as the
message travels through it. Every animation is driven by real events emitted by the backend over SSE.

## Run locally

```bash
bun install
cp .env.example .env            # put your OPENROUTER_API_KEY in it
bun run dev                     # API on :3001, web on :5173 (proxies /api)
```

Open http://localhost:5173. First start downloads the embedding model
(`Xenova/multilingual-e5-small`, ~120 MB) into `.cache/` and embeds the knowledge base once.

## Layout

```
apps/server   Bun + Hono API
  src/knowledge/cv.md        curated public knowledge base (RAG corpus)
  src/knowledge/cv.data.ts   structured data behind the tools (timeline, skills, projects, stories)
  src/rag/                   chunker, BM25, Transformers.js embedder, hybrid store (RRF)
  src/llm/                   OpenRouter streaming client + curated model catalog with live pricing
  src/agent/                 prompt, tools, orchestrator, planner, specialists, verifier, jobfit
apps/web      Vite + React + Tailwind + Motion
  src/lib/store.ts           zustand store; paces pipeline events so the diagram stays legible
  src/components/            Header, Architecture (vertical SVG diagram + agents lane), Chat, Artifacts
packages/shared              event, artifact and model contracts shared by both sides
```

## What the diagram shows

| Node | Backed by |
|---|---|
| API Gateway | Hono route, zod validation, per-IP and global rate limit |
| Cache | three LRU caches: response (session + mode + model + normalised question + flags), semantic (per-session question vectors, cosine ≥ 0.92, checked before the planner) and retrieval (query embedding + hits). The switch bypasses the first two |
| Embedder | `multilingual-e5-small` running locally via Transformers.js (384 dims) |
| Vector store | in-memory cosine search fused with BM25 by reciprocal rank |
| LLM | OpenRouter chat completions with streaming and tools; `cache_control` for Anthropic models; provider prompt-cache reads reported from usage |
| Tools | `search_cv`, `get_experience`, `get_skills`, `get_project`, `get_story`, `get_contact`, `get_demo_models` |
| Artifacts | tool results rendered as timeline, skills, project, story, contact and table cards; the job-fit assessment card comes from the agents (`llm → artifacts`) |

## Agents

| Agent | Role | When |
|---|---|---|
| planner | one cheap JSON call deciding simple vs compound and which domains; off-topic questions get `simple` with no domains (out of scope), so no specialists run | every chat message, after retrieval and the cache checks (it is one extra short call, about a second) |
| experience / projects / skills | specialists with scoped retrieval (section filter) and their own tool subset, run in parallel | compound questions only |
| synthesizer | merges the specialists' notes into the streamed answer | compound questions only |
| verifier | extracts the claims of the final answer and checks each against the evidence the pipeline actually used; unsupported claims are shown under the answer | every chat answer (skipped on cache hits, result cached). Same model as the chat, separate call; it flags, it does not rewrite |
| extractor → matcher ×N → writer | job-fit pipeline: structured extraction of requirements, one matcher per requirement in parallel (bounded concurrency 4) with its own retrieval, then a streamed verdict and a `jobfit` artifact | "Job fit" mode in the chat input |

The agents lane on the diagram is populated from `agent.start` / `agent.progress` / `agent.end` events; packets travel LLM → agent → LLM. Every LLM call an agent makes emits `llm.usage` with its `agent`, so the LLM card lists all tokens and cost of the run, and every scoped search emits `retrieval.hits` with its `agent` and measured time. Timestamps are stamped when an event is emitted, not when the socket drains; the gateway time is measured from request arrival. Cache replays report zero usage.

## Semantic cache and tailored CV

- **Semantic cache**: besides the exact-match response cache, each session keeps the embedding of every answered question; a new question with cosine similarity ≥ 0.92 to one of them (same model, mode and reasoning flag) is served from that answer. The diagram shows vector store → cache with a "semantic HIT 0.93" badge. Both caches are scoped to the page-load session id and can be bypassed with the Cache switch.
- **Tailored CV**: on a job-fit card, "Generate CV for this role" calls `POST /api/cv/tailored` with the requirements and fit rows. One structured-output call selects and orders facts from `cv.data.ts`; the server keeps only experience bullets, skills and project lines that match that data (exact or substring after normalisation), then renders an A4 PDF (usually one page) with pdf-lib (`apps/server/src/agent/tailoredCv.ts`). Profile and fit lines are model-written from the same data and the footer says so.

- **Inline artifacts**: tool results render as collapsible cards inside the assistant bubble that produced them (open for the latest answer); the workspace is two columns (architecture + chat).
- **Follow-up suggestions**: a `suggester` agent (DeepSeek V4.1 Flash, ~$0.0001) proposes three next questions after every answer, in parallel with the verifier; the composer shows two fixed openers first, then the follow-ups topped up with the curated list, hiding anything already asked (`apps/server/src/agent/suggester.ts`).
- **Attachments**: in Job fit mode a posting can be attached (PDF, PNG/JPG/WebP, DOCX, TXT/MD, 5 MB) or dropped on the input. A `reader` agent runs before the extractor: PDF text layer via unpdf and DOCX via mammoth locally; images and scanned PDFs are transcribed by a cheap multimodal model (Gemini 2.5 Flash Lite, with Haiku 5.5 and Gemini 2.5 Flash as fallbacks). The text is stripped, capped at 8,000 chars and treated as data (`apps/server/src/agent/reader.ts`).

## Retrieval notes

Growing the knowledge base (deep dives and design opinions) displaced expected sections from the top-5 for generic questions: the candidate's name is now in almost every query, so it was added to the BM25 stop list, and the opinions section no longer carries a long heading path into every chunk. The retrieval cases of the golden set accept alternatives (`Story: …|Deep dive: …`). Re-run `bun run bakeoff` after any knowledge-base change: retrieval recall is part of the report.

## Verifier

Two passes. A deterministic term check extracts named entities, technologies and numbers from the answer and looks them up in the retrieved evidence and in the whole knowledge base: terms that exist nowhere are "unknown" and any claim built on them is unsupported regardless of what the model says. Then an entity-level LLM pass extracts claims and checks each specific element (technology attached to the right company, numbers, dates, scope words like "all models"); negations and refusals are not claims. `bun run calibrate-verifier` (apps/server) scores it on `src/evals/verifier-calibration.ts`, a set of answers with planted hallucinations, and writes `data/verifier-calibration.json` (served at `GET /api/verifier/calibration`, shown in Evals). Current: precision 0.91, recall 1.00 on 20 planted errors with Claude Haiku 5.5.

## Controls

- **Model selector**: curated cheap, tool-capable models on OpenRouter with live prices; per-message cost under each answer.
- **Reasoning** toggle: sends `reasoning: { effort: "low" }` to OpenRouter and streams the model's reasoning (`delta.reasoning`) into the chat; `reasoning_details` are echoed back on tool-call turns so Anthropic models keep thinking across steps. Off by default (tokens + latency).
- **Speed** (normal / slow): client-side pacing of pipeline events so the animation stays legible; the backend is not slowed down.
- **Piece cards as a trace inspector**: every node, agent and tool card shows its input → output contract and, after a run, the real inputs and outputs that went through it (retrieved chunks with scores, LLM steps with tokens and cost, tool arguments and result previews, verifier claims, follow-ups). Built client-side from the same events that drive the animation.
- **Trace**: raw event log with the server timestamp of each event (milliseconds), so latencies are real even though the animation is paced.
- **Click any node, agent or tool** on the diagram for a card explaining what it is, what it does, how it is built and its live state (`apps/web/src/lib/info.ts`). The expand button opens the diagram full screen with the card and trace beside it.

## Evals: model bake-off

The Evals button opens a **precomputed** report, not a live run. The golden set (`apps/server/src/evals/golden.ts`) has 10 fact
cases (regexes a correct answer must match, derived from `cv.md`), 4 adversarial cases (unknown skill, prompt injection,
off-topic, fabricated premise: the answer must refuse or say "not documented" without inventing) and 4 retrieval cases
(recall@5 of the expected `cv.md` sections in the `retrieval.hits` event). Every case runs through the real pipeline with
the cache off. A judge that is never a candidate (`google/gemini-2.5-flash`, falling back to `openai/gpt-5-mini`) scores each
fact/adversarial answer 1–5 on grounding, specificity, completeness, persuasiveness and concision, as if presenting the
candidate to a recruiter; invented facts cap the overall at 2. Retrieval cases are not judged. The verifier's supported/total ratio is reported too, and the judge's own cost is stored apart from the answer cost (`judgeCostUsd`).

- `bun run bakeoff [model ...]` (in `apps/server`): runs all catalog models (or the given ones), prints the comparison table and
  writes `apps/server/data/evals-report.json` (commit it; it is what the UI shows). The report embeds
  `apps/server/data/verifier-calibration.json` when present.
- `GET /api/evals/report`: the persisted report. `GET /api/evals`: golden set summary.
- `POST /api/evals/run` ({ model }, `?force=1` to bypass the stored result) re-runs one model and merges it into the report.
  When `EVALS_ADMIN_KEY` is set, it requires the `x-admin-key` header; the UI shows the re-run control only after an admin
  key is typed (kept in sessionStorage).

## MCP

The same seven tools and the knowledge base are exposed over the Model Context Protocol (Streamable HTTP, stateless)
at `/mcp`, so an interviewer can connect Claude Desktop, Cursor or any MCP client to the CV. `GET /api/mcp` returns
the connection details.

Claude Desktop (`claude_desktop_config.json`), via the `mcp-remote` bridge:

```json
{ "mcpServers": { "cristhian-cv": { "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:3001/mcp"] } } }
```

Cursor (`.cursor/mcp.json`): `{ "mcpServers": { "cristhian-cv": { "url": "http://localhost:3001/mcp" } } }`.
In production, replace `localhost:3001` with the deployed host (set `PUBLIC_URL` so `/api/mcp` advertises it).
Tools: search_cv, get_experience, get_skills, get_project, get_story, get_contact, get_demo_models. Resource: `cv://knowledge`.
MCP calls share the per-IP rate limit of the chat endpoint.

## Production

The `Dockerfile` builds the web app, downloads the embedding model and embeds the knowledge base at
build time (`apps/server/src/prewarm.ts`), so a fresh container answers its first request in ~2 s.
One process serves the API, the SSE stream, the MCP endpoint and the static web app.

```bash
docker build -t cv-agent .
docker run -p 3001:3001 --env-file .env cv-agent
```

Environment: `OPENROUTER_API_KEY` (required), `PORT` (default 3001), `SITE_URL` (CORS and the
referer sent to OpenRouter), `PUBLIC_URL` (what `/api/mcp` advertises), `EVALS_ADMIN_KEY`
(required to launch bake-offs from the web). Caches, rate limits and the semantic index live in
memory, so run a single replica; nothing needs a volume or a database.

It is deployed on Railway from this repo: every push to `main` rebuilds the image. See [DEPLOY.md](DEPLOY.md).

Drop a `cv.pdf` into `apps/server/public/` to serve it from `/api/cv`; without it, `/api/cv`
renders a generic PDF from `cv.data.ts` with pdf-lib and `/api/cv.md` serves the knowledge base.
