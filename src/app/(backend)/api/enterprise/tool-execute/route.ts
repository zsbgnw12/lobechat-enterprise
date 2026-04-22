/**
 * POST /api/enterprise/tool-execute
 *
 * 客户端 EnterpriseExecutor（src/store/tool/slices/builtin/executors/enterprise.ts）
 * 在浏览器里调模型 function_call 得到的 enterprise-xxx 工具，
 * 转发到这个 Next.js 后端 endpoint，服务端再走 `executeEnterpriseTool`
 * 到 Gateway（带 X-Dev-User / Casdoor Bearer 头）。
 *
 * ## 请求体
 *   { identifier: "enterprise-gongdan-search_tickets", apiName: "execute", params: {...} }
 *
 * ## 响应体
 *   ToolExecutionResult: { content, success, error?, state? }
 *
 * ## 为什么不走 tRPC
 * 这条路径由 LobeChat 客户端 builtin-tool-executor 直接发，返回格式必须
 * 严格匹配 BuiltinToolResult。REST 更简单直接，避免 tRPC superjson 的
 * 序列化额外开销 + 错误转换。
 */
import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { executeEnterpriseTool } from '@/server/services/enterpriseGateway';

export async function POST(req: NextRequest) {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> | null = null;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch {
    // ignore, fallthrough to 401
  }
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        content: '',
        error: { code: 'UNAUTHENTICATED', message: 'login required' },
        success: false,
      },
      { status: 401 },
    );
  }

  let body: { identifier?: string; apiName?: string; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { content: '', error: { code: 'BAD_JSON', message: 'invalid JSON body' }, success: false },
      { status: 400 },
    );
  }
  const { identifier, params } = body;
  if (!identifier || typeof identifier !== 'string') {
    return NextResponse.json(
      {
        content: '',
        error: { code: 'BAD_IDENTIFIER', message: 'missing identifier' },
        success: false,
      },
      { status: 400 },
    );
  }

  const db = await getServerDB();
  const result = await executeEnterpriseTool({
    args: (params as Record<string, unknown>) ?? {},
    identifier,
    serverDB: db,
    userId: session.user.id,
  });
  // `executeEnterpriseTool` 自己不抛，结果里有 success 字段；统一 200 返回
  // 让前端 executor 按 body.success 判断。
  return NextResponse.json(result);
}
