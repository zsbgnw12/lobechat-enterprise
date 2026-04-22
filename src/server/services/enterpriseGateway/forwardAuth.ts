/**
 * Gateway 请求身份适配层
 *
 * 目标：让上层调用方（enterpriseRole / enterpriseGateway / 未来的工具桥）
 * 用**同一个 helper** 生成 HTTP headers，而不是各自拼 X-Dev-User。这样生产
 * 切 Casdoor 时只改这一个文件。
 *
 * ## 优先级
 *   1. Casdoor access token（从 Better Auth session 拿到 idToken / accessToken）
 *      → `Authorization: Bearer <token>`
 *   2. Fallback 到 dev header `X-Dev-User: <username>`（基于邮箱 local-part）
 *
 * ## 当前状态
 * Better Auth 在 dev 模式下没有 Casdoor token（我们用的是邮箱密码注册）。
 * 所以这里仅实现 fallback 路径；将来接入 Casdoor SSO 时在 `tryGetCasdoorToken`
 * 里扩展。
 *
 * ## 使用
 *   const headers = await buildGatewayHeaders(db, userId);
 *   fetch(`${gatewayUrl}/api/...`, { headers });
 */
import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { UserModel } from '@/database/models/user';

import { deriveEnterpriseUsername } from '../enterpriseRole';

const log = debug('lobe-server:enterprise-gateway-auth');

export interface GatewayAuthHeaders {
  // 二选一（不并存）
  'Authorization'?: string;
  'Content-Type'?: string;
  'X-Dev-User'?: string;
}

/**
 * 尝试从 LobeChat session 拿 Casdoor access token。
 *
 * **TODO**：接入 Casdoor 后从 Better Auth 的 session.accounts 表读 accessToken
 * （通常 better-auth 会把 SSO idToken/accessToken 存到 accounts 表的 accessToken
 * 字段）。现在 dev 模式无 SSO，始终返回 null。
 */
async function tryGetCasdoorToken(
  _db: LobeChatDatabase,
  _lobechatUserId: string,
): Promise<string | null> {
  // placeholder: 未来版本查 better-auth 的 accounts 表
  // const account = await AccountModel.findByProvider(_db, _lobechatUserId, 'casdoor');
  // return account?.accessToken ?? null;
  return null;
}

/**
 * 给当前 LobeChat 用户构造转发到 Gateway 的 HTTP headers。
 *
 * 返回 null 表示身份完全无法解析（连邮箱都取不到）——调用方应当把这当做
 * "无企业身份"，不要发请求。
 */
export async function buildGatewayHeaders(
  db: LobeChatDatabase,
  lobechatUserId: string,
  extra: Record<string, string> = {},
): Promise<GatewayAuthHeaders | null> {
  // 1. 优先 Casdoor token（生产路径）
  const token = await tryGetCasdoorToken(db, lobechatUserId);
  if (token) {
    log('using Casdoor bearer for user %s', lobechatUserId);
    return {
      Authorization: `Bearer ${token}`,
      ...extra,
    };
  }

  // 2. Fallback：邮箱 local-part → X-Dev-User（dev 路径）
  try {
    const user = await UserModel.findById(db, lobechatUserId);
    const username = deriveEnterpriseUsername(user?.email);
    if (!username) {
      log('no usable email for user %s, cannot reach gateway', lobechatUserId);
      return null;
    }
    log('using X-Dev-User=%s (dev fallback) for user %s', username, lobechatUserId);
    return {
      'X-Dev-User': username,
      ...extra,
    };
  } catch (err) {
    log('user lookup failed for %s: %O', lobechatUserId, err);
    return null;
  }
}
