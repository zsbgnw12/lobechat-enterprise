import { AuthContext } from '../auth/devAuth';
import { resolveAllowedTools } from './capabilities';
import { filterByIdentityMap } from './filter';
import { applyFieldPolicies } from './masking';
import { enqueueAudit } from './auditQueue';
import { getTool } from '../tools/registry';
import { toolCallTotal, toolCallDuration } from './metrics';

function record(tool: string, outcome: 'ok' | 'denied' | 'error', startMs: number) {
  const ms = Date.now() - startMs;
  try {
    toolCallTotal.inc({ tool, outcome });
    toolCallDuration.observe({ tool, outcome }, ms);
  } catch {
    // metrics must never break the request path
  }
}

export interface GatewayCallInput {
  auth: AuthContext;
  tool: string;
  params: any;
}

export interface GatewayResult {
  data: any;
  meta: {
    filtered_count: number;
    dropped_count: number;
    missing_identity_map_count: number;
    masked_fields: string[];
    audit_ok: boolean;
  };
}

export async function callTool(input: GatewayCallInput): Promise<
  | { ok: true; result: GatewayResult }
  | { ok: false; status: number; error: string; detail?: any }
> {
  const { auth, tool, params } = input;
  const t0 = Date.now();

  // Guardrail: explicitly reject admin.* namespace from chat path.
  if (tool.startsWith('admin.')) {
    await enqueueAudit({
      auth,
      toolKey: tool,
      action: 'deny',
      outcome: 'denied',
      request: { params },
      meta: { reason: 'admin_namespace_forbidden_in_tools_call' },
    });
    record(tool, 'denied', t0);
    return { ok: false, status: 403, error: 'admin tools cannot be invoked via /api/tools/call' };
  }

  const allowed = await resolveAllowedTools(auth);
  const allowedKeys = new Set(allowed.map((t) => t.key));
  if (!allowedKeys.has(tool)) {
    await enqueueAudit({
      auth,
      toolKey: tool,
      action: 'deny',
      outcome: 'denied',
      request: { params },
    });
    record(tool, 'denied', t0);
    return { ok: false, status: 403, error: `tool not allowed: ${tool}` };
  }

  const adapter = getTool(tool);
  if (!adapter) {
    await enqueueAudit({
      auth,
      toolKey: tool,
      action: 'call',
      outcome: 'error',
      request: { params },
      meta: { reason: 'adapter_missing' },
    });
    record(tool, 'error', t0);
    return { ok: false, status: 404, error: `no adapter for tool: ${tool}` };
  }

  // Validate params
  const parsed = adapter.inputSchema.safeParse(params ?? {});
  if (!parsed.success) {
    await enqueueAudit({
      auth,
      toolKey: tool,
      action: 'call',
      outcome: 'error',
      request: { params },
      meta: { reason: 'invalid_params', issues: parsed.error.issues },
    });
    record(tool, 'error', t0);
    return { ok: false, status: 400, error: 'invalid params', detail: parsed.error.issues };
  }

  let rawItems: any[] = [];
  try {
    rawItems = await adapter.run({ auth }, parsed.data);
  } catch (e: any) {
    await enqueueAudit({
      auth,
      toolKey: tool,
      action: 'call',
      outcome: 'error',
      request: { params },
      meta: { reason: 'adapter_exception', error: String(e?.message || e) },
    });
    record(tool, 'error', t0);
    return { ok: false, status: 502, error: 'adapter error', detail: String(e?.message || e) };
  }

  const isArrayReturn = Array.isArray(rawItems);
  const items = isArrayReturn ? rawItems : [rawItems];

  let filterMeta = {
    filtered_count: items.length,
    dropped_count: 0,
    missing_identity_map_count: 0,
    missing_identity_map_ids: [] as string[],
  };
  let kept = items;
  const idField = adapter.idField || 'id';

  if (adapter.applyFilter !== false && adapter.sourceSystem && adapter.entityType) {
    const res = await filterByIdentityMap(
      items,
      adapter.sourceSystem,
      adapter.entityType,
      auth,
      idField as any,
    );
    kept = res.kept;
    filterMeta = {
      filtered_count: res.kept.length,
      dropped_count: res.droppedCount,
      missing_identity_map_count: res.missingIdentityMapCount,
      missing_identity_map_ids: res.missingIdentityMapIds,
    };
    if (res.missingIdentityMapCount > 0) {
      await enqueueAudit({
        auth,
        toolKey: tool,
        action: 'missing_identity_map',
        outcome: 'ok',
        meta: { ids: res.missingIdentityMapIds, source: adapter.sourceSystem, entity: adapter.entityType },
      });
    }
  }

  // Apply field policies (always; covers wildcard apiKey/secret too)
  const sourceForMask = adapter.sourceSystem || '*';
  const entityForMask = adapter.entityType || '*';
  const maskRes = await applyFieldPolicies(kept, sourceForMask, entityForMask, auth.roleKeys);

  const auditOk = await enqueueAudit({
    auth,
    toolKey: tool,
    action: 'call',
    outcome: 'ok',
    request: { params: parsed.data },
    responseSummary: {
      filtered_count: filterMeta.filtered_count,
      dropped_count: filterMeta.dropped_count,
      missing_identity_map_count: filterMeta.missing_identity_map_count,
      masked_fields: maskRes.maskedFields,
    },
  });

  const data = isArrayReturn ? kept : kept[0] ?? null;
  record(tool, 'ok', t0);
  return {
    ok: true,
    result: {
      data,
      meta: {
        filtered_count: filterMeta.filtered_count,
        dropped_count: filterMeta.dropped_count,
        missing_identity_map_count: filterMeta.missing_identity_map_count,
        masked_fields: maskRes.maskedFields,
        audit_ok: auditOk,
      },
    },
  };
}
