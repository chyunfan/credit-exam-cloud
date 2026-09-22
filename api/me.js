import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

function client() {
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// 取请求头里的 Bearer 令牌并验签（与 api/login.js 签发的一致）
function authUser(req) {
  const h = req.headers['authorization'] || req.headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (!m) return null;
  try { return jwt.verify(m[1].trim(), JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { return null; }
}

/**
 * GET /api/me
 * 返回当前登录者的身份资料：
 *   { id, username, isAdmin, dept, role }
 * 前端用它决定「是否显示用户管理入口」以及题库行的操作按钮。
 * 说明：isAdmin 仅用于界面显示，真正的权限判定在数据库 RLS 与
 *       /api/admin-users 里各自独立校验，前端伪造不生效。
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });

  const claims = authUser(req);
  if (!claims) return json(res, 401, { error: '未登录或登录已过期，请重新登录' });

  try {
    const supa = client();
    const { data, error } = await supa
      .from('exam_accounts')
      .select('id,username,is_admin,dept,role,created_at')
      .eq('id', claims.sub)
      .maybeSingle();
    if (error) return json(res, 500, { error: '读取账号失败：' + error.message });
    if (!data) return json(res, 404, { error: '账号不存在，请重新登录' });

    return json(res, 200, {
      id: data.id,
      username: data.username,
      isAdmin: !!data.is_admin,
      dept: data.dept || '',
      role: data.role || ''
    });
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message });
  }
}
