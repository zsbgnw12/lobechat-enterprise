import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';

const CUSTOMERS_MOCK = [
  { id: 'CUST-0001', name: 'Acme Corp', region: 'CN-EAST', sales_user_id: 'USR-SALES1', current_month_consumption: 12450.5 },
  { id: 'CUST-0002', name: 'Globex', region: 'CN-NORTH', sales_user_id: 'USR-SALES2', current_month_consumption: 8900.0 },
  { id: 'CUST-0003', name: 'Initech', region: 'CN-EAST', sales_user_id: 'USR-SALES1', current_month_consumption: 3320.25 },
  { id: 'CUST-0004', name: 'Umbrella', region: 'CN-SOUTH', sales_user_id: 'USR-SALES3', current_month_consumption: 22100.0 },
  { id: 'CUST-0005', name: 'Hooli', region: 'CN-WEST', sales_user_id: 'USR-SALES1', current_month_consumption: 5000.0 },
];

async function opsFetch(path: string, method: string, body?: any): Promise<any> {
  if (isMock('xiaoshou') || !env.SUPER_OPS_API_URL) return null;
  return httpJson(`${env.SUPER_OPS_API_URL}${path}`, {
    method,
    headers: { 'X-Api-Key': env.SUPER_OPS_API_KEY },
    body,
  });
}

registerTool({
  key: 'xiaoshou.search_customers',
  sourceSystem: 'xiaoshou',
  entityType: 'customer',
  inputSchema: z.object({ page: z.number().int().min(1).optional(), page_size: z.number().int().min(1).max(500).optional() }),
  async run(_ctx, params) {
    const page = params.page ?? 1;
    const page_size = params.page_size ?? 20;
    const real = await opsFetch(`/customers?page=${page}&page_size=${page_size}`, 'GET');
    if (real) return real;
    return CUSTOMERS_MOCK;
  },
});

registerTool({
  key: 'xiaoshou.get_customer',
  sourceSystem: 'xiaoshou',
  entityType: 'customer',
  inputSchema: z.object({ id: z.string() }),
  async run(_ctx, params) {
    const real = await opsFetch(`/customers/${params.id}`, 'GET');
    if (real) return real;
    const c = CUSTOMERS_MOCK.find((x) => x.id === params.id);
    return c ? [c] : [];
  },
});

registerTool({
  key: 'xiaoshou.get_customer_insight',
  sourceSystem: 'xiaoshou',
  entityType: 'customer',
  inputSchema: z.object({ id: z.string() }),
  async run(_ctx, params) {
    const real = await opsFetch(`/customers/${params.id}/insight`, 'GET');
    if (real) return real;
    const c = CUSTOMERS_MOCK.find((x) => x.id === params.id);
    if (!c) return [];
    return [{ ...c, insight: { risk: 'low', renewal_probability: 0.87 } }];
  },
});

registerTool({
  key: 'xiaoshou.get_allocations',
  sourceSystem: 'xiaoshou',
  entityType: 'customer',
  inputSchema: z.object({}).passthrough(),
  async run(_ctx) {
    const real = await opsFetch(`/allocations`, 'GET');
    if (real) return real;
    return CUSTOMERS_MOCK.map((c) => ({ id: c.id, sales_user_id: c.sales_user_id, allocation: 'primary' }));
  },
});
