import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function client() {
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// 账号：≥5 位（中文按字符计）；密码：≥6 位（中文允许）
function validUsername(u) {
  const s = (u || '').trim();
  return Array.from(s).length >= 5;
}
function validPassword(p) {
  const s = p || '';
  return Array.from(s).length >= 6;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return json(res, 400, { error: '请求体格式错误' }); }
  if (!body) return json(res, 400, { error: '缺少请求体' });

  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!validUsername(username)) return json(res, 400, { error: '账号至少 5 位（中文按字符计）' });
  if (!validPassword(password)) return json(res, 400, { error: '密码至少 6 位' });

  try {
    const supa = client();
    const { data: exist } = await supa.from('exam_accounts').select('id').eq('username', username).maybeSingle();
    if (exist) return json(res, 409, { error: '该账号已被注册' });

    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supa.from('exam_accounts').insert({ username, password_hash: hash }).select('id').single();
    if (error) return json(res, 500, { error: '注册失败：' + error.message });
    return json(res, 200, { ok: true, id: data.id });
  } catch (e) {
    return json(res, 500, { error: '服务器错误：' + e.message });
  }
}
