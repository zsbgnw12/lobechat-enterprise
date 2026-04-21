#!/usr/bin/env node
/* eslint-disable */
/**
 * rebrand.js ── 上游 LobeChat → Enterprise AI Workspace 幂等去品牌脚本
 *
 * 用途：每次从上游 canary 合并后执行一次，把被还原 / 新增的 "LobeHub /
 *       LobeChat" 字样重新替换为 "Enterprise AI Workspace"。脚本是幂等
 *       的，多次执行结果相同。
 *
 * 关键设计：只替换 JSON value，不替换 key。
 *   locales/**\/*.json 文件里 "lobehub"/"lobechat"（小写）通常是 i18n
 *   key 的一部分（如 "settingSystemTools.tools.lobehub.desc"）。README
 *   明确规定 i18n key 不改。本脚本通过 JSON.parse + 递归遍历只改 string
 *   value，保证 key 完全不受影响。
 *
 * 覆盖范围：
 *   • locales/**\/*.json              —— 只替换 value
 *   • packages/business/const/src/branding.ts —— 整行文本替换（兜底）
 *   • packages/builtin-agents/src/agents/*\/systemRole.ts —— 文本替换
 *
 * 用法：
 *     node scripts/rebrand.js           # 实际执行替换
 *     node scripts/rebrand.js --dry-run # 只打印将要替换的匹配数
 *
 * 依赖：Node 18+（无三方包）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── 替换规则表 ───────────────────────────────────────────────────────────
// 顺序关键：先替换长词再替换短词，避免二次命中。
// 注意：lobehub / lobechat（小写）在 value 里也可能出现（URL / 邮箱），
//       只要是 value 位置就该替换；key 位置由 JSON 遍历逻辑自动规避。
const RULES = [
  ['LobeHub CLI', 'Enterprise AI CLI'],
  ['LobeChat Cloud', 'Enterprise AI Cloud'],
  ['LobeChat', 'Enterprise AI Workspace'],
  ['LobeHub', 'Enterprise AI Workspace'],
  ['support@lobehub.com', 'support@enterprise-ai.local'],
  ['contact@lobehub.com', 'support@enterprise-ai.local'],
  ['hello@lobehub.com', 'support@enterprise-ai.local'],
  // 注意：不替换裸域名 lobehub.com / lobechat.com —— 那通常是 OAuth/OIDC
  //       回调 endpoint / trusted-origin，换错会让登录 / SSO 崩。
  //       如果某个域名确属"品牌推广"场景需要删，手动在代码里处理。
];

function replaceAll(str) {
  let out = str;
  for (const [from, to] of RULES) {
    if (out.indexOf(from) === -1) continue;
    out = out.split(from).join(to);
  }
  return out;
}

// 递归：只处理 string value，不碰 object key
function walkJson(node) {
  let hits = 0;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') {
        const next = replaceAll(node[i]);
        if (next !== node[i]) {
          hits++;
          node[i] = next;
        }
      } else if (node[i] && typeof node[i] === 'object') {
        hits += walkJson(node[i]);
      }
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') {
        const next = replaceAll(v);
        if (next !== v) {
          hits++;
          node[k] = next;
        }
      } else if (v && typeof v === 'object') {
        hits += walkJson(v);
      }
    }
  }
  return hits;
}

function walkDir(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, acc);
    else if (e.isFile() && e.name.endsWith('.json')) acc.push(full);
  }
  return acc;
}

// ─── 主流程 ────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

const localeFiles = walkDir(path.join(ROOT, 'locales'), []);

// ── 全域文本替换的文件清单 ─────────────────────────────────────────────
// 规则：只收入"用户可见"的品牌面，不碰测试文件 / 注释 / import。
// 为避免误替换，这里用 .ts/.tsx 白名单而非目录递归。
const plainTextFiles = [
  // 品牌常量 + 内置 agent 开场白
  'packages/business/const/src/branding.ts',
  'packages/builtin-agents/src/agents/agent-builder/systemRole.ts',
  'packages/builtin-agents/src/agents/group-supervisor/systemRole.ts',

  // Better Auth 邮件模板（用户注册 / 重置密码 / magic link / 验证码都会收到）
  //
  // 注意：`define-config.ts` 和 `oidc-provider/config.ts` 虽然有品牌字样，
  //       但同一个文件里混了 import 路径 / OAuth 回调 URL / client_id 字面量，
  //       脚本化替换会把这些也误改掉——那些文件手工维护即可。
  'src/libs/better-auth/email-templates/change-email.ts',
  'src/libs/better-auth/email-templates/magic-link.ts',
  'src/libs/better-auth/email-templates/reset-password.ts',
  'src/libs/better-auth/email-templates/verification-otp.ts',
  'src/libs/better-auth/email-templates/verification.ts',

  // GitHub User-Agent default
  'src/server/modules/GitHub/index.ts',

  // 内置 Plugin / Skill 的 author 标识 + "官方" 判定
  'src/components/Plugins/PluginTag.tsx',
  'src/features/LibraryModal/AssignKnowledgeBase/Item/PluginTag.tsx',
  'src/features/PluginDevModal/LocalForm.tsx',
  'src/features/SkillStore/SkillDetail/BuiltinAgentSkillDetailProvider.tsx',
  'src/features/SkillStore/SkillDetail/BuiltinDetailProvider.tsx',
  'src/features/SkillStore/SkillList/LobeHub/index.tsx',
  'src/store/tool/slices/builtin/selectors.ts',

  // Locale defaults（TS 源文件，i18n 生成 JSON 的种子）
  'src/locales/default/electron.ts',
  'src/locales/default/setting.ts',

  // Community 页的作者/平台字段
  'src/routes/(main)/community/(detail)/agent/features/Details/Capabilities/PluginItem.tsx',
  'src/routes/(main)/community/(detail)/skill/features/Sidebar/Platform.tsx',
].filter((p) => fs.existsSync(p));

console.log(
  `[rebrand] 扫描 ${localeFiles.length} 个 locale JSON + ${plainTextFiles.length} 个源码文件 (dry-run=${DRY_RUN})`,
);

let total = 0;
let touched = 0;

// locale JSON：结构化只改 value
for (const f of localeFiles) {
  let raw;
  try {
    raw = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 非标 JSON，跳过
    continue;
  }
  const hits = walkJson(parsed);
  if (hits > 0) {
    total += hits;
    touched++;
    if (!DRY_RUN) {
      fs.writeFileSync(f, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    }
  }
}

// 源码 .ts：整行文本替换（branding 常量、agent systemRole）
for (const f of plainTextFiles) {
  const raw = fs.readFileSync(f, 'utf8');
  const next = replaceAll(raw);
  if (next !== raw) {
    // 粗略统计：规则逐条计算
    let h = 0;
    for (const [from] of RULES) {
      const m = raw.match(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
      h += m ? m.length : 0;
    }
    total += h;
    touched++;
    if (!DRY_RUN) fs.writeFileSync(f, next, 'utf8');
  }
}

console.log(
  DRY_RUN
    ? `[rebrand] DRY-RUN 结束：合计将替换 ${total} 处，涉及 ${touched} 个文件。`
    : `[rebrand] 完成：合计替换 ${total} 处，写入 ${touched} 个文件。`,
);
if (!DRY_RUN) {
  console.log('[rebrand] 提示：运行 `git diff --stat` 复核；本脚本不改动 i18n key，只改 value。');
}
