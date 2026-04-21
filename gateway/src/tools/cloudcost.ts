import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';
import { getM2MToken } from '../auth/casdoorM2M';

const ACCOUNTS_MOCK = [
  { id: 'SA-001', name: 'prod-east', region: 'CN-EAST', cost: 4250.75, owner_department_id: 'ops' },
  { id: 'SA-002', name: 'dev-north', region: 'CN-NORTH', cost: 980.1, owner_department_id: 'ops' },
  { id: 'SA-003', name: 'analytics', region: 'CN-EAST', cost: 6700.0, owner_department_id: 'ops' },
];

// Resolve an Authorization header for the cloudcost API.
// Priority: M2M client_credentials (if configured) > static bearer (legacy).
async function ccAuthHeader(): Promise<string> {
  if (env.CLOUDCOST_M2M_CLIENT_ID && env.CLOUDCOST_M2M_CLIENT_SECRET && env.CASDOOR_URL) {
    const token = await getM2MToken({
      casdoorUrl: env.CASDOOR_URL,
      clientId: env.CLOUDCOST_M2M_CLIENT_ID,
      clientSecret: env.CLOUDCOST_M2M_CLIENT_SECRET,
      scope: env.CLOUDCOST_M2M_SCOPE || undefined,
    });
    return `Bearer ${token}`;
  }
  if (env.CLOUDCOST_BEARER) return `Bearer ${env.CLOUDCOST_BEARER}`;
  throw new Error('cloudcost_missing_credentials');
}

async function ccFetch(path: string): Promise<any> {
  if (isMock('cloudcost') || !env.CLOUDCOST_API_URL) return null;
  const authorization = await ccAuthHeader();
  return httpJson(`${env.CLOUDCOST_API_URL}${path}`, {
    headers: { authorization },
  });
}

function defaultMonth(): string {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}`;
}

function defaultDateRange(): { start_date: string; end_date: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start_date: iso(start), end_date: iso(end) };
}

registerTool({
  key: 'cloudcost.get_overview',
  sourceSystem: 'cloudcost',
  entityType: 'service_account',
  inputSchema: z.object({ month: z.string().optional() }).passthrough(),
  async run(_ctx, params) {
    const month = (params && (params as any).month) || defaultMonth();
    const real = await ccFetch(`/api/dashboard/overview?month=${encodeURIComponent(month)}`);
    if (real) return real;
    return ACCOUNTS_MOCK;
  },
});

registerTool({
  key: 'cloudcost.get_daily_report',
  sourceSystem: 'cloudcost',
  entityType: 'service_account',
  inputSchema: z
    .object({
      date: z.string().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    })
    .passthrough(),
  async run(_ctx, params) {
    const p: any = params || {};
    let start = p.start_date as string | undefined;
    let end = p.end_date as string | undefined;
    if (!start || !end) {
      if (p.date) {
        start = p.date;
        end = p.date;
      } else {
        const r = defaultDateRange();
        start = r.start_date;
        end = r.end_date;
      }
    }
    const qs = `start_date=${encodeURIComponent(start!)}&end_date=${encodeURIComponent(end!)}`;
    const real = await ccFetch(`/api/service-accounts/daily-report?${qs}`);
    if (real) return real;
    return ACCOUNTS_MOCK.map((a) => ({ ...a, date: p.date || start }));
  },
});

// ---------------------------------------------------------------------------
// cloudcost.get_billing_detail — 对接 AI-BRAIN-API.md §4.10 `/api/billing/detail`
//
// 设计说明：
//   - 账单明细的记录身份是 (data_source_id, project_id, date, product)，
//     没有稳定的 service_account_id，不适合走 identity_map 过滤。
//     上游 cloudcost 本身已按 `UserCloudAccountGrant` 做了数据源级权限，
//     网关这里 applyFilter=false，改由上游 token (M2M) 决定可见数据源。
//   - `cost` / `usage_quantity` 在此接口返回 **JSON string** (Decimal)，
//     不做 float 转换——前端 / 模型自己按需 parseFloat，避免精度丢失。
//   - 敏感金额 `cost` 的脱敏交给 field_policy (cloudcost/billing_row.cost)。
// ---------------------------------------------------------------------------

const BILLING_MOCK = [
  {
    id: 1,
    date: '2026-04-18',
    provider: 'azure',
    data_source_id: 2,
    project_id: 'prj-demo-001',
    project_name: '(mock) Demo Project',
    product: 'API Management',
    usage_type: 'Consumption Calls',
    region: 'southeastasia',
    cost: '0.000000',
    usage_quantity: '0.083300',
    usage_unit: '10K',
    currency: 'USD',
  },
  {
    id: 2,
    date: '2026-04-18',
    provider: 'gcp',
    data_source_id: 3,
    project_id: 'prj-demo-002',
    project_name: '(mock) Demo Project 2',
    product: 'Compute Engine',
    usage_type: 'N1 Standard',
    region: 'asia-east1',
    cost: '12.345600',
    usage_quantity: '24.000000',
    usage_unit: 'hour',
    currency: 'USD',
  },
];

registerTool({
  key: 'cloudcost.get_billing_detail',
  sourceSystem: 'cloudcost',
  entityType: 'billing_row',
  applyFilter: false, // 上游已按 data_source 授权过滤；网关只做脱敏
  inputSchema: z
    .object({
      date_start: z.string().optional(),
      date_end: z.string().optional(),
      provider: z.string().optional(),
      project_id: z.string().optional(),
      product: z.string().optional(),
      page: z.number().int().min(1).optional(),
      page_size: z.number().int().min(1).max(500).optional(),
    })
    .passthrough(),
  async run(_ctx, params) {
    const p: any = params || {};
    if (!p.date_start || !p.date_end) {
      const r = defaultDateRange();
      p.date_start = p.date_start || r.start_date;
      p.date_end = p.date_end || r.end_date;
    }
    const qp = new URLSearchParams();
    qp.set('date_start', p.date_start);
    qp.set('date_end', p.date_end);
    if (p.provider) qp.set('provider', String(p.provider));
    if (p.project_id) qp.set('project_id', String(p.project_id));
    if (p.product) qp.set('product', String(p.product));
    qp.set('page', String(p.page ?? 1));
    qp.set('page_size', String(p.page_size ?? 50));
    const real = await ccFetch(`/api/billing/detail?${qp.toString()}`);
    if (real) return real;
    return BILLING_MOCK;
  },
});
