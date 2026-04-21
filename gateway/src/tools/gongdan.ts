import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';

const TICKET_MOCK = [
  { id: 'T-001', title: 'Login fails intermittently', status: 'open', contactInfo: 'alice@example.com', customer_id: 'CUST-0001', owner_user_id: 'USR-CUST1' },
  { id: 'T-002', title: 'Increase storage quota', status: 'in_progress', contactInfo: 'bob@corp.com', customer_id: 'CUST-0002', owner_user_id: 'USR-OPS1' },
  { id: 'T-003', title: 'GPU node reboot', status: 'open', contactInfo: 'carol@corp.com', customer_id: 'CUST-0001', owner_user_id: 'USR-TECH1' },
  { id: 'T-004', title: 'API 500 error', status: 'resolved', contactInfo: 'dave@corp.com', customer_id: 'CUST-0003', owner_user_id: 'USR-OPS1' },
  { id: 'T-005', title: 'Billing discrepancy', status: 'open', contactInfo: 'erin@corp.com', customer_id: 'CUST-0002', owner_user_id: 'USR-SALES1' },
  { id: 'T-006', title: 'Access request', status: 'open', contactInfo: 'frank@corp.com', customer_id: 'CUST-0001', owner_user_id: 'USR-CUST1' },
  // T-900 intentionally has NO identity_map entry (missing-mapping case)
  { id: 'T-900', title: 'Orphan ticket', status: 'open', contactInfo: 'ghost@example.com', customer_id: 'CUST-XXXX', owner_user_id: 'USR-UNKNOWN', apiKey: 'sk-leak-leak' },
];

async function gongdanFetch(path: string, method: string, body?: any): Promise<any> {
  if (isMock('gongdan') || !env.GONGDAN_API_URL) return null;
  return httpJson(`${env.GONGDAN_API_URL}${path}`, {
    method,
    headers: { 'X-Api-Key': env.GONGDAN_API_KEY },
    body,
  });
}

registerTool({
  key: 'gongdan.create_ticket',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  applyFilter: false,
  inputSchema: z.object({
    title: z.string().optional(),
    description: z.string(),
    customer_id: z.string().optional(),
    platform: z.string().optional(),
    accountInfo: z.string().optional(),
    modelUsed: z.string().optional(),
    requestExample: z.string().optional(),
  }).passthrough(),
  async run({ auth }, params) {
    const isCustomer = Array.isArray(auth.roleKeys) && auth.roleKeys.includes('customer');
    const customerMockOverride = (process.env.GONGDAN_CUSTOMER_MOCK || '').toLowerCase() === 'true';
    const forceMock = isCustomer && customerMockOverride;

    // Fill reasonable defaults for real-upstream writes.
    const enriched = {
      title: params.title || params.description?.slice(0, 80) || 'Untitled',
      description: params.description,
      platform: params.platform || 'taiji',
      accountInfo: params.accountInfo || auth.username,
      modelUsed: params.modelUsed || 'unknown',
      requestExample: params.requestExample || 'n/a',
      customer_id: params.customer_id,
    };

    if (!forceMock) {
      const real = await gongdanFetch('/api/tickets', 'POST', enriched);
      if (real) return real;
    }
    // Mock path — for customers return a ticket tied to their identity_map customer_id if resolvable.
    const mockCustomerId = isCustomer
      ? (params.customer_id || auth.customerId || 'CUST-0001')
      : (params.customer_id || 'CUST-MOCK');
    return {
      id: `T-${Date.now().toString().slice(-6)}`,
      title: enriched.title,
      description: enriched.description,
      status: 'open',
      created_by: auth.username,
      customerId: mockCustomerId,
      customer_id: mockCustomerId,
      platform: enriched.platform,
    };
  },
});

registerTool({
  key: 'gongdan.get_own_tickets',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({}).passthrough(),
  async run(_ctx) {
    const real = await gongdanFetch('/api/tickets/own', 'GET');
    if (real) return real;
    return TICKET_MOCK;
  },
});

registerTool({
  key: 'gongdan.search_tickets',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  async run(_ctx, params) {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.status) qs.set('status', params.status);
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    const real = await gongdanFetch(`/api/tickets?${qs.toString()}`, 'GET');
    if (real) {
      // Upstream may return {items:[]}, {data:[]}, {tickets:[]} or a bare array.
      if (Array.isArray(real)) return real;
      return real.items ?? real.data ?? real.tickets ?? [];
    }
    return TICKET_MOCK.filter((t) => !params.status || t.status === params.status);
  },
});

registerTool({
  key: 'gongdan.get_ticket',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({ id: z.string() }),
  async run(_ctx, params) {
    const real = await gongdanFetch(`/api/tickets/${params.id}`, 'GET');
    if (real) return real;
    const t = TICKET_MOCK.find((x) => x.id === params.id);
    if (!t) return [];
    return [t];
  },
});

registerTool({
  key: 'gongdan.update_ticket',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({ ticketId: z.string(), status: z.string() }),
  async run(_ctx, params) {
    const real = await gongdanFetch(`/api/tickets/${params.ticketId}/status`, 'PUT', { status: params.status });
    if (real) return real;
    const t = TICKET_MOCK.find((x) => x.id === params.ticketId);
    if (!t) return { id: params.ticketId, status: params.status, updated: true };
    return { ...t, status: params.status, updated: true };
  },
});

registerTool({
  key: 'gongdan.assign_ticket',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({ ticketId: z.string(), engineerId: z.string() }),
  async run(_ctx, params) {
    const real = await gongdanFetch(`/api/tickets/${params.ticketId}/assign`, 'PUT', { engineerId: params.engineerId });
    if (real) return real;
    const t = TICKET_MOCK.find((x) => x.id === params.ticketId);
    if (!t) return { id: params.ticketId, engineerId: params.engineerId, assigned: true };
    return { ...t, owner_user_id: params.engineerId, assigned: true };
  },
});

registerTool({
  key: 'gongdan.close_ticket',
  sourceSystem: 'gongdan',
  entityType: 'ticket',
  inputSchema: z.object({ ticketId: z.string() }),
  async run(_ctx, params) {
    const real = await gongdanFetch(`/api/tickets/${params.ticketId}/customer-close`, 'PUT');
    if (real) return real;
    const t = TICKET_MOCK.find((x) => x.id === params.ticketId);
    if (!t) return { id: params.ticketId, status: 'closed', closed: true };
    return { ...t, status: 'closed', closed: true };
  },
});
