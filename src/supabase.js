import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _token = (typeof localStorage !== 'undefined' && localStorage.getItem('ce_token')) || null;

export function getToken() { return _token; }

export function setToken(t) {
  _token = t;
  if (typeof localStorage !== 'undefined') {
    if (t) localStorage.setItem('ce_token', t);
    else localStorage.removeItem('ce_token');
  }
}

// 取出自定义 JWT 的 sub（即 exam_accounts.id），用于 exam_bank_progress 的 user_id
export function getUserId() {
  if (!_token) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(window.atob(_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
    return payload.sub || null;
  } catch {
    return null;
  }
}

// 缺少环境变量时用占位符，避免整页崩溃（登录页仍可渲染，仅在真正请求时报错）
const SAFE_URL = URL || 'http://localhost';
const SAFE_ANON = ANON || 'public-anon-placeholder';

export const supabase = createClient(SAFE_URL, SAFE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
  // 所有请求带上我们签发的自定义 JWT，使 RLS 的 auth.uid() = sub 生效
  accessToken: () => _token || ''
});

export const isConfigured = !!(URL && ANON);
