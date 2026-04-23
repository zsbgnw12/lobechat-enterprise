/**
 * [enterprise-fork] 客户编号登录接口
 *
 * POST /api/auth/customer-login  body = { customerCode: "CUST-XXXXXXXX" }
 *
 * 流程:
 *   1. 验证 customerCode 格式
 *   2. 调 gongdan /auth/customer-login 拿 JWT(实际权威验证在这一步)
 *   3. 查找/创建 Better Auth user(email = CUST-XXX@customer.local)
 *      - 密码 = HMAC(pepper, customerCode),客户永远不感知
 *   4. 用 Better Auth 原生 signInEmail 建立 session cookie
 *   5. 把 gongdan JWT 写进 account 表(providerId='gongdan-customer')
 *   6. 返回 { ok, redirectTo } + Set-Cookie
 *
 * 客户之后和普通员工用户一样使用 LobeChat,唯一区别是调 chat-gw 时
 * tokenStore 会优先用 gongdan-customer 的 JWT。
 */
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { account as accountsTable } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import {
  customerEmail,
  customerLogin,
  deriveSyntheticPassword,
  GONGDAN_PROVIDER_ID,
  GongdanAuthError,
} from '@/server/services/gongdan/customerAuth';

const CUSTOMER_CODE_REGEX = /^[\w-]{1,32}$/u;

export async function POST(req: NextRequest) {
  let customerCode: string;
  try {
    const body = await req.json();
    customerCode = (body?.customerCode || '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!CUSTOMER_CODE_REGEX.test(customerCode)) {
    return NextResponse.json(
      { error: 'invalid_customer_code', message: '客户编号格式不合法' },
      { status: 400 },
    );
  }

  // 1. 调 gongdan 验证 + 拿 token(失败直接透传 401)
  let gongdanResp;
  try {
    gongdanResp = await customerLogin(customerCode);
  } catch (err) {
    if (err instanceof GongdanAuthError) {
      return NextResponse.json(
        { error: 'gongdan_rejected', message: err.message },
        { status: err.status === 401 ? 401 : 502 },
      );
    }

    console.error('[customer-login] gongdan call failed:', err);
    return NextResponse.json(
      { error: 'gongdan_unreachable', message: '工单系统暂不可达' },
      { status: 502 },
    );
  }

  const email = customerEmail(customerCode);
  const password = deriveSyntheticPassword(customerCode);

  // 2. 查 user 是否已存在
  const [existing] = await serverDB
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // 3. 不存在 → signUp;存在 → signIn
  try {
    if (!existing) {
      await auth.api.signUpEmail({
        body: {
          email,
          name: customerCode,
          password,
        },
      });
    }
  } catch (err) {
    console.error('[customer-login] signUpEmail failed:', err);
    return NextResponse.json(
      { error: 'signup_failed', message: String((err as Error).message) },
      { status: 500 },
    );
  }

  // 4. signInEmail —— 这一步会让 Better Auth 下发 session cookie
  let signInResp;
  try {
    signInResp = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
  } catch (err) {
    console.error('[customer-login] signInEmail failed:', err);
    return NextResponse.json(
      { error: 'signin_failed', message: String((err as Error).message) },
      { status: 500 },
    );
  }

  // 5. 查 userId(signUp 刚建的或已有的)
  const [userRow] = await serverDB
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!userRow?.id) {
    return NextResponse.json({ error: 'user_not_found_after_signup' }, { status: 500 });
  }

  // 6. upsert gongdan-customer account 行,把 gongdan JWT 存进去
  const expiresAt = new Date(Date.now() + gongdanResp.expiresIn * 1000);
  const [existingAccount] = await serverDB
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(eq(accountsTable.userId, userRow.id), eq(accountsTable.providerId, GONGDAN_PROVIDER_ID)),
    )
    .limit(1);

  if (existingAccount) {
    await serverDB
      .update(accountsTable)
      .set({
        accessToken: gongdanResp.accessToken,
        accessTokenExpiresAt: expiresAt,
        refreshToken: gongdanResp.refreshToken,
      })
      .where(eq(accountsTable.id, existingAccount.id));
  } else {
    await serverDB.insert(accountsTable).values({
      accessToken: gongdanResp.accessToken,
      accessTokenExpiresAt: expiresAt,
      accountId: gongdanResp.user.id, // gongdan 的 customer UUID
      createdAt: new Date(),
      id: crypto.randomUUID(),
      providerId: GONGDAN_PROVIDER_ID,
      refreshToken: gongdanResp.refreshToken,
      updatedAt: new Date(),
      userId: userRow.id,
    });
  }

  // 7. 把 Better Auth 下发的 Set-Cookie 透传给客户浏览器
  const headers = new Headers();
  const baSetCookie =
    (signInResp as any)?.headers?.get?.('set-cookie') ??
    (signInResp as any)?.response?.headers?.get?.('set-cookie');
  if (baSetCookie) headers.append('set-cookie', baSetCookie);

  return NextResponse.json(
    {
      customerCode,
      ok: true,
      redirectTo: '/chat',
    },
    { headers, status: 200 },
  );
}
