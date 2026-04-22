import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { authenticate } from '../../auth/middleware';
import { env } from '../../env';

const ADMIN_ROLES = ['super_admin', 'permission_admin'];

// ── CSRF helpers for dev /admin/login ───────────────────────────────────────
// Signed token: <nonce>.<hmac-sha256(nonce, secret)>  (both base64url)
function csrfSecret(): string {
  return process.env.ADMIN_CSRF_SECRET || process.env.NEXT_AUTH_SECRET || 'dev-admin-csrf-fallback';
}
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
}
function signCsrf(nonce: string): string {
  return b64url(createHmac('sha256', csrfSecret()).update(nonce).digest());
}
function newCsrfToken(): string {
  const nonce = b64url(randomBytes(18));
  return `${nonce}.${signCsrf(nonce)}`;
}
function verifyCsrf(token: string | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const ix = token.indexOf('.');
  if (ix <= 0) return false;
  const nonce = token.slice(0, ix);
  const sig = token.slice(ix + 1);
  const expected = signCsrf(nonce);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function escHtml(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ── helpers ──────────────────────────────────────────────────────────────────

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escHtml(title)} — Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f5f7fa;color:#222;min-height:100vh}
header{background:#1e293b;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:24px}
header a{color:#94a3b8;text-decoration:none;font-size:14px}
header a:hover{color:#fff}
header .brand{font-weight:700;font-size:16px;color:#fff;margin-right:16px}
nav a{padding:4px 10px;border-radius:4px}
nav a.active{background:#334155;color:#fff}
main{max-width:1100px;margin:32px auto;padding:0 24px}
h1{font-size:22px;margin-bottom:20px;color:#1e293b}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
th,td{padding:10px 14px;text-align:left;font-size:13px;border-bottom:1px solid #e2e8f0}
th{background:#f1f5f9;font-weight:600;color:#475569}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f8fafc}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#e0f2fe;color:#0369a1}
.badge.ok{background:#dcfce7;color:#166534}
.badge.denied{background:#fee2e2;color:#991b1b}
.badge.error{background:#fef9c3;color:#854d0e}
form.inline{display:inline}
input,select{border:1px solid #cbd5e1;border-radius:4px;padding:6px 10px;font-size:13px;background:#fff}
input:focus,select:focus{outline:2px solid #3b82f6;border-color:transparent}
button{padding:6px 14px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600}
.btn-primary{background:#3b82f6;color:#fff}.btn-primary:hover{background:#2563eb}
.btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
.btn-sm{padding:3px 10px;font-size:12px}
.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px;background:#fff;padding:14px 16px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.filters label{font-size:12px;font-weight:600;color:#64748b}
#msg{position:fixed;top:16px;right:16px;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:600;display:none;z-index:999}
#msg.ok{background:#dcfce7;color:#166534;border:1px solid #86efac}
#msg.err{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.empty{padding:32px;text-align:center;color:#94a3b8;font-size:14px}
</style>
</head>
<body>
<header>
  <span class="brand">Admin</span>
  <nav>
    <a href="/admin">Dashboard</a>
    <a href="/admin/users">Users</a>
    <a href="/admin/tools">Tools</a>
    <a href="/admin/scopes">Scopes</a>
    <a href="/admin/identity-map">Identity Map</a>
    <a href="/admin/audit">Audit</a>
  </nav>
  <span style="margin-left:auto;font-size:13px;color:#94a3b8">
    ${env.AUTH_MODE === 'dev' ? '<a href="/admin/login" style="color:#fbbf24">dev-login</a>' : ''}
  </span>
</header>
<div id="msg"></div>
<main>
${body}
</main>
<script>
function showMsg(text,ok){var el=document.getElementById('msg');el.textContent=text;el.className=ok?'ok':'err';el.style.display='block';setTimeout(()=>el.style.display='none',3500);}
async function api(method,url,data){
  var opts={method,headers:{'Content-Type':'application/json'}};
  if(data)opts.body=JSON.stringify(data);
  var r=await fetch(url,opts);
  var j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||r.status);
  return j;
}
</script>
</body>
</html>`;
}

function page403(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>403 Forbidden</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f7fa;color:#222}
.box{text-align:center;padding:48px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h1{font-size:48px;color:#ef4444;margin-bottom:12px}p{color:#64748b;font-size:16px}</style>
</head>
<body><div class="box"><h1>403</h1><p>You do not have permission to access the admin panel.</p></div></body>
</html>`;
}

function loginPage(error = '', csrfToken = '', prefillUsername = ''): string {
  const safeUser = escHtml(prefillUsername);
  return shell(
    'Login',
    `
<h1>Dev Login</h1>
${error ? `<p style="color:#ef4444;margin-bottom:12px">${escHtml(error)}</p>` : ''}
<div style="background:#fff;padding:24px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);max-width:360px">
  <form method="POST" action="/admin/login">
    <input type="hidden" name="_csrf" value="${escHtml(csrfToken)}"/>
    <div style="margin-bottom:14px">
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Username</label>
      <input name="username" type="text" placeholder="sa / pa / ..." style="width:100%" required value="${safeUser}"/>
    </div>
    <button type="submit" class="btn-primary" style="width:100%">Login</button>
  </form>
</div>
<p style="margin-top:12px;font-size:12px;color:#94a3b8">Dev mode only — sets dev_user cookie</p>
`,
  );
}

// ── auth guard for UI routes ─────────────────────────────────────────────────

async function uiAuth(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  // Use same authenticate logic but on failure redirect/return HTML error
  await authenticate(req, reply);
  if (reply.sent) return false; // authenticate already replied (401)

  const roles = req.auth?.roleKeys ?? [];
  const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));
  if (!isAdmin) {
    reply.code(403).type('text/html').send(page403());
    return false;
  }
  return true;
}

// ── routes ───────────────────────────────────────────────────────────────────

export async function adminUiRoutes(app: FastifyInstance) {
  // Parse application/x-www-form-urlencoded for the login form
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string, done: (err: Error | null, result: unknown) => void) => {
      try {
        const params = new URLSearchParams(body);
        const result: Record<string, string> = {};
        params.forEach((v, k) => {
          result[k] = v;
        });
        done(null, result);
      } catch (e) {
        done(e as Error, undefined);
      }
    },
  );

  // Dev login page (only in dev mode)
  if (env.AUTH_MODE === 'dev') {
    app.get('/admin/login', async (req, reply) => {
      const token = newCsrfToken();
      // 允许 LobeChat 跳过来时预填 username：/admin/login?u=sa
      const q = req.query as Record<string, string> | undefined;
      const prefill = typeof q?.u === 'string' ? q.u.slice(0, 64) : '';
      reply
        .setCookie('admin_csrf', token, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
        })
        .type('text/html')
        .send(loginPage('', token, prefill));
    });

    app.post('/admin/login', async (req, reply) => {
      const raw = req.body as Record<string, string> | null;
      // CSRF double-submit: token from form body must match cookie and verify.
      const formToken = raw?._csrf;
      const cookieToken = (req.cookies as Record<string, string> | undefined)?.admin_csrf;
      if (!formToken || !cookieToken || formToken !== cookieToken || !verifyCsrf(formToken)) {
        reply
          .code(403)
          .type('text/html')
          .send(loginPage('Invalid or missing csrf token', newCsrfToken()));
        return;
      }
      const username: string | undefined = raw?.username;
      if (!username) {
        reply.type('text/html').send(loginPage('Username required', newCsrfToken()));
        return;
      }
      // Verify user exists and is active before setting cookie
      const { prisma } = await import('../../db');
      const user = await prisma.enterpriseUser.findUnique({
        where: { username },
        include: { userRoles: { include: { role: true } } },
      });
      if (!user || !user.isActive) {
        reply
          .type('text/html')
          .send(loginPage(`User "${username}" not found or inactive`, newCsrfToken()));
        return;
      }
      reply
        .setCookie('dev_user', username, { path: '/', httpOnly: true, sameSite: 'lax' })
        .redirect('/admin');
    });
  }

  // ── Dashboard ──
  app.get('/admin', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Admin Dashboard</h1>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:32px">
  ${[
    ['Users', '/admin/users'],
    ['Tools', '/admin/tools'],
    ['Scopes', '/admin/scopes'],
    ['Identity Map', '/admin/identity-map'],
    ['Audit Log', '/admin/audit'],
  ]
    .map(
      ([label, href]) =>
        `<a href="${href}" style="background:#fff;padding:24px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-decoration:none;color:#1e293b;font-weight:600;font-size:15px;display:block;text-align:center">${label}</a>`,
    )
    .join('')}
</div>
<p style="color:#64748b;font-size:13px">Logged in as: <strong>${escHtml(req.auth?.username)}</strong> (${escHtml(req.auth?.roleKeys?.join(', '))})</p>
`;
    reply.type('text/html').send(shell('Dashboard', body));
  });

  // ── Users ──
  app.get('/admin/users', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Users</h1>
<div style="margin-bottom:16px;display:flex;gap:10px">
  <button class="btn-primary" onclick="showCreate()">+ Add User</button>
</div>
<div id="create-form" style="display:none;background:#fff;padding:20px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:20px;max-width:500px">
  <h2 style="font-size:16px;margin-bottom:14px">Create User</h2>
  <div style="display:grid;gap:10px">
    <input id="c-username" placeholder="username" />
    <input id="c-display" placeholder="display name" />
    <input id="c-email" placeholder="email" />
    <input id="c-dept" placeholder="department_id" />
    <input id="c-region" placeholder="region" />
  </div>
  <div style="margin-top:14px;display:flex;gap:8px">
    <button class="btn-primary" onclick="createUser()">Create</button>
    <button onclick="hideCreate()" style="background:#e2e8f0;border-radius:4px">Cancel</button>
  </div>
</div>
<div id="tbl"></div>
<script>
async function load(){
  var r=await fetch('/api/admin/users');
  var users=await r.json();
  if(!users.length){document.getElementById('tbl').innerHTML='<div class="empty">No users</div>';return;}
  var html='<table><thead><tr><th>Username</th><th>Display Name</th><th>Dept</th><th>Region</th><th>Roles</th><th>Actions</th></tr></thead><tbody>';
  for(var u of users){
    html+='<tr><td>'+esc(u.username)+'</td><td>'+esc(u.display_name||'')+'</td><td>'+esc(u.department_id||'')+'</td><td>'+esc(u.region||'')+'</td>';
    html+='<td>'+(u.roles||[]).map(r=>'<span class="badge">'+esc(r)+'</span>').join(' ')+'</td>';
    html+='<td><button class="btn-primary btn-sm" onclick="editRoles(\\'' +u.id+'\\',\\'' +u.username+'\\')">Roles</button></td></tr>';
  }
  html+='</tbody></table>';
  document.getElementById('tbl').innerHTML=html;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function showCreate(){document.getElementById('create-form').style.display='';}
function hideCreate(){document.getElementById('create-form').style.display='none';}
async function createUser(){
  try{
    await api('POST','/api/admin/users',{
      username:document.getElementById('c-username').value,
      display_name:document.getElementById('c-display').value,
      email:document.getElementById('c-email').value,
      department_id:document.getElementById('c-dept').value||null,
      region:document.getElementById('c-region').value||null,
    });
    showMsg('User created',true);hideCreate();load();
  }catch(e){showMsg('Error: '+e.message,false);}
}
async function editRoles(id,name){
  var keys=prompt('Comma-separated role keys for '+name+':');
  if(keys===null)return;
  try{
    await api('POST','/api/admin/users/'+id+'/roles',{role_keys:keys.split(',').map(s=>s.trim()).filter(Boolean)});
    showMsg('Roles updated',true);load();
  }catch(e){showMsg('Error: '+e.message,false);}
}
load();
</script>
`;
    reply.type('text/html').send(shell('Users', body));
  });

  // ── Tools ──
  app.get('/admin/tools', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Tools</h1>
<div id="tbl"></div>
<div id="create-form" style="background:#fff;padding:20px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-top:20px;max-width:500px">
  <h2 style="font-size:16px;margin-bottom:14px">Register / Update Tool</h2>
  <div style="display:grid;gap:10px">
    <input id="t-key" placeholder="tool key (e.g. gongdan.create_ticket)" />
    <input id="t-name" placeholder="display name" />
    <input id="t-desc" placeholder="description" />
    <select id="t-risk"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select>
  </div>
  <button class="btn-primary" style="margin-top:14px" onclick="saveTool()">Save Tool</button>
</div>
<script>
async function load(){
  var r=await fetch('/api/admin/tools');
  var tools=await r.json();
  if(!tools.length){document.getElementById('tbl').innerHTML='<div class="empty">No tools registered</div>';return;}
  var html='<table><thead><tr><th>Key</th><th>Name</th><th>Risk</th><th>Description</th></tr></thead><tbody>';
  for(var t of tools){
    html+='<tr><td><code>'+esc(t.key)+'</code></td><td>'+esc(t.name||'')+'</td><td><span class="badge">'+esc(t.risk_level||'')+'</span></td><td>'+esc(t.description||'')+'</td></tr>';
  }
  html+='</tbody></table>';
  document.getElementById('tbl').innerHTML=html;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function saveTool(){
  try{
    await api('POST','/api/admin/tools',{
      key:document.getElementById('t-key').value,
      name:document.getElementById('t-name').value,
      description:document.getElementById('t-desc').value,
      risk_level:document.getElementById('t-risk').value,
    });
    showMsg('Tool saved',true);load();
  }catch(e){showMsg('Error: '+e.message,false);}
}
load();
</script>
`;
    reply.type('text/html').send(shell('Tools', body));
  });

  // ── Scopes ──
  app.get('/admin/scopes', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Data Scopes</h1>
<div id="tbl"></div>
<div id="create-form" style="background:#fff;padding:20px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-top:20px;max-width:500px">
  <h2 style="font-size:16px;margin-bottom:14px">Create Scope Rule</h2>
  <div style="display:grid;gap:10px">
    <input id="s-role" placeholder="role key" />
    <input id="s-dept" placeholder="department_id (or * for all)" />
    <input id="s-region" placeholder="region (or * for all)" />
    <input id="s-cust" placeholder="customer_id (or * for all)" />
  </div>
  <button class="btn-primary" style="margin-top:14px" onclick="saveScope()">Save Scope</button>
</div>
<script>
async function load(){
  var r=await fetch('/api/admin/scopes');
  var scopes=await r.json();
  if(!scopes.length){document.getElementById('tbl').innerHTML='<div class="empty">No scope rules</div>';return;}
  var html='<table><thead><tr><th>Role</th><th>Department</th><th>Region</th><th>Customer</th></tr></thead><tbody>';
  for(var s of scopes){
    html+='<tr><td><span class="badge">'+esc(s.role_key||s.roleKey||'')+'</span></td><td>'+esc(s.department_id||s.departmentId||'*')+'</td><td>'+esc(s.region||'*')+'</td><td>'+esc(s.customer_id||s.customerId||'*')+'</td></tr>';
  }
  html+='</tbody></table>';
  document.getElementById('tbl').innerHTML=html;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function saveScope(){
  var dept=document.getElementById('s-dept').value;
  var region=document.getElementById('s-region').value;
  var cust=document.getElementById('s-cust').value;
  try{
    await api('POST','/api/admin/scopes',{
      role_key:document.getElementById('s-role').value,
      department_id:dept==='*'?null:dept||null,
      region:region==='*'?null:region||null,
      customer_id:cust==='*'?null:cust||null,
    });
    showMsg('Scope saved',true);load();
  }catch(e){showMsg('Error: '+e.message,false);}
}
load();
</script>
`;
    reply.type('text/html').send(shell('Scopes', body));
  });

  // ── Identity Map ──
  app.get('/admin/identity-map', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Identity Map</h1>
<div id="tbl"></div>
<div id="create-form" style="background:#fff;padding:20px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-top:20px;max-width:500px">
  <h2 style="font-size:16px;margin-bottom:14px">Add / Update Mapping</h2>
  <div style="display:grid;gap:10px">
    <input id="i-ext" placeholder="external_id (Casdoor sub / SSO id)" />
    <input id="i-user" placeholder="gateway username" />
  </div>
  <button class="btn-primary" style="margin-top:14px" onclick="saveMap()">Save Mapping</button>
</div>
<script>
async function load(){
  var r=await fetch('/api/admin/identity-map');
  var maps=await r.json();
  if(!maps.length){document.getElementById('tbl').innerHTML='<div class="empty">No identity mappings</div>';return;}
  var html='<table><thead><tr><th>External ID</th><th>Username</th><th>Created</th></tr></thead><tbody>';
  for(var m of maps){
    html+='<tr><td><code>'+esc(m.external_id||m.externalId||'')+'</code></td><td>'+esc(m.username||'')+'</td><td>'+esc(m.created_at||m.createdAt||'')+'</td></tr>';
  }
  html+='</tbody></table>';
  document.getElementById('tbl').innerHTML=html;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function saveMap(){
  try{
    await api('POST','/api/admin/identity-map',{
      external_id:document.getElementById('i-ext').value,
      username:document.getElementById('i-user').value,
    });
    showMsg('Mapping saved',true);load();
  }catch(e){showMsg('Error: '+e.message,false);}
}
load();
</script>
`;
    reply.type('text/html').send(shell('Identity Map', body));
  });

  // ── Audit ──
  app.get('/admin/audit', async (req, reply) => {
    if (!(await uiAuth(req, reply))) return;
    const body = `
<h1>Audit Log</h1>
<div class="filters">
  <label>User</label><input id="f-user" placeholder="username" style="width:140px"/>
  <label>Tool</label><input id="f-tool" placeholder="tool key" style="width:180px"/>
  <label>Outcome</label>
  <select id="f-outcome">
    <option value="">all</option>
    <option value="allowed">allowed</option>
    <option value="denied">denied</option>
    <option value="error">error</option>
  </select>
  <label>From</label><input id="f-from" type="date" style="width:140px"/>
  <label>To</label><input id="f-to" type="date" style="width:140px"/>
  <button class="btn-primary" onclick="load()">Search</button>
</div>
<div id="tbl"></div>
<script>
async function load(){
  var params=new URLSearchParams();
  var u=document.getElementById('f-user').value;
  var t=document.getElementById('f-tool').value;
  var o=document.getElementById('f-outcome').value;
  var from=document.getElementById('f-from').value;
  var to=document.getElementById('f-to').value;
  if(u)params.set('user',u);
  if(t)params.set('tool',t);
  if(o)params.set('outcome',o);
  if(from)params.set('from',from);
  if(to)params.set('to',to+'T23:59:59');
  var r=await fetch('/api/admin/audit?'+params.toString());
  var rows=await r.json();
  if(!rows.length){document.getElementById('tbl').innerHTML='<div class="empty">No audit records match</div>';return;}
  var html='<table><thead><tr><th>Time</th><th>User</th><th>Tool</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>';
  for(var row of rows){
    var cls=row.outcome==='allowed'?'ok':row.outcome==='denied'?'denied':'error';
    var ts=row.at?new Date(row.at).toLocaleString():'';
    html+='<tr><td style="white-space:nowrap">'+esc(ts)+'</td><td>'+esc(row.username||'')+'</td><td><code>'+esc(row.toolKey||row.tool_key||'')+'</code></td>';
    html+='<td><span class="badge '+cls+'">'+esc(row.outcome||'')+'</span></td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">'+esc(row.reason||row.detail||'')+'</td></tr>';
  }
  html+='</tbody></table>';
  document.getElementById('tbl').innerHTML=html;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
load();
</script>
`;
    reply.type('text/html').send(shell('Audit Log', body));
  });
}
