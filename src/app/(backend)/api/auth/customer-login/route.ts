/**
 * [enterprise-fork] 客户编号登录接口
 *
 * POST /api/auth/customer-login  body = { customerCode: "CUST-XXXXXXXX" }
 *
 * 流程:
 *   1. 验证 customerCode 格式
 *   2. 调 gongdan /auth/customer-login 拿 JWT(实际权威验证)
 *   3. 用 signUp/signIn 建立 Better Auth 会话(合成密码,客户不感知)
 *      - 从返回对象直接拿 userId,不再做 email lookup(避开大小写/normalization 陷阱)
 *   4. 把 gongdan JWT 写进 account 表(providerId='gongdan-customer')
 *   5. 把 Better Auth Set-Cookie 透传给浏览器
 */
import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { account as accountsTable } from '@/database/schemas/betterAuth';
import { serverDB } from '@/database/server';
import {
  customerEmail,
  customerLogin,
  deriveSyntheticPassword,
  GONGDAN_PROVIDER_ID,
  GongdanAuthError,
} from '@/server/services/gongdan/customerAuth';

const CUSTOMER_CODE_REGEX = /^[\w-]{1,32}$/u;

/** 从 signUp 或 signIn 的返回里提取 userId。Better Auth 返回结构:
 *   - signUpEmail → { user: { id, ... }, token }
 *   - signInEmail → { user: { id, ... }, token, redirect? }
 *  用 asResponse: true 时则是 Response,要读 body JSON。
 */
async function extractUserIdFromResponse(resp: Response): Promise<string | null> {
  try {
    const body = await resp.clone().json();
    return body?.user?.id ?? body?.token?.userId ?? null;
  } catch {
    return null;
  }
}

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

  // 1. gongdan 认证
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

  // 2. 先试 signIn(老客户);失败(401/INVALID_PASSWORD)就 signUp
  let sessionResponse: Response | null = null;
  let userId: string | null = null;

  try {
    sessionResponse = (await auth.api.signInEmail({
      asResponse: true,
      body: { email, password },
    })) as Response;

    if (sessionResponse.status >= 200 && sessionResponse.status < 300) {
      userId = await extractUserIdFromResponse(sessionResponse);
    } else {
      // signIn 失败(用户不存在) → 走 signUp
      sessionResponse = null;
    }
  } catch (err) {
    // 异常也当 signIn 失败处理

    console.warn(
      '[customer-login] signIn first attempt failed, will signUp:',
      (err as Error).message,
    );
  }

  if (!sessionResponse) {
    // signUp —— 自动创建 user + credential account + session
    try {
      sessionResponse = (await auth.api.signUpEmail({
        asResponse: true,
        body: { email, name: customerCode, password },
      })) as Response;
    } catch (err) {
      console.error('[customer-login] signUpEmail threw:', err);
      return NextResponse.json(
        { error: 'signup_failed', message: String((err as Error).message) },
        { status: 500 },
      );
    }

    if (sessionResponse.status < 200 || sessionResponse.status >= 300) {
      const text = await sessionResponse.clone().text();

      console.error('[customer-login] signUpEmail non-2xx:', sessionResponse.status, text);
      return NextResponse.json(
        {
          error: 'signup_failed',
          message: `Better Auth ${sessionResponse.status}: ${text.slice(0, 200)}`,
        },
        { status: 500 },
      );
    }
    userId = await extractUserIdFromResponse(sessionResponse);
  }

  if (!userId) {
    console.error('[customer-login] userId not extracted from Better Auth response');
    return NextResponse.json({ error: 'userid_extract_failed' }, { status: 500 });
  }

  // 3. upsert gongdan-customer account 行
  const expiresAt = new Date(Date.now() + gongdanResp.expiresIn * 1000);
  const [existingAccount] = await serverDB
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, GONGDAN_PROVIDER_ID)))
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
      accountId: gongdanResp.user.id,
      createdAt: new Date(),
      id: crypto.randomUUID(),
      providerId: GONGDAN_PROVIDER_ID,
      refreshToken: gongdanResp.refreshToken,
      updatedAt: new Date(),
      userId,
    });
  }

  // 4. 透传 Better Auth 下发的 Set-Cookie 给浏览器
  const headers = new Headers();
  const setCookie = sessionResponse.headers.get('set-cookie');
  if (setCookie) headers.append('set-cookie', setCookie);

  return NextResponse.json(
    { customerCode, ok: true, redirectTo: '/chat' },
    { headers, status: 200 },
  );
}
