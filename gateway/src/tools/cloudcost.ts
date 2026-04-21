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
