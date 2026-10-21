import { Hono } from 'hono'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { config } from './config.ts'
import { checkRateLimit } from './rateLimit.ts'
import { executeTool, toolDefinitions } from './agent/tools.ts'
import { loadKnowledgeMarkdown } from './rag/store.ts'
import { projects, stories } from './knowledge/cv.data.ts'

/**
 * Model Context Protocol server: the same seven tools the chat agent uses, plus the knowledge base as a resource,
 * over Streamable HTTP. Stateless: a fresh transport per request, so any MCP client (Claude Desktop via mcp-remote,
 * Cursor, custom clients) can connect without session bookkeeping.
 */

// Hand-written zod shapes mirroring the JSON-schema parameters in agent/tools.ts.
const shapes: Record<string, z.ZodRawShape> = {
  search_cv: { query: z.string().describe('Search query in English') },
  get_experience: { company: z.string().optional().describe('Optional company name filter, e.g. "AiKit", "Walmart", "SmartCoach"') },
  get_skills: { group: z.string().optional().describe('Optional group filter: "LLM engineering", "Backend", "Frontend", "Infra & ops", "Security & quality"') },
  get_project: { key: z.enum(projects.map(p => p.key) as [string, ...string[]]).describe('Project key') },
  get_story: { key: z.enum(stories.map(s => s.key) as [string, ...string[]]).describe('Story key') },
  get_contact: {},
  get_demo_models: {},
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'cristhian-cv', version: '0.1.0' })
  for (const def of toolDefinitions) {
    const { name, description } = def.function
    server.registerTool(name, { description, inputSchema: shapes[name] ?? {} }, async (args: Record<string, unknown>) => {
      console.log(`[mcp] tool ${name} ${JSON.stringify(args ?? {})}`)
      const out = await executeTool(name, args ?? {})
      return { content: [{ type: 'text', text: JSON.stringify(out.result, null, 1) }] }
    })
  }
  server.registerResource('cv-knowledge', 'cv://knowledge', { title: "Cristhian Marroquin's CV", description: 'Public career knowledge base (markdown) used by the CV agent', mimeType: 'text/markdown' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await loadKnowledgeMarkdown() }],
  }))
  return server
}

export const mcpRoutes = new Hono()
  .all('/', async c => {
    if (c.req.method === 'POST') {
      const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local'
      const rl = checkRateLimit(ip)
      if (!rl.ok) return c.json({ jsonrpc: '2.0', error: { code: -32000, message: rl.reason }, id: null }, 429, { 'Retry-After': String(rl.retryAfterSec) })
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = buildServer()
    await server.connect(transport)
    // Stateless: the response body is streamed after this returns, so the transport is left to the GC rather than closed here.
    return transport.handleRequest(c.req.raw)
  })

export function mcpInfo(baseUrl: string) {
  const url = `${baseUrl}/mcp`
  return {
    name: 'cristhian-cv',
    transport: 'streamable-http',
    url,
    tools: toolDefinitions.map(t => t.function.name),
    resources: ['cv://knowledge'],
    claudeDesktop: { mcpServers: { 'cristhian-cv': { command: 'npx', args: ['-y', 'mcp-remote', url] } } },
    cursor: { mcpServers: { 'cristhian-cv': { url } } },
  }
}

export const mcpBaseUrl = () => process.env.PUBLIC_URL ?? `http://localhost:${config.port}`
