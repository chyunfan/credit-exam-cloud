import * as XLSX from 'xlsx';
import { supabase, getUserId } from './supabase.js';
import { parseWorkbook, buildTemplateWorkbook, buildBankWorkbook } from './import.js';

let pendingImport = null;   // { questions, caseCount }
let onOpenBank = null;

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
    name,
    questions: pendingImport.questions,
    case_count: pendingImport.caseCount
  });
  if (error) { alert('保存失败：' + error.message); return; }
  closeImport();
  await renderBanks();
}

async function listBanks() {
  const { data, error } = await supabase
    .from('exam_banks')
    .select('id,name,case_count,created_at,questions')
    .order('created_at', { ascending: false });
  if (error) { alert('加载题库失败：' + error.message); return []; }
  return (data || []).map(b => ({
    id: b.id,
    name: b.name,
    caseCount: b.case_count || 0,
    count: Array.isArray(b.questions) ? b.questions.length : 0,
    createdAt: b.created_at
  }));
}

export async function renderBanks() {
  const banks = await listBanks();
  const box = document.getElementById('bankList');
  if (!banks.length) {
    box.innerHTML = '<div class="muted" style="padding:20px 0;text-align:center">还没有题库，点击上方「导入题库」开始吧。</div>';
    return;
  }
  box.innerHTML = banks.map(b => `
    <div class="bank-row" data-id="${b.id}">
      <div class="bank-info">
        <div class="bank-name">${escapeHtml(b.name)}</div>
        <div class="muted">${b.count} 题 · 案例 ${b.caseCount} 组</div>
      </div>
      <div class="bank-acts">
        <button class="btn btn-primary btn-sm act-open">练习</button>
        <button class="btn btn-ghost btn-sm act-rename">重命名</button>
        <button class="btn btn-ghost btn-sm act-export">导出</button>
        <button class="btn btn-ghost btn-sm act-del">删除</button>
      </div>
    </div>`).join('');

  box.querySelectorAll('.bank-row').forEach(row => {
    const id = row.dataset.id;
    const b = banks.find(x => x.id === id);
    row.querySelector('.act-open').addEventListener('click', () => openBank(b));
    row.querySelector('.act-rename').addEventListener('click', () => renameBank(b));
    row.querySelector('.act-export').addEventListener('click', () => exportBank(b));
    row.querySelector('.act-del').addEventListener('click', () => deleteBank(b));
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
  const name = prompt('修改题库名称', b.name);
  if (!name || !name.trim()) return;
  const { error } = await supabase.from('exam_banks').update({ name: name.trim() }).eq('id', b.id);
  if (error) { alert('重命名失败：' + error.message); return; }
  await renderBanks();
}

async function deleteBank(b) {
  if (!confirm(`确定删除题库「${b.name}」？\n该题库下的错题/收藏/进度也会一并删除，且不可恢复。`)) return;
  const { error } = await supabase.from('exam_banks').delete().eq('id', b.id);
  if (error) { alert('删除失败：' + error.message); return; }
  await renderBanks();
}

async function exportBank(b) {
  const { data, error } = await supabase.from('exam_banks').select('questions').eq('id', b.id).single();
  if (error) { alert('导出失败：' + error.message); return; }
  const wb = buildBankWorkbook(data.questions || []);
  XLSX.writeFile(wb, (b.name || '题库') + '.xlsx');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
