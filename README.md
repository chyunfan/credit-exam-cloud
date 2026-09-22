# 云题库 · 练习（云端版）

按模板导入题库（xlsx）、命名、练习、错题/收藏/续做**跨设备云端同步**的题库系统。
支持导入多套不同题库（单选/多选/判断/案例），互不干扰。
前端 Vite + Supabase + 自定义账号登录；后端为两个 Vercel Serverless 函数（注册/登录）。

## 技术栈
- 前端：Vite + 原生 ES Module（无框架），`@supabase/supabase-js`、`xlsx`(SheetJS)
- 后端：Vercel 函数 `api/register.js`、`api/login.js`（bcrypt + jsonwebtoken 签发自定义 JWT）
- 数据库：Supabase（Postgres + RLS 按用户隔离）
- 部署：GitHub 仓库 → Vercel 自动构建静态前端 + 服务端函数

## 目录结构
```
index.html              # 入口（登录 / 题库管理 / 练习 / 结果 四个屏）
src/
  main.js               # 应用启动与屏幕路由
  auth.js               # 自定义账号登录/注册（调用 /api/*）
  supabase.js           # supabase 客户端 + 自定义 JWT 注入 RLS
  store.js              # 错题/收藏/续做（云端优先，本地镜像兜底离线）
  banks.js              # 题库管理：列表/导入/重命名/导出/删除
  import.js             # xlsx 解析 + 逐行校验 + 模板/导出生成
  engine.js             # 练习引擎（顺序/考试/错题/收藏 + 答题卡/续做）
  styles.css
api/
  register.js           # 注册（bcrypt 存 hash）
  login.js              # 登录（验密 + 签发 HS256 JWT，payload.sub=exam_accounts.id）
supabase/
  schema.sql            # 建表 + RLS（在 Supabase SQL Editor 执行一次）
scripts/
  inline.mjs            # 构建后把 CSS/JS 内联进 index.html → 输出单文件产物
```

## 一、Supabase 初始化（一次性）
1. 新建 Supabase 项目。
2. 打开 **SQL Editor**，粘贴 `supabase/schema.sql` 并执行（建 `exam_accounts` / `exam_banks` / `exam_bank_progress` 三表 + RLS）。
3. 记录项目信息：**Project URL**、**anon public key**、**JWT Secret**（Settings → API）、**service_role key**（Settings → API，仅服务端用）。
   - RLS 用 `auth.uid()` 隔离；登录函数签发的自定义 JWT 的 `sub` = `exam_accounts.id`，因此 `exam_banks`/`exam_bank_progress` 的隔离自动生效。

## 二、本地开发
```bash
npm install
# 复制 .env.example 为 .env 并填好四个值
npm run dev          # http://localhost:5173
```
- 无 Supabase 密钥时：登录/题库列表不可用，但首页与导入**校验逻辑**可直接用（把 `src/main.js`
  中 `boot()` 的登录拦截临时跳过即可单测 UI）。完整联调需真实 Supabase。

## 三、构建与部署

### 构建（产出单文件）
```bash
npm run build        # vite build + 内联 → dist/index.html 自包含单文件
npm run build:multi  # 仅 vite build（多文件：index.html + assets/）
```
`npm run build` 得到的 `dist/index.html`（约 690 KB）已把 CSS/JS 全部内联，
**可直接单文件部署**（上传/复制到任意静态目录、子路径或 file:// 打开都能正常显示）。
> 也可接 GitHub → Vercel 自动构建，此时构建命令填 `npm run build`、输出目录 `dist`。

### 部署到 Vercel
1. 把代码推到 GitHub 仓库。
2. Vercel 导入该仓库：`Framework = Vite`，构建命令 `npm run build`，输出 `dist`。
   - `vercel.json` 已声明 `api/register.js`、`api/login.js` 为函数。
3. 在 Vercel **项目 → Settings → Environment Variables** 添加：
   - `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（前端用，会打包进客户端）
   - `SUPABASE_URL`、`SUPABASE_JWT_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`（仅服务端）
4. 部署完成后访问分配的域名即可。

> ⚠️ 单文件部署（如上传到 `chyunfan.cn/子路径`）时，`/api/register`、`/api/login`
> 这两个函数**不会**一起上线，登录/注册会 404。此种场景需把 `api/` 两个函数
> 另行部署（Vercel/云函数），或改用完整的 Vercel 仓库部署。

## 四、题库模板（.xlsx，10 列）
| 题型 | 案例材料 | 题干 | A | B | C | D | E | F | 答案 | 解析 |
|---|---|---|---|---|---|---|---|---|---|---|
- **题型**：仅 `单选 / 多选 / 判断 / 案例`（中文或英文均可识别）。
- **选项**：A–F 最多 6 列，未用留空。
- **答案**：单选=单字母(如 `A`)；多选=连写(如 `ACD`)；判断=`对/错` 或 `A/B`；案例子题按单选/多选规则。
- **案例**：连续的「题型=案例」且「案例材料」相同归为同一案例；首行填场景，子问题各带题干/选项/答案。
- 在题库管理页点「下载空模板」可获取带示例的 xlsx。

## 校验规则（逐行，报错带行号）
题型非法 / 答案指向空选项或超 F / 单选答案≠1 / 多选答案<2 或全选 / 判断答案非对(错 / 案例缺材料或子题缺题干选项 → 全部报错并阻断导入。

## 权限说明
- 登录态存于浏览器 localStorage → 同设备自动沿用上次账号；点「注销」清除可换号。
- 自定义账号（账号≥5 位、密码≥6 位，均支持中文），不依赖 Supabase Auth。
- 内置「默认题库」为只读本地题库（视前端需要接入），云端题库由用户自行导入。

## 常见问题
| 现象 | 原因 | 处理 |
|---|---|---|
| 页面无样式、所有界面堆在一起 | CSS/JS 404（`.hide` 失效） | 用 `npm run build` 出单文件；或确认 `assets/` 一起部署 |
| 登录成功但题库列表空白 | `SUPABASE_JWT_SECRET` 不匹配 | 与后台 JWT Secret 核对一致 |
| 登录/注册报 404 | 未部署 `api/` 函数 | 走完整 Vercel 部署（含 `api/`） |
