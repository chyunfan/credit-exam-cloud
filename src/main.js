import { initAuth, getSession, getUsername, logout } from './auth.js';
import { initBanks, renderBanks, openBankById } from './banks.js';
import { setQuestions, initEngine, refreshHomeUI, syncPrefsFromCloud } from './engine.js';
import { loadBankState } from './store.js';

const APP_SCREENS = ['banks', 'home', 'practice', 'result'];

function showScreen(name) {
  if (name === 'auth') {
    document.getElementById('auth').classList.remove('hide');
    document.getElementById('app').classList.add('hide');
    return;
  }
  document.getElementById('auth').classList.add('hide');
  const app = document.getElementById('app');
  app.classList.remove('hide');
  // 答题中（练习/结果页）给 app 打标记：手机端会收起顶部应用栏，把屏幕留给题目
  app.classList.toggle('in-practice', name === 'practice' || name === 'result');
  APP_SCREENS.forEach(s => {
    document.getElementById(s).classList.toggle('hide', s !== name);
  });
}

function showBanks() {
  document.getElementById('topUser').textContent = getUsername() || '已登录';
  renderBanks();
  showScreen('banks');
}

async function handleOpenBank({ id, name, questions }) {
  try { localStorage.setItem('ce_current_bank', JSON.stringify({ id, name })); } catch (e) {}
  // 先等该题库的错题/收藏/进度加载完成，再渲染首页，避免计数与续做横幅用到旧题库的数据
  await loadBankState(id, true);
  setQuestions(questions);
  document.getElementById('topBankName').textContent = name;
  document.getElementById('topUser').textContent = getUsername() || '已登录';
  showScreen('home');
  // 登录后按账号恢复上次的练习设置（练习选项/模式/组卷参数）；拉取失败不影响使用
  await syncPrefsFromCloud();
  refreshHomeUI();
}

function enterApp() {
  showBanks();
}

function doLogout() {
  logout();
  try { localStorage.removeItem('ce_current_bank'); } catch (e) {}
  showScreen('auth');
}

async function boot() {
  initAuth({ onLogin: enterApp });
  initBanks({ onOpenBank: handleOpenBank });
  initEngine();

  document.getElementById('toBanks').addEventListener('click', showBanks);
  document.getElementById('logoutBtn').addEventListener('click', doLogout);

  if (getSession()) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('ce_current_bank') || 'null'); } catch { return null; } })();
    if (saved && saved.id) {
      // openBankById 内部会 await handleOpenBank：加载该题库状态并渲染首页
      const ok = await openBankById(saved.id);
      if (ok) return;
    }
    showBanks();
  } else {
    showScreen('auth');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
