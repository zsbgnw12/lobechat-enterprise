import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES = [
  { key: 'super_admin', name: 'Super Admin', description: 'full access' },
  { key: 'permission_admin', name: 'Permission Admin', description: 'manages permissions' },
  { key: 'internal_sales', name: 'Internal Sales' },
  { key: 'internal_ops', name: 'Internal Ops' },
  { key: 'internal_tech', name: 'Internal Tech' },
  { key: 'customer', name: 'Customer' },
];

const TOOLS = [
  // gongdan — 7 per the spec
  { key: 'gongdan.create_ticket', category: 'gongdan', display_name: 'Create Ticket' },
  { key: 'gongdan.get_own_tickets', category: 'gongdan', display_name: 'Get My Tickets' },
  { key: 'gongdan.search_tickets', category: 'gongdan', display_name: 'Search Tickets' },
  { key: 'gongdan.get_ticket', category: 'gongdan', display_name: 'Get Ticket' },
  { key: 'gongdan.update_ticket', category: 'gongdan', display_name: 'Update Ticket' },
  { key: 'gongdan.assign_ticket', category: 'gongdan', display_name: 'Assign Ticket' },
  { key: 'gongdan.close_ticket', category: 'gongdan', display_name: 'Close Ticket' },
  // xiaoshou — 4
  { key: 'xiaoshou.search_customers', category: 'xiaoshou', display_name: 'Search Customers' },
  { key: 'xiaoshou.get_customer', category: 'xiaoshou', display_name: 'Get Customer' },
  { key: 'xiaoshou.get_customer_insight', category: 'xiaoshou', display_name: 'Customer Insight' },
  { key: 'xiaoshou.get_allocations', category: 'xiaoshou', display_name: 'Allocations' },
  // cloudcost — 2
  { key: 'cloudcost.get_overview', category: 'cloudcost', display_name: 'Cloud Overview' },
  { key: 'cloudcost.get_daily_report', category: 'cloudcost', display_name: 'Daily Report' },
  // kb, ai_search, sandbox, doc — 1 each
  { key: 'kb.search', category: 'kb', display_name: 'KB Search' },
  { key: 'ai_search.web', category: 'ai_search', display_name: 'Web Search' },
  { key: 'sandbox.run', category: 'sandbox', display_name: 'Run in Sandbox' },
  { key: 'doc.generate', category: 'doc', display_name: 'Generate Doc' },
];

// Hand-written JSON Schemas for each registered tool.
// Kept aligned with zod schemas in gateway/src/tools/*.ts.
const TOOL_INPUT_SCHEMAS: Record<string, object> = {
  'gongdan.create_ticket': {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      customer_id: { type: 'string' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  'gongdan.get_own_tickets': {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
  'gongdan.search_tickets': {
    type: 'object',
    properties: {
      status: { type: 'string' },
      customer_id: { type: 'string' },
      owner_user_id: { type: 'string' },
      q: { type: 'string' },
      page: { type: 'integer', minimum: 1 },
      page_size: { type: 'integer', minimum: 1, maximum: 500 },
    },
    additionalProperties: true,
  },
  'gongdan.get_ticket': {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  'gongdan.update_ticket': {
    type: 'object',
    properties: {
      ticketId: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['ticketId', 'status'],
    additionalProperties: false,
  },
  'gongdan.assign_ticket': {
    type: 'object',
    properties: {
      ticketId: { type: 'string' },
      engineerId: { type: 'string' },
    },
    required: ['ticketId', 'engineerId'],
    additionalProperties: false,
  },
  'gongdan.close_ticket': {
    type: 'object',
    properties: { ticketId: { type: 'string' } },
    required: ['ticketId'],
    additionalProperties: false,
  },
  'xiaoshou.search_customers': {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1 },
      page_size: { type: 'integer', minimum: 1, maximum: 500 },
    },
    additionalProperties: false,
  },
  'xiaoshou.get_customer': {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  'xiaoshou.get_customer_insight': {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  'xiaoshou.get_allocations': {
    type: 'object',
    properties: {},
    additionalProperties: true,
  },
  'cloudcost.get_overview': {
    type: 'object',
    properties: { month: { type: 'string' } },
    additionalProperties: true,
  },
  'cloudcost.get_daily_report': {
    type: 'object',
    properties: {
      date: { type: 'string' },
      service_account_id: { type: 'string' },
    },
    additionalProperties: true,
  },
  'kb.search': {
    type: 'object',
    properties: {
      query: { type: 'string' },
      top: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  'ai_search.web': {
    type: 'object',
    properties: {
      query: { type: 'string' },
      top: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  'sandbox.run': {
    type: 'object',
    properties: {
      code: { type: 'string' },
      language: { type: 'string' },
    },
    required: ['code'],
    additionalProperties: false,
  },
  'doc.generate': {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      topic: { type: 'string' },
      format: { type: 'string' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
};

const ROLE_TOOL_GRANTS: Record<string, string[]> = {
  super_admin: TOOLS.map((t) => t.key),
  permission_admin: [], // intentionally NO tool grants — admin APIs only
  internal_sales: [
    'xiaoshou.search_customers',
    'xiaoshou.get_customer',
    'xiaoshou.get_customer_insight',
    'xiaoshou.get_allocations',
    'kb.search',
    'ai_search.web',
    'doc.generate',
  ],
  internal_ops: [
    'gongdan.create_ticket',
    'gongdan.get_own_tickets',
    'gongdan.search_tickets',
    'gongdan.get_ticket',
    'gongdan.update_ticket',
    'gongdan.assign_ticket',
    'gongdan.close_ticket',
    'cloudcost.get_overview',
    'cloudcost.get_daily_report',
    'kb.search',
    'ai_search.web',
    'doc.generate',
  ],
  internal_tech: [
    'gongdan.get_own_tickets',
    'gongdan.search_tickets',
    'gongdan.get_ticket',
    'gongdan.update_ticket',
    'kb.search',
    'ai_search.web',
    'sandbox.run',
  ],
  customer: ['gongdan.create_ticket', 'gongdan.get_own_tickets', 'kb.search'],
};

async function ensureToolInputSchemas() {
  for (const [key, schema] of Object.entries(TOOL_INPUT_SCHEMAS)) {
    try {
      await prisma.enterpriseToolRegistry.update({
        where: { key },
        data: { inputSchema: schema as any },
      });
    } catch {
      // tool not yet present; skip silently
    }
  }
  console.log('[seed] tool input_schema upsert complete');
}

async function ensureSystemDiscoverer() {
  const superRole = await prisma.enterpriseRole.findUnique({ where: { key: 'super_admin' } });
  if (!superRole) return;
  const existing = await prisma.enterpriseUser.findUnique({ where: { username: 'system-discoverer' } });
  if (existing) return;
  const u = await prisma.enterpriseUser.create({
    data: {
      username: 'system-discoverer',
      displayName: 'System Discoverer',
      email: 'system-discoverer@eg.local',
      metadata: { system: true },
    },
  });
  await prisma.enterpriseUserRole.create({ data: { userId: u.id, roleId: superRole.id } });
  console.log('[seed] system-discoverer ensured');
}

async function main() {
  // Already seeded? still top-up idempotent additions.
  const existing = await prisma.enterpriseUser.count();
  if (existing > 0) {
    console.log('[seed] already seeded, ensuring additive rows');
    await ensureSystemDiscoverer();
    await ensureToolInputSchemas();
    return;
  }

  // Roles
  const roleByKey: Record<string, string> = {};
  for (const r of ROLES) {
    const rec = await prisma.enterpriseRole.create({ data: r });
    roleByKey[r.key] = rec.id;
  }

  // Users
  const users = [
    { username: 'sa', displayName: 'Super Admin', email: 'sa@eg.local', departmentId: null, region: null, metadata: {}, roles: ['super_admin'] },
    { username: 'pa', displayName: 'Permission Admin', email: 'pa@eg.local', departmentId: null, region: null, metadata: {}, roles: ['permission_admin'] },
    { username: 'sales1', displayName: 'Sales One', email: 'sales1@eg.local', departmentId: 'sales', region: 'CN-EAST', metadata: {}, roles: ['internal_sales'] },
    { username: 'ops1', displayName: 'Ops One', email: 'ops1@eg.local', departmentId: 'ops', region: 'CN-EAST', metadata: {}, roles: ['internal_ops'] },
    { username: 'tech1', displayName: 'Tech One', email: 'tech1@eg.local', departmentId: 'tech', region: 'CN-EAST', metadata: {}, roles: ['internal_tech'] },
    { username: 'cust1', displayName: 'Customer One', email: 'cust1@acme.com', departmentId: null, region: 'CN-EAST', metadata: { customer_id: 'CUST-0001' }, roles: ['customer'] },
    { username: 'system-discoverer', displayName: 'System Discoverer', email: 'system-discoverer@eg.local', departmentId: null, region: null, metadata: { system: true }, roles: ['super_admin'] },
  ];
  const userByUsername: Record<string, string> = {};
  for (const u of users) {
    const created = await prisma.enterpriseUser.create({
      data: {
        username: u.username,
        displayName: u.displayName,
        email: u.email,
        departmentId: u.departmentId,
        region: u.region,
        metadata: u.metadata,
      },
    });
    userByUsername[u.username] = created.id;
    for (const rk of u.roles) {
      await prisma.enterpriseUserRole.create({ data: { userId: created.id, roleId: roleByKey[rk] } });
    }
  }

  // Tools
  const toolByKey: Record<string, string> = {};
  for (const t of TOOLS) {
    const rec = await prisma.enterpriseToolRegistry.create({
      data: {
        key: t.key,
        category: t.category,
        displayName: t.display_name,
        inputSchema: TOOL_INPUT_SCHEMAS[t.key] ?? {},
      },
    });
    toolByKey[t.key] = rec.id;
  }

  // Role→tool permissions
  for (const [roleKey, keys] of Object.entries(ROLE_TOOL_GRANTS)) {
    for (const k of keys) {
      await prisma.enterpriseToolPermission.create({
        data: {
          subjectType: 'role',
          subjectId: roleByKey[roleKey],
          toolId: toolByKey[k],
          allow: true,
        },
      });
    }
  }

  // Data scopes
  const scopes = [
    // super_admin & permission_admin — all
    { subjectType: 'role', subjectId: roleByKey.super_admin, sourceSystem: 'gongdan', entityType: 'ticket', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.super_admin, sourceSystem: 'xiaoshou', entityType: 'customer', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.super_admin, sourceSystem: 'cloudcost', entityType: 'service_account', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.permission_admin, sourceSystem: 'gongdan', entityType: 'ticket', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.permission_admin, sourceSystem: 'xiaoshou', entityType: 'customer', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.permission_admin, sourceSystem: 'cloudcost', entityType: 'service_account', scope: { all: true } },
    // customer — own tickets by customer_id or owner_user_id
    { subjectType: 'user', subjectId: userByUsername.cust1, sourceSystem: 'gongdan', entityType: 'ticket', scope: { customer_id: 'CUST-0001' } },
    { subjectType: 'user', subjectId: userByUsername.cust1, sourceSystem: 'gongdan', entityType: 'ticket', scope: { owner_user_id: '$self' } },
    // internal_sales
    { subjectType: 'user', subjectId: userByUsername.sales1, sourceSystem: 'xiaoshou', entityType: 'customer', scope: { sales_user_id: '$self' } },
    // internal_ops — all gongdan + all cloudcost
    { subjectType: 'role', subjectId: roleByKey.internal_ops, sourceSystem: 'gongdan', entityType: 'ticket', scope: { all: true } },
    { subjectType: 'role', subjectId: roleByKey.internal_ops, sourceSystem: 'cloudcost', entityType: 'service_account', scope: { all: true } },
    // internal_tech — tickets they own/operate
    { subjectType: 'role', subjectId: roleByKey.internal_tech, sourceSystem: 'gongdan', entityType: 'ticket', scope: { owner_user_id: '$self' } },
    { subjectType: 'role', subjectId: roleByKey.internal_tech, sourceSystem: 'gongdan', entityType: 'ticket', scope: { operation_user_id: '$self' } },
  ];
  for (const s of scopes) {
    await prisma.enterpriseDataScope.create({ data: s });
  }

  // Field policies — role_keys are roles that STILL SEE the field
  const policies = [
    { sourceSystem: 'gongdan', entityType: 'ticket', fieldPath: 'contactInfo', policy: 'mask', roleKeys: ['internal_ops', 'super_admin'] },
    { sourceSystem: 'xiaoshou', entityType: 'customer', fieldPath: 'current_month_consumption', policy: 'drop', roleKeys: ['internal_ops', 'super_admin'] },
    { sourceSystem: 'cloudcost', entityType: 'service_account', fieldPath: 'cost', policy: 'mask', roleKeys: ['internal_ops', 'super_admin', 'permission_admin'] },
    // Wildcard secret-keepers
    { sourceSystem: '*', entityType: '*', fieldPath: '*.apiKey', policy: 'drop', roleKeys: ['super_admin'] },
    { sourceSystem: '*', entityType: '*', fieldPath: '*.api_key', policy: 'drop', roleKeys: ['super_admin'] },
    { sourceSystem: '*', entityType: '*', fieldPath: '*.secret_key', policy: 'drop', roleKeys: ['super_admin'] },
    { sourceSystem: '*', entityType: '*', fieldPath: '*.secret', policy: 'drop', roleKeys: ['super_admin'] },
    { sourceSystem: '*', entityType: '*', fieldPath: '*.secret_*', policy: 'drop', roleKeys: ['super_admin'] },
  ];
  for (const p of policies) {
    await prisma.enterpriseFieldPolicy.create({ data: p });
  }

  // Identity map — tickets, customers, service accounts.
  // NOTE: ticket T-900 intentionally omitted so the missing_identity_map path fires.
  const idmaps = [
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-001', customerId: 'CUST-0001', ownerUserId: 'USR-CUST1', region: 'CN-EAST' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-002', customerId: 'CUST-0002', ownerUserId: 'USR-OPS1', region: 'CN-EAST' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-003', customerId: 'CUST-0001', ownerUserId: userByUsername.tech1, operationUserId: userByUsername.tech1, region: 'CN-EAST' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-004', customerId: 'CUST-0003', ownerUserId: 'USR-OPS1', region: 'CN-NORTH' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-005', customerId: 'CUST-0002', ownerUserId: 'USR-SALES1', region: 'CN-EAST' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-006', customerId: 'CUST-0001', ownerUserId: 'USR-CUST1', region: 'CN-EAST' },
    // intentional extras so ops1 sees 6-7 mapped rows
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-007', customerId: 'CUST-0004', ownerUserId: 'USR-OPS2', region: 'CN-SOUTH' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-008', customerId: 'CUST-0004', ownerUserId: 'USR-OPS2', region: 'CN-SOUTH' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-009', customerId: 'CUST-0005', ownerUserId: 'USR-OPS1', region: 'CN-WEST' },
    { sourceSystem: 'gongdan', entityType: 'ticket', sourceEntityId: 'T-010', customerId: 'CUST-0005', ownerUserId: 'USR-OPS1', region: 'CN-WEST' },
    // xiaoshou customers
    { sourceSystem: 'xiaoshou', entityType: 'customer', sourceEntityId: 'CUST-0001', salesUserId: userByUsername.sales1, region: 'CN-EAST' },
    { sourceSystem: 'xiaoshou', entityType: 'customer', sourceEntityId: 'CUST-0002', salesUserId: 'USR-SALES2', region: 'CN-NORTH' },
    { sourceSystem: 'xiaoshou', entityType: 'customer', sourceEntityId: 'CUST-0003', salesUserId: userByUsername.sales1, region: 'CN-EAST' },
    { sourceSystem: 'xiaoshou', entityType: 'customer', sourceEntityId: 'CUST-0004', salesUserId: 'USR-SALES3', region: 'CN-SOUTH' },
    { sourceSystem: 'xiaoshou', entityType: 'customer', sourceEntityId: 'CUST-0005', salesUserId: userByUsername.sales1, region: 'CN-WEST' },
    // cloudcost service accounts
    { sourceSystem: 'cloudcost', entityType: 'service_account', sourceEntityId: 'SA-001', departmentId: 'ops', region: 'CN-EAST' },
    { sourceSystem: 'cloudcost', entityType: 'service_account', sourceEntityId: 'SA-002', departmentId: 'ops', region: 'CN-NORTH' },
    { sourceSystem: 'cloudcost', entityType: 'service_account', sourceEntityId: 'SA-003', departmentId: 'ops', region: 'CN-EAST' },
  ];
  for (const m of idmaps) {
    await prisma.enterpriseIdentityMap.create({ data: m });
  }

  console.log('[seed] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
