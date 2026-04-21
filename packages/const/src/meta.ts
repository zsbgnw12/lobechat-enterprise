import type { MetaData } from '@lobechat/types';

export const DEFAULT_AVATAR = '/avatars/agent-default.png';
export const DEFAULT_USER_AVATAR = '😀';
export const DEFAULT_SUPERVISOR_AVATAR = '🎙️';
export const DEFAULT_SUPERVISOR_ID = 'supervisor';
export const DEFAULT_BACKGROUND_COLOR = undefined;
export const DEFAULT_AGENT_META: MetaData = {};
// [enterprise-fork] 强制使用企业品牌 logo（不依赖 import 的 truthy 判断）
export const DEFAULT_INBOX_AVATAR = '/brand/logo.svg';
export const DEFAULT_USER_AVATAR_URL = '/brand/logo.svg';
