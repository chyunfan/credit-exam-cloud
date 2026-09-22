import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return json(res, 400, { error: '请求体格式错误' }); }
  if (!body) return json(res, 400, { error: '缺少请求体' });

  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!username || !password) return json(res, 400, { error: '账号和密码不能为空' });

  try {
    const supa = client();
    const { data: acc } = await supa.from('exam_accounts').select('id, password_hash').eq('username', username).maybeSingle();
    if (!acc) return json(res, 401, { error: '账号或密码错误' });

    const ok = await bcrypt.compare(password, acc.password_hash);
    if (!ok) return json(res, 401, { error: '账号或密码错误' });

    // 签发自定义 JWT，使 Supabase RLS 的 auth.uid() = sub 生效
    const token = jwt.sign(
      { sub: acc.id, username, role: 'authenticated' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '30d' }
    );
    return json(res, 200, { token, username });
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message });
  }
}
