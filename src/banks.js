import * as XLSX from 'xlsx';
import { supabase, getUserId } from './supabase.js';
import { parseWorkbook, buildTemplateWorkbook, buildBankWorkbook } from './import.js';
import { getUsername } from './auth.js';
import { isAdmin, knownTags, ensureUsers } from './admin.js';

let pendingImport = null;   // { questions, caseCount }
let onOpenBank = null;

// 正在设置「可见范围」的题库 + 当前勾选的部门/角色
let scopeBank = null;
let scopeDepts = [];
let scopeRoles = [];

export function initBanks(cb) {
  onOpenBank = cb.onOpenBank;

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('tplBtn').addEventListener('click', () => {
    XLSX.writeFile(buildTemplateWorkbook(), '题库模板.xlsx');
  });
  document.getElementById('fileInput').addEventListener('change', onFile);
  document.getElementById('importClose').addEventListener('click', closeImport);
  document.getElementById('importMask').addEventListener('click', closeImport);
  document.getElementById('saveBankBtn').addEventListener('click', saveImport);
  bindScopeModal();
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const res = parseWorkbook(buf);
    if (!res.ok) {
      pendingImport = null;
      document.getElementById('importPreview').innerHTML =
        '<div class="feedback no show">解析失败，请修正后重试：<br>' +
        res.errors.map(x => '· ' + x).join('<br>') + '</div>';
      document.getElementById('saveBankBtn').disabled = true;
    } else {
      pendingImport = { questions: res.questions, caseCount: res.caseCount };
      let html = '<div class="feedback ok show">解析成功：共 <b>' + res.questions.length +
        '</b> 题，案例 <b>' + res.caseCount + '</b> 组。</div>';
      const ws = res.warnings || [];
      if (ws.length) {
        html += '<div class="feedback warn show">提醒（<b>不影响导入</b>，可保存后再核对）：<br>' +
          ws.slice(0, 20).map(x => '· ' + x).join('<br>') +
          (ws.length > 20 ? '<br>· …另有 ' + (ws.length - 20) + ' 条同类提醒' : '') +
          '</div>';
      }
      html += '<div class="muted" style="margin-top:8px">保存后该题库<b>默认全员可见</b>（题库后会标注上传者）。'
        + '如需限定部门或角色，请联系管理员调整「可见范围」。</div>';
      document.getElementById('importPreview').innerHTML = html;
      document.getElementById('saveBankBtn').disabled = false;
    }
    document.getElementById('bankName').value = file.name.replace(/\.xlsx?$/i, '');
    document.getElementById('importModal').classList.remove('hide');
  } catch (err) {
    alert('读取文件失败：' + err.message);
  } finally {
    e.target.value = '';
  }
}

function closeImport() {
  document.getElementById('importModal').classList.add('hide');
  pendingImport = null;
}

async function saveImport() {
  if (!pendingImport) return;
  const name = document.getElementById('bankName').value.trim();
  if (name.length < 1) { alert('请输入题库名称'); return; }
  const userId = getUserId();
  if (!userId) { alert('登录状态丢失，请重新登录'); return; }
  const { error } = await supabase.from('exam_banks').insert({
    user_id: userId,
    owner_name: getUsername() || null,   // 上传者：列表里显示「上传者：xxx」
    name,
    questions: pendingImport.questions,
    case_count: pendingImport.caseCount,
    visibility: 'public'                 // 人人可导入；导入后默认全员可见
  });
  if (error) { alert('保存失败：' + error.message); return; }
  closeImport();
  await renderBanks();
}

async function listBanks() {
  const me = getUserId();
  const { data, error } = await supabase
    .from('exam_banks')
    .select('id,name,case_count,created_at,questions,user_id,owner_name,visibility,allow_depts,allow_roles')
    .order('created_at', { ascending: false });
  if (error) { alert('加载题库失败：' + error.message); return []; }
  return (data || []).map(b => ({
    id: b.id,
    name: b.name,
    caseCount: b.case_count || 0,
    count: Array.isArray(b.questions) ? b.questions.length : 0,
    createdAt: b.created_at,
    userId: b.user_id,
    ownerName: b.owner_name || '',
    visibility: b.visibility || 'public',
    allowDepts: Array.isArray(b.allow_depts) ? b.allow_depts : [],
    allowRoles: Array.isArray(b.allow_roles) ? b.allow_roles : [],
    mine: b.user_id === me
  }));
}

/** 可见范围徽标 */
function visTag(b) {
  if (b.visibility === 'private') return '<span class="vis-tag vis-private">仅自己可见</span>';
  if (b.visibility === 'scope') {
    const parts = [];
    if (b.allowDepts.length) parts.push('部门 ' + b.allowDepts.join('、'));
    if (b.allowRoles.length) parts.push('角色 ' + b.allowRoles.join('、'));
    return '<span class="vis-tag vis-scope">限定：' + (parts.length ? esc(parts.join(' · ')) : '指定范围') + '</span>';
  }
  return '<span class="vis-tag vis-public">全员可见</span>';
}

/**
 * 权限口径（唯一入口，界面与各操作都用它判断）：
 *   上传者本人 或 管理员 → 可改名 / 导出 / 删除（可见范围仅管理员）
 *   其他人               → **只能练习**，既不删除也不修改
 */
function canManage(b) {
  if (!b) return false;
  if (isAdmin()) return true;
  return !!b.mine;
}

/** 越权提示：正常情况按钮不会出现，这是纵深防御的第二道闸（DOM 被改写 / 代码被调用也拦得住） */
function denyManage(b) {
  alert('无权限：只有题库上传者本人或管理员才能修改 / 删除该题库。\n\n'
    + '「' + ((b && b.name) || '该题库') + '」是 ' + ((b && b.ownerName) || '其他用户')
    + ' 上传的，你只能练习。');
}

function bankRow(b) {
  const adm = isAdmin();
  const own = canManage(b);
  const acts = [];
  acts.push('<button class="btn btn-primary btn-sm act-open" type="button">练习</button>');
  // 他人的题库：非管理员只给「练习」——不出现重命名 / 导出 / 删除 / 可见范围
  if (own) acts.push('<button class="btn btn-ghost btn-sm act-rename" type="button">重命名</button>');
  if (own) acts.push('<button class="btn btn-ghost btn-sm act-export" type="button">导出</button>');
  if (adm) acts.push('<button class="btn btn-ghost btn-sm act-scope" type="button">可见范围</button>');
  if (own) acts.push('<button class="btn btn-ghost btn-sm act-del" type="button">删除</button>');

  const meta = [b.count + ' 题', '案例 ' + b.caseCount + ' 组',
    '上传者：' + esc(b.ownerName || '未知') + (b.mine ? '（我）' : '')].join(' · ');

  return `
    <div class="bank-row" data-id="${esc(b.id)}">
      <div class="bank-info">
        <div class="bank-name">${esc(b.name)} ${visTag(b)}</div>
        <div class="muted">${meta}</div>
      </div>
      <div class="bank-acts">${acts.join('')}</div>
    </div>`;
}

export async function renderBanks() {
  const banks = await listBanks();
  const box = document.getElementById('bankList');
  if (!banks.length) {
    box.innerHTML = '<div class="muted" style="padding:20px 0;text-align:center">还没有题库，点击上方「导入题库」开始吧。</div>';
    return;
  }

  const mine = banks.filter(b => b.mine);
  const shared = banks.filter(b => !b.mine);
  // 管理员看到的「共享」里含别人的私有库（RLS 对管理员放开），标注出来便于管理
  let html = '';
  if (mine.length) html += '<div class="list-head">我上传的（' + mine.length + '）</div>' + mine.map(bankRow).join('');
  if (shared.length) {
    const tip = isAdmin() ? '' : '<span class="muted"> · 只能练习</span>';
    html += '<div class="list-head">其他人上传的（' + shared.length + '）' + tip + '</div>' + shared.map(bankRow).join('');
  }
  box.innerHTML = html;

  box.querySelectorAll('.bank-row').forEach(row => {
    const id = row.dataset.id;
    const b = banks.find(x => x.id === id);
    const on = (sel, fn) => { const el = row.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('.act-open', () => openBank(b));
    on('.act-rename', () => renameBank(b));
    on('.act-export', () => exportBank(b));
    on('.act-scope', () => openScope(b));
    on('.act-del', () => deleteBank(b));
  });
}

async function openBank(b) {
  const { data, error } = await supabase.from('exam_banks').select('questions').eq('id', b.id).single();
  if (error) { alert('打开失败：' + error.message); return; }
  if (!onOpenBank) return;
  await onOpenBank({ id: b.id, name: b.name, questions: data.questions || [] });
}

export async function openBankById(id) {
  const { data, error } = await supabase.from('exam_banks').select('id,name,questions').eq('id', id).single();
  if (error || !data) return false;
  if (onOpenBank) await onOpenBank({ id: data.id, name: data.name, questions: data.questions || [] });
  return true;
}

async function renameBank(b) {
  if (!canManage(b)) { denyManage(b); return; }        // 第二道闸
  const name = prompt('修改题库名称', b.name);
  if (!name || !name.trim()) return;
  const { error } = await supabase.from('exam_banks').update({ name: name.trim() }).eq('id', b.id);
  if (error) { alert('重命名失败：' + error.message); return; }
  await renderBanks();
}

async function deleteBank(b) {
  if (!canManage(b)) { denyManage(b); return; }        // 第二道闸
  const extra = b.mine ? '' : '\n注意：这是其他用户上传的题库。';
  if (!confirm(`确定删除题库「${b.name}」？${extra}\n该题库下的错题/收藏/进度也会一并删除，且不可恢复。`)) return;
  const { error } = await supabase.from('exam_banks').delete().eq('id', b.id);
  if (error) { alert('删除失败：' + error.message); return; }
  await renderBanks();
}

async function exportBank(b) {
  if (!canManage(b)) { denyManage(b); return; }        // 第二道闸
  const { data, error } = await supabase.from('exam_banks').select('questions').eq('id', b.id).single();
  if (error) { alert('导出失败：' + error.message); return; }
  const wb = buildBankWorkbook(data.questions || []);
  XLSX.writeFile(wb, (b.name || '题库') + '.xlsx');
}

// ============================================================
// 可见范围（管理员）
// ============================================================
function bindScopeModal() {
  document.getElementById('scopeClose').addEventListener('click', closeScope);
  document.getElementById('scopeMask').addEventListener('click', closeScope);
  document.getElementById('scopeCancel').addEventListener('click', closeScope);
  document.getElementById('scopeSave').addEventListener('click', saveScope);
  document.getElementById('scopeOpts').addEventListener('change', syncScopeUI);
  document.getElementById('deptChips').addEventListener('click', e => onChipClick(e, 'dept'));
  document.getElementById('roleChips').addEventListener('click', e => onChipClick(e, 'role'));
  addTagInput('deptInput', 'dept');
  addTagInput('roleInput', 'role');
}

function addTagInput(id, kind) {
  const inp = document.getElementById(id);
  inp.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = inp.value.trim();
    if (!v) return;
    const list = kind === 'dept' ? scopeDepts : scopeRoles;
    if (list.indexOf(v) < 0) list.push(v);
    inp.value = '';
    renderScopeChips();
  });
}

function onChipClick(e, kind) {
  const tag = e.target.closest('.tag');
  if (!tag) return;
  const v = tag.dataset.v;
  const list = kind === 'dept' ? scopeDepts : scopeRoles;
  const i = list.indexOf(v);
  if (i < 0) list.push(v); else list.splice(i, 1);
  renderScopeChips();
}

function openScope(b) {
  if (!isAdmin()) { alert('无权限：「可见范围」只有管理员可以调整。'); return; }   // 第二道闸
  scopeBank = b;
  scopeDepts = b.allowDepts.slice();
  scopeRoles = b.allowRoles.slice();
  document.getElementById('scopeBankName').textContent = b.name;
  const vis = ['public', 'scope', 'private'].indexOf(b.visibility) >= 0 ? b.visibility : 'public';
  const radio = document.querySelector('input[name="scopeVis"][value="' + vis + '"]');
  if (radio) radio.checked = true;
  scopeMsg('');
  syncScopeUI();
  document.getElementById('scopeModal').classList.remove('hide');
  // 首次打开时把用户列表拉回来，好给出「常用部门 / 角色」候选（拉不到也能手工输入）
  ensureUsers().then(() => {
    if (scopeBank && !document.getElementById('scopeDetail').classList.contains('hide')) renderScopeChips();
  });
}

function closeScope() {
  document.getElementById('scopeModal').classList.add('hide');
  scopeBank = null;
}

function currentVis() {
  const r = document.querySelector('input[name="scopeVis"]:checked');
  return r ? r.value : 'public';
}

function syncScopeUI() {
  const vis = currentVis();
  const detail = document.getElementById('scopeDetail');
  detail.classList.toggle('hide', vis !== 'scope');
  document.querySelectorAll('#scopeOpts .scope-opt').forEach(el => {
    el.classList.toggle('on', el.querySelector('input').checked);
  });
  if (vis === 'scope') renderScopeChips();

  const tips = {
    public: '所有登录用户在「管理题库」里都能看到这个题库。',
    scope: '只有部门或角色命中的人能看到；其他人（除管理员外）看不到。',
    private: '除管理员外，只有上传者本人能看到并练习。'
  };
  document.getElementById('scopeHint').textContent = tips[vis];
}

function renderScopeChips() {
  const known = knownTags();
  [['dept', scopeDepts, known.depts], ['role', scopeRoles, known.roles]].forEach(([kind, list, cands]) => {
    const box = document.getElementById(kind + 'Chips');
    if (!box) return;
    const picked = list.map(v =>
      '<span class="tag on" data-kind="' + kind + '" data-v="' + esc(v) + '">' + esc(v) + '<i>✕</i></span>').join('');
    const rest = cands.filter(v => list.indexOf(v) < 0);
    const candHtml = rest.length
      ? '<span class="tag-sep">常用：</span>' + rest.slice(0, 12).map(v =>
        '<span class="tag" data-kind="' + kind + '" data-v="' + esc(v) + '">+ ' + esc(v) + '</span>').join('')
      : '';
    const empty = (!list.length && !rest.length)
      ? '<span class="muted" style="font-size:12px">还没有可选值，直接在下面输入后回车添加（部门 / 角色在「用户管理」里维护）</span>'
      : '';
    box.innerHTML = picked + candHtml + empty;
  });
}

async function saveScope() {
  if (!scopeBank) return;
  if (!isAdmin()) { closeScope(); alert('无权限：「可见范围」只有管理员可以调整。'); return; }
  const vis = currentVis();
  if (vis === 'scope' && !scopeDepts.length && !scopeRoles.length) {
    scopeMsg('请至少选择一个部门或角色，否则没有人能看到这个题库。', true);
    return;
  }
  const btn = document.getElementById('scopeSave');
  btn.disabled = true;
  try {
    const { error } = await supabase.from('exam_banks').update({
      visibility: vis,
      allow_depts: vis === 'scope' ? scopeDepts : [],
      allow_roles: vis === 'scope' ? scopeRoles : []
    }).eq('id', scopeBank.id);
    if (error) throw new Error(error.message);
    closeScope();
    await renderBanks();
  } catch (e) {
    scopeMsg('保存失败：' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function scopeMsg(t, bad) {
  const el = document.getElementById('scopeMsg');
  el.textContent = t || '';
  el.style.color = bad ? 'var(--bad)' : '';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 验收脚本用：把权限口径暴露出来，Playwright 可直接断言（与 window.__exam 同一套做法）
if (typeof window !== 'undefined') {
  window.__banks = { renderBanks, canManage };
}
