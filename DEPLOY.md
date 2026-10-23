# Deploying

The site runs on Railway (Hobby plan) as a single container built from the `Dockerfile` in this
repo. The service is connected to GitHub, so **deploying a change is a push to `main`**.

```bash
git add -A
git commit -m "describe the change"
git push
```

Railway then builds the image, runs the health check on `/api/health` and swaps the container
with no downtime. A build takes about 2–3 minutes.

Auto-deploy on push only works while the **Railway GitHub App** is installed on the GitHub account
with access to this repo (Railway dashboard → Account settings → Integrations → GitHub, or
https://github.com/apps/railway-app/installations/new). Without it the repo connection exists but
pushes do nothing: check with `railway deployment list`, and deploy by hand with `railway up`.

## What the build does

1. `bun install --frozen-lockfile` for the three workspaces.
2. `bun run build` — Vite build of the web app into `apps/web/dist`, served by the server process.
3. `bun apps/server/src/prewarm.ts` — downloads the embedding model and embeds `cv.md` into
   `.cache`, so a fresh container answers its first request in ~2 s. Editing the knowledge base is
   therefore just a push: the index is rebuilt at build time.
4. `bun apps/server/src/index.ts` — one process for the API, the SSE stream, `/mcp` and the static
   web app.

`railway.json` declares the Dockerfile builder, the health check path and the restart policy.
(Railway calls this format deprecated in favour of `.railway/railway.ts`; it keeps working until
2026-12-01, after which run `railway config migrate`.)

## Watching a deploy

From the repo folder (the directory is linked to the Railway project):

```bash
railway deployment list   # BUILDING → DEPLOYING → SUCCESS
railway logs --build      # build output
railway logs              # live server logs
railway open              # dashboard in the browser
```

## Environment variables

Variables are not in git. Change them with the CLI (this also triggers a redeploy):

```bash
railway variable set KEY=value
railway variable list
```

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | The only required one. |
| `SITE_URL` | CORS origin and the referer sent to OpenRouter. |
| `PUBLIC_URL` | What `/api/mcp` advertises to MCP clients. |
| `EVALS_ADMIN_KEY` | Required to launch a bake-off from the web UI. |
| `PORT` | Injected by Railway; defaults to 3001 locally. |

## Operational notes

- Run **one replica**: response cache, semantic index and rate limits live in memory.
- Nothing needs a volume or a database. `evals-report.json` and the verifier calibration are
  committed; the embedding cache is rebuilt at build time.
- Re-run `bun run bakeoff` locally after large edits to `cv.md`, then commit the report.
- To deploy the local folder without going through GitHub: `railway up`.
- Test the image locally before pushing a Dockerfile change:

```bash
docker build -t cv-agent .
docker run -p 3001:3001 --env-file .env cv-agent
curl localhost:3001/api/health
```

## First-time setup (already done)

```bash
railway login
railway init --name cv-agent
railway add --service cv-agent
railway variable set OPENROUTER_API_KEY=... EVALS_ADMIN_KEY=... --skip-deploys
railway domain                                   # generates *.up.railway.app
railway variable set SITE_URL=https://... PUBLIC_URL=https://... --skip-deploys
railway service source connect --repo cristhianmarroquinse/cv-agent --branch main
```

A custom domain is `railway domain cv.example.com`; the command prints the CNAME to add.
Drop a `cv.pdf` into `apps/server/public/` to serve the real PDF from `/api/cv`.
