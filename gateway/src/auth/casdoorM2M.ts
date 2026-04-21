// Casdoor Machine-to-Machine (M2M) client_credentials token helper.
// See AI-BRAIN-API.md §2.1.
//
// POST ${CASDOOR_URL}/api/login/oauth/access_token
//   grant_type=client_credentials
//   client_id=<id>&client_secret=<secret>
//   (optionally: scope=openid)
//
// Token is cached per client_id in the shared cache (Redis-backed when available)
// with TTL = expires_in * 0.9 so we refresh before actual expiry.
//
// Security:
//   • Tokens are encrypted at rest with AES-256-GCM when TOKEN_ENCRYPTION_KEY is
//     set (32-byte base64). Decryption happens after cache.getJSON.
//   • Concurrent refreshes are coalesced via an in-module Promise map (single-flight).

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { request } from 'undici';
import { cache } from '../core/cache';

export interface M2MOptions {
  casdoorUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

interface CachedToken {
  // When encryption is active: access_token holds base64(iv|tag|ciphertext).
  // When inactive (dev fallback): access_token holds the raw token.
  access_token: string;
  expires_at: number; // epoch seconds
  enc?: 'aes-256-gcm';
}

function cacheKey(clientId: string) {
  return `casdoor_m2m:${clientId}`;
}

function getEncKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

let warnedMissingKey = false;
function warnOnceMissingKey() {
  if (warnedMissingKey) return;
  warnedMissingKey = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[casdoorM2M] TOKEN_ENCRYPTION_KEY unset or invalid; M2M tokens cached in plaintext (dev-only fallback)',
  );
}

function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptToken(payload: string, key: Buffer): string | null {
  try {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

// Single-flight: coalesce concurrent refreshes per clientId so we never
// stampede Casdoor when many callers race past an expired cache entry.
const inflight = new Map<string, Promise<string>>();

export async function getM2MToken(opts: M2MOptions): Promise<string> {
  const { casdoorUrl, clientId, clientSecret } = opts;
  if (!casdoorUrl || !clientId || !clientSecret) {
    throw new Error('missing_casdoor_m2m_credentials');
  }
  const key = cacheKey(clientId);
  const encKey = getEncKey();
  if (!encKey) {
    // AUTH_MODE==='casdoor' is the only path that reaches real Casdoor; dev/mock
    // paths never call this. But we still log a warn — never fail open silently.
    if (process.env.TOKEN_ENCRYPTION_KEY) {
      // Key was set but invalid (wrong length / non-base64).
      warnOnceMissingKey();
    } else {
      warnOnceMissingKey();
    }
  }

  const cached = await cache.getJSON<CachedToken>(key);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires_at > now + 5 && cached.access_token) {
    if (cached.enc === 'aes-256-gcm') {
      if (!encKey) {
        // Can't decrypt — treat as miss and refresh.
      } else {
        const pt = decryptToken(cached.access_token, encKey);
        if (pt) return pt;
        // Corrupt / key-rotated — fall through to refresh.
      }
    } else {
      return cached.access_token;
    }
  }

  // Single-flight: if another caller is already refreshing, await their Promise.
  const pending = inflight.get(clientId);
  if (pending) return pending;

  const p = (async () => {
    try {
      const base = casdoorUrl.replace(/\/$/, '');
      const url = `${base}/api/login/oauth/access_token`;
      const form = new URLSearchParams();
      form.set('grant_type', 'client_credentials');
      form.set('client_id', clientId);
      form.set('client_secret', clientSecret);
      if (opts.scope) form.set('scope', opts.scope);

      const res = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        bodyTimeout: 8000,
        headersTimeout: 8000,
      });
      const text = await res.body.text();
      if (res.statusCode >= 400) {
        throw new Error(`casdoor_m2m ${res.statusCode}: ${text.slice(0, 200)}`);
      }
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`casdoor_m2m non-json: ${text.slice(0, 120)}`);
      }
      const token = parsed.access_token as string | undefined;
      const expiresIn = Number(parsed.expires_in || 3600);
      if (!token) throw new Error(`casdoor_m2m missing access_token: ${text.slice(0, 200)}`);

      const ttl = Math.max(60, Math.floor(expiresIn * 0.9));
      const storedValue = encKey ? encryptToken(token, encKey) : token;
      const entry: CachedToken = {
        access_token: storedValue,
        expires_at: now + ttl,
        ...(encKey ? { enc: 'aes-256-gcm' as const } : {}),
      };
      await cache.setJSON(key, entry, ttl);
      return token;
    } finally {
      inflight.delete(clientId);
    }
  })();
  inflight.set(clientId, p);
  return p;
}
