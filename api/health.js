// 后端连通性自检接口
// 用途：登录页打开时静默调用，一眼确认「/api 函数有没有正确部署到线上」。
// 返回 JSON（而不是 HTML 404 页）即说明服务器函数链路是通的。
export default function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    app: 'credit-exam-cloud',
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasJwtSecret: !!process.env.SUPABASE_JWT_SECRET,
    ts: Date.now()
  }));
}
