// Prometheus metrics (Workstream F).
//
// Exposes a single Registry with default process metrics plus gateway-specific
// counters/histograms/gauges. `GET /metrics` renders the standard
// "text/plain; version=0.0.4" exposition.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const promClient = require('prom-client');

export const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

export const toolCallTotal = new promClient.Counter({
  name: 'gateway_tool_call_total',
  help: 'Count of gateway tool calls by outcome',
  labelNames: ['tool', 'outcome'] as const,
  registers: [register],
});

export const toolCallDuration = new promClient.Histogram({
  name: 'gateway_tool_call_duration_ms',
  help: 'Gateway tool-call duration in milliseconds',
  labelNames: ['tool', 'outcome'] as const,
  buckets: [10, 50, 100, 300, 1000, 3000, 10000],
  registers: [register],
});

export const auditQueueDepth = new promClient.Gauge({
  name: 'gateway_audit_queue_depth',
  help: 'Pending audit jobs (wait + active) on BullMQ audit-writes queue',
  registers: [register],
});

export const identityMapMissing = new promClient.Counter({
  name: 'gateway_identity_map_missing_total',
  help: 'Count of rows dropped because of missing identity-map entries',
  labelNames: ['source_system', 'entity_type'] as const,
  registers: [register],
});

export const cacheHits = new promClient.Counter({
  name: 'gateway_cache_hits_total',
  help: 'Cache-hit count by logical cache name',
  labelNames: ['cache'] as const,
  registers: [register],
});

export const cacheMisses = new promClient.Counter({
  name: 'gateway_cache_misses_total',
  help: 'Cache-miss count by logical cache name',
  labelNames: ['cache'] as const,
  registers: [register],
});

export async function renderMetrics(): Promise<string> {
  return register.metrics();
}

export function metricsContentType(): string {
  return register.contentType || 'text/plain; version=0.0.4; charset=utf-8';
}
