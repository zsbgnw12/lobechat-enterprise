import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { resolveAllowedTools } from '../core/capabilities';
import { callTool } from '../core/gateway';
import { RATE_LIMIT_TOOLS } from '../core/rateLimiter';

// Manifest name uses double-underscore (LobeChat plugin spec disallows dots in `name`).
// Gateway tool keys use dots — we map both ways unambiguously.
// e.g. "ai_search.web" <-> "ai_search__web"
function keyToName(key: string): string {
  return key.replace('.', '__');
}

function nameToKey(name: string): string {
  if (name.includes('.')) return name;
  return name.replace('__', '.');
}

export async function lobechatPluginRoutes(app: FastifyInstance) {
  // Identity-aware manifest.
  // LobeChat (or any agent) fetches this with the caller's X-Dev-User header;
  // only tools the caller can invoke are listed.
  app.get('/api/lobechat/manifest', { preHandler: authenticate }, async (req) => {
    const allowed = await resolveAllowedTools(req.auth!);
    const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'gateway:3001';
    const base = `${proto}://${host}`;
    const api = allowed.map((t) => ({
      url: `${base}/api/lobechat/tool-gateway`,
      name: keyToName(t.key),
      description: t.description || t.displayName,
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    }));
    return {
      $schema: 'https://chat-plugins.lobehub.com/schema/plugin.json',
      identifier: 'enterprise-gateway',
      version: '1',
      api,
      meta: {
        avatar: '🏢',
        tags: ['enterprise', 'gateway'],
        title: 'Enterprise Gateway',
        description:
          'Identity-aware bridge to Enterprise Gateway tools. The set of exposed APIs is filtered per-caller.',
      },
      systemRole:
        'These tools are routed through an Enterprise Gateway that enforces RBAC, identity-map, data-scope, and field-masking. A 403 means the caller is not authorized; do not retry.',
    };
  });

  // LobeChat calls this with { arguments: { ... } } (OpenAI-style tool-call body)
  // for a specific plugin `name`. We re-map to gateway tool key and delegate
  // to the same pipeline used by /api/tools/call, preserving audit/filter/mask.
  app.post('/api/lobechat/tool-gateway', { preHandler: authenticate, config: RATE_LIMIT_TOOLS }, async (req, reply) => {
    const body = (req.body as any) ?? {};
    // Accept either LobeChat's OpenAI-plugin shape ({ name, arguments }) or
    // a simpler passthrough ({ tool, params }).
    const rawName: string | undefined = body.name || body.tool;
    let params: any = body.params ?? body.arguments ?? {};
    if (typeof params === 'string') {
      try {
        params = JSON.parse(params);
      } catch {
        // leave as-is; adapter zod will reject
      }
    }
    if (!rawName || typeof rawName !== 'string') {
      reply.code(400).send({ error: 'name (or tool) is required' });
      return;
    }
    const toolKey = rawName.includes('.') ? rawName : nameToKey(rawName);
    const r = await callTool({ auth: req.auth!, tool: toolKey, params });
    if (!r.ok) {
      reply.code(r.status).send({ error: r.error, detail: r.detail });
      return;
    }
    return r.result;
  });
}
