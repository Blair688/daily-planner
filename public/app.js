const state = {
  token: null,
  user: null,
  date: localDateString(new Date()),
  view: 'dashboard',
  tasks: [],
  rules: [],
  settings: {},
  habits: [],
  habitStats: [],
  habitMonth: new Date().toISOString().slice(0, 7),
  focusSessions: [],
  dashboard: null,
  reviewYear: 0,
  reviewWeek: 0,
  editingId: null,
  themeColor: '#1f6f5c',
  dragging: null,
  authMode: 'login',
  focus: { minutes: 25, remaining: 25 * 60, running: false, interval: null }
};

const THEME_PRESETS = [
  { id: 'emerald', name: '翡翠绿', color: '#1f6f5c' },
  { id: 'ocean', name: '海盐蓝', color: '#2563eb' },
  { id: 'coral', name: '珊瑚橙', color: '#e8622d' },
  { id: 'berry', name: '莓果红', color: '#c2415c' },
  { id: 'olive', name: '橄榄绿', color: '#6b7a3f' },
  { id: 'violet', name: '岩紫', color: '#7c5cbf' }
];

const $ = (selector) => document.querySelector(selector);

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return localDateString(date);
}

function dateLabel(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const isToday = dateString === localDateString(new Date());
  return `${month} 月 ${day} 日 ${weekdays[date.getDay()]}${isToday ? ' · 今天' : ''}`;
}

function timeLabel(minutes) {
  if (minutes === null || minutes === undefined) return '未排期';
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function durationLabel(minutes) {
  if (!minutes) return '';
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小时`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  return `${minutes} 分钟`;
}

function minutesToTime(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return '';
  const value = Number(minutes);
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function minutesFromTime(value) {
  if (!value) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function shadeColor(hex, percent) {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  const amount = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const num = parseInt(value, 16);
  return `rgba(${(num >> 16) & 0xff}, ${(num >> 8) & 0xff}, ${num & 0xff}, ${alpha})`;
}

function applyTheme(color) {
  state.themeColor = color;
  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  root.setProperty('--accent-soft', hexToRgba(color, 0.14));
  root.setProperty('--accent-dark', shadeColor(color, -12));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) {
    showLogin();
    throw new Error('请先登录');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `请求失败（HTTP ${response.status}）`);
  return data;
}

let toastTimer = null;
function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setButtonIcon(button, iconName, text) {
  button.innerHTML = `<i data-lucide="${iconName}"></i><span>${text}</span>`;
  refreshIcons();
}

/* Auth */
async function showLogin() {
  state.token = null;
  clearInterval(state.focus.interval);
  state.focus.running = false;
  state.focus.interval = null;
  localStorage.removeItem('dp_token');
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  await loadAuthUsers();
  refreshIcons();
}

function enterApp(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem('dp_token', token);
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  renderCurrentUser();
  loadSettings().then(() => switchView('dashboard'));
}

function renderCurrentUser() {
  const user = state.user;
  const initial = (user.display_name || user.username || '?').slice(0, 1);
  $('#sidebar-user-name').textContent = `@${user.username}`;
  $('#sidebar-user-display').textContent = user.display_name;
  $('#user-avatar').textContent = initial;
  $('#mobile-user-avatar').textContent = initial;
  $('#user-avatar').style.background = user.avatar_color || state.themeColor;
  $('#mobile-user-avatar').style.background = user.avatar_color || state.themeColor;
  $('#account-name').textContent = user.display_name;
  $('#account-username').textContent = user.username;
  $('#account-type').textContent = user.has_password ? '密码账号' : '免密档案';
  $('#settings-user-label').textContent = `${user.display_name} 的个人空间`;
}

async function loadAuthUsers() {
  try {
    const users = await fetch('/api/users').then((res) => res.json());
    const list = $('#auth-users');
    list.innerHTML = users.map((user) => `
      <button class="user-pill" data-username="${escapeHtml(user.username)}" data-has-password="${user.has_password}">
        <span class="avatar" style="background:${user.avatar_color}">${escapeHtml((user.display_name || '?').slice(0, 1))}</span>
        <span>${escapeHtml(user.display_name)}</span>
      </button>
    `).join('');
    refreshIcons();
  } catch {
    $('#auth-users').innerHTML = '';
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  $('#auth-tab-login').classList.toggle('active', mode === 'login');
  $('#auth-tab-register').classList.toggle('active', mode === 'register');
  $('#display-name-field').classList.toggle('hidden', mode !== 'register');
  $('#auth-submit').innerHTML = mode === 'register'
    ? '<i data-lucide="user-plus"></i><span>创建账号</span>'
    : '<i data-lucide="log-in"></i><span>进入</span>';
  refreshIcons();
}

async function submitAuth(event) {
  event.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const displayName = $('#auth-display-name').value.trim();
  if (!username) {
    toast('请输入用户名', 'error');
    return;
  }
  try {
    const body = state.authMode === 'register'
      ? { username, password, display_name: displayName || username }
      : { username, password };
    const result = await api('/api/auth/' + (state.authMode === 'register' ? 'register' : 'login'), {
      method: 'POST',
      body: JSON.stringify(body)
    });
    enterApp(result.user, result.token);
    toast(`欢迎，${result.user.display_name}`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function switchToUser(username, hasPassword) {
  if (hasPassword) {
    setAuthMode('login');
    $('#auth-username').value = username;
    $('#auth-password').focus();
    return;
  }
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: '' })
    });
    enterApp(result.user, result.token);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {}
  await showLogin();
}

/* Navigation */
function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });
  if (view === 'dashboard') loadDashboard();
  if (view === 'today') loadTasks();
  if (view === 'timeline') loadTasks().then(renderTimeline);
  if (view === 'habits') loadHabits();
  if (view === 'focus') loadFocus();
  if (view === 'review') loadReview();
  if (view === 'settings') {
    loadSettings();
    loadRules();
    loadAccessInfo();
    renderSettingsUsers();
  }
  refreshIcons();
}

/* Tasks */
async function loadTasks() {
  try {
    state.tasks = await api(`/api/tasks?date=${state.date}`);
    renderSummary();
    renderTaskList();
    renderTimeline();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function renderSummary() {
  const tasks = state.tasks;
  const done = tasks.filter((task) => task.status === 'done');
  const unscheduled = tasks.filter((task) => task.status !== 'done' && task.start_min === null);
  const totalMinutes = tasks.reduce((sum, task) => sum + (task.duration_min || 0), 0);
  $('#stat-total').textContent = tasks.length;
  $('#stat-done').textContent = done.length;
  $('#stat-unscheduled').textContent = unscheduled.length;
  $('#stat-duration').textContent = totalMinutes ? durationLabel(totalMinutes) : '0 分钟';
  $('#today-label').textContent = dateLabel(state.date);
  $('#task-date').value = state.date;
  $('#timeline-date').textContent = dateLabel(state.date);
}

function taskCard(task) {
  const meta = [
    `<span class="badge ${task.priority.toLowerCase()}">${task.priority}</span>`,
    `<span class="badge cat-${escapeHtml(task.category)}">${escapeHtml(task.category)}</span>`
  ];
  if (task.start_min !== null && task.start_min !== undefined) {
    const endMin = (task.start_min + (task.duration_min || 0)) % 1440;
    meta.push(`<span>${timeLabel(task.start_min)}${task.duration_min ? ` - ${timeLabel(endMin)}` : ''}</span>`);
  } else {
    meta.push('<span>待自动排程</span>');
  }
  if (task.duration_min) meta.push(`<span>${durationLabel(task.duration_min)}</span>`);
  return `
    <article class="task-item ${task.priority.toLowerCase()} ${task.status === 'done' ? 'done' : ''}" data-id="${task.id}">
      <button class="task-check ${task.status === 'done' ? 'done' : ''}" data-action="toggle" data-id="${task.id}" title="${task.status === 'done' ? '标记为未完成' : '标记为已完成'}">
        ${task.status === 'done' ? '<i data-lucide="check"></i>' : ''}
      </button>
      <div class="task-main">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <div class="task-meta">${meta.join('')}</div>
        ${task.note ? `<div class="task-note">${escapeHtml(task.note)}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="icon-btn" data-action="edit" data-id="${task.id}" title="编辑任务"><i data-lucide="pencil"></i></button>
        <button class="icon-btn" data-action="delete" data-id="${task.id}" title="删除任务"><i data-lucide="trash-2"></i></button>
      </div>
    </article>
  `;
}

function renderTaskList() {
  const list = $('#task-list');
  const visible = state.tasks;
  $('#task-count').textContent = `${visible.filter((task) => task.status === 'pending').length} 项待办`;
  $('#task-empty').style.display = visible.length ? 'none' : 'grid';
  list.innerHTML = visible.map(taskCard).join('');
  refreshIcons();
}

async function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  await api(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: task.status === 'done' ? 'pending' : 'done' })
  });
  await loadTasks();
  toast(task.status === 'done' ? '已恢复为待办' : '已完成');
}

function editTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  state.editingId = id;
  $('#task-id').value = id;
  $('#task-title').value = task.title;
  $('#task-date').value = task.date;
  $('#task-priority').value = task.priority;
  $('#task-category').value = task.category;
  $('#task-time').value = task.start_min === null || task.start_min === undefined ? '' : timeLabel(task.start_min);
  $('#task-duration').value = task.duration_min || '';
  $('#task-note').value = task.note || '';
  setButtonIcon($('#form-submit'), 'save', '保存修改');
  switchView('today');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteTask(id) {
  if (!confirm('确定删除这个任务吗？')) return;
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
  toast('任务已删除');
}

function formPayload() {
  return {
    title: $('#task-title').value.trim(),
    date: $('#task-date').value || state.date,
    priority: $('#task-priority').value,
    category: $('#task-category').value,
    start_min: minutesFromTime($('#task-time').value),
    duration_min: $('#task-duration').value ? Number($('#task-duration').value) : null,
    note: $('#task-note').value.trim()
  };
}

async function submitTask(event) {
  event.preventDefault();
  const payload = formPayload();
  if (!payload.title) {
    toast('请输入任务内容', 'error');
    return;
  }
  const submitButton = $('#form-submit');
  const original = submitButton.querySelector('span').textContent;
  submitButton.disabled = true;
  submitButton.querySelector('span').textContent = '保存中...';
  try {
    if (state.editingId) {
      await api(`/api/tasks/${state.editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('任务已更新');
    } else {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      toast('任务已添加');
    }
    clearTaskForm();
    await loadTasks();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span').textContent = original;
  }
}

function clearTaskForm() {
  state.editingId = null;
  $('#task-id').value = '';
  $('#task-form').reset();
  $('#task-date').value = state.date;
  setButtonIcon($('#form-submit'), 'plus', '添加任务');
}

async function autoSchedule(regenerate = false) {
  try {
    const result = await api('/api/schedule/auto', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, regenerate })
    });
    const message = `已排程 ${result.scheduled.length} 项` + (result.unscheduled.length ? `，${result.unscheduled.length} 项无空闲时段` : '');
    toast(message);
    await loadTasks();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function clearPendingTasks() {
  if (!confirm('确定清空所有待办任务吗？已完成的任务会保留。')) return;
  try {
    const result = await api('/api/tasks/clear', {
      method: 'POST',
      body: JSON.stringify({ scope: 'pending' })
    });
    toast(`已清空 ${result.count} 项待办任务`);
    await loadTasks();
    if (state.view === 'dashboard') loadDashboard();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* Timeline drag */
function renderTimeline() {
  const timeline = $('#timeline');
  if (!timeline) return;
  const startHour = 7;
  const endHour = 23;
  const totalMinutes = (endHour - startHour) * 60;
  const hourLines = [];
  for (let hour = startHour; hour <= endHour; hour += 1) {
    const top = ((hour - startHour) * 60 / totalMinutes) * 960;
    hourLines.push(`<div class="hour-line ${hour === startHour ? 'major' : ''}" style="top:${top}px"></div><div class="hour-label" style="top:${top}px">${pad(hour)}:00</div>`);
  }
  const blocks = state.tasks
    .filter((task) => task.start_min !== null && task.start_min !== undefined)
    .map((task) => {
      const top = ((task.start_min - startHour * 60) / totalMinutes) * 960;
      const height = Math.max(26, (task.duration_min || 30) / totalMinutes * 960);
      return `<div class="timeline-block block-${task.priority.toLowerCase()} ${task.status === 'done' ? 'done' : ''}" data-id="${task.id}" style="top:${top}px;height:${height}px"><strong>${escapeHtml(task.title)}</strong><span>${timeLabel(task.start_min)} · ${durationLabel(task.duration_min)}</span><div class="resize-handle" data-resize="true" title="拖动调整时长"></div></div>`;
    })
    .join('');
  timeline.innerHTML = hourLines.join('') + blocks;
  renderUnscheduled();
}

function renderUnscheduled() {
  const list = $('#unscheduled-list');
  if (!list) return;
  const unscheduled = state.tasks.filter((task) => task.status !== 'done' && task.start_min === null);
  $('#unscheduled-count').textContent = `${unscheduled.length} 项`;
  $('#unscheduled-panel').style.display = unscheduled.length ? '' : 'none';
  list.innerHTML = unscheduled.map(taskCard).join('');
  refreshIcons();
}

function snapMinute(value, min, max, step = 15) {
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

function handleTimelinePointerDown(event) {
  const block = event.target.closest('.timeline-block');
  if (!block || !state.tasks.some((task) => task.id === Number(block.dataset.id))) return;
  const timeline = $('#timeline');
  const task = state.tasks.find((item) => item.id === Number(block.dataset.id));
  const mode = event.target.closest('.resize-handle') ? 'resize' : 'move';
  const rect = timeline.getBoundingClientRect();
  const startMin = 7 * 60;
  const endMin = 23 * 60;
  const pixelsPerMinute = timeline.offsetHeight / (endMin - startMin);
  const duration = task.duration_min || 30;
  state.dragging = { id: task.id, mode, startY: event.clientY, originalStart: task.start_min, originalDuration: duration, startMin, endMin, pixelsPerMinute, moved: 0, block };
  block.classList.add('dragging');
  event.preventDefault();
  block.setPointerCapture?.(event.pointerId);

  const onMove = (moveEvent) => {
    const drag = state.dragging;
    if (!drag || drag.id !== task.id) return;
    const deltaMin = Math.round((moveEvent.clientY - drag.startY) / drag.pixelsPerMinute / 15) * 15;
    drag.moved = Math.max(drag.moved, Math.abs(moveEvent.clientY - drag.startY));
    if (drag.mode === 'move') {
      const newStart = snapMinute(drag.originalStart + deltaMin, drag.startMin, drag.endMin - drag.originalDuration);
      block.style.top = `${(newStart - drag.startMin) * drag.pixelsPerMinute}px`;
      block.dataset.pendingStart = newStart;
    } else {
      const newDuration = snapMinute(drag.originalDuration + deltaMin, 15, drag.endMin - drag.originalStart);
      block.style.height = `${newDuration * drag.pixelsPerMinute}px`;
      block.dataset.pendingDuration = newDuration;
    }
  };

  const onEnd = async () => {
    const drag = state.dragging;
    state.dragging = null;
    block.classList.remove('dragging');
    block.removeEventListener('pointermove', onMove);
    block.removeEventListener('pointerup', onEnd);
    block.removeEventListener('pointercancel', onEnd);
    if (!drag || drag.id !== task.id) return;
    if (drag.moved < 6 && drag.mode === 'move') {
      editTask(task.id);
      return;
    }
    const payload = drag.mode === 'move'
      ? { start_min: Number(block.dataset.pendingStart ?? drag.originalStart), duration_min: drag.originalDuration, locked: 1 }
      : { start_min: drag.originalStart, duration_min: Number(block.dataset.pendingDuration ?? drag.originalDuration), locked: 1 };
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast(drag.mode === 'move' ? '任务时间已更新' : '任务时长已更新');
      await loadTasks();
    } catch (error) {
      toast(error.message, 'error');
      await loadTasks();
    }
  };
  block.addEventListener('pointermove', onMove);
  block.addEventListener('pointerup', onEnd);
  block.addEventListener('pointercancel', onEnd);
}

/* Habits */
async function loadHabits() {
  try {
    const [habits, stats] = await Promise.all([
      api('/api/habits'),
      api(`/api/habits/stats?month=${state.habitMonth}`)
    ]);
    state.habits = habits;
    state.habitStats = stats;
    renderHabits();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function monthLabel(month) {
  const [year, mon] = month.split('-').map(Number);
  return `${year} 年 ${mon} 月`;
}

function renderHabits() {
  $('#habit-month-label').textContent = monthLabel(state.habitMonth);
  const list = $('#habit-list');
  const today = localDateString(new Date());
  list.innerHTML = state.habitStats.map((habit) => {
    const logs = new Set(habit.logs.map((log) => log.date));
    const daysInMonth = new Date(Number(habitMonthPart(0)), Number(habitMonthPart(1)), 0).getDate();
    const firstOffset = new Date(Number(habitMonthPart(0)), Number(habitMonthPart(1)) - 1, 1).getDay();
    const cells = [];
    for (let i = 0; i < firstOffset; i += 1) cells.push('<span class="mini-cell"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${state.habitMonth}-${pad(day)}`;
      cells.push(`<span class="mini-cell ${logs.has(date) ? 'on' : ''}" title="${date}"></span>`);
    }
    return `
      <article class="habit-card" data-id="${habit.id}">
        <div class="habit-head">
          <span class="habit-icon">${habit.icon === 'star' ? '⭐' : habit.icon === 'book' ? '📖' : habit.icon === 'run' ? '🏃' : habit.icon === 'water' ? '💧' : habit.icon === 'sleep' ? '😴' : '🧘'}</span>
          <strong>${escapeHtml(habit.name)}</strong>
          <button class="icon-btn" data-action="edit" data-id="${habit.id}" title="编辑"><i data-lucide="pencil"></i></button>
        </div>
        <div class="habit-stats">
          <span>本月 ${habit.month_count} 次</span>
          <span>连续 ${habit.current_streak} 天</span>
          <span>最长 ${habit.longest_streak} 天</span>
        </div>
        <div class="habit-mini-heatmap">${cells.join('')}</div>
        <div class="habit-actions">
          <button class="button ${logs.has(today) ? 'primary' : ''}" data-action="check" data-id="${habit.id}">${logs.has(today) ? '已打卡' : '今日打卡'}</button>
          <button class="button subtle" data-action="archive" data-id="${habit.id}">${habit.archived ? '恢复' : '归档'}</button>
          <button class="button subtle" data-action="delete" data-id="${habit.id}"><i data-lucide="trash-2"></i></button>
        </div>
      </article>
    `;
  }).join('') || '<div class="empty-state"><i data-lucide="repeat-2"></i><p>还没有习惯，先创建一个吧</p></div>';
  refreshIcons();
}

function habitMonthPart(index) {
  return state.habitMonth.split('-')[index];
}

function showHabitForm(habit = null) {
  $('#habit-form').classList.remove('hidden');
  $('#habit-id').value = habit?.id || '';
  $('#habit-name').value = habit?.name || '';
  $('#habit-icon').value = habit?.icon || 'star';
  $('#habit-color').value = habit?.color || state.themeColor;
}

async function saveHabit() {
  const payload = {
    name: $('#habit-name').value.trim(),
    icon: $('#habit-icon').value,
    color: $('#habit-color').value
  };
  try {
    const id = $('#habit-id').value;
    if (id) {
      await api(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('习惯已更新');
    } else {
      await api('/api/habits', { method: 'POST', body: JSON.stringify(payload) });
      toast('习惯已创建');
    }
    $('#habit-form').classList.add('hidden');
    await loadHabits();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleHabit(habitId) {
  const today = localDateString(new Date());
  const habit = state.habitStats.find((item) => item.id === habitId);
  const checked = habit?.logs.some((log) => log.date === today);
  try {
    if (checked) {
      await api(`/api/habits/${habitId}/checkin?date=${today}`, { method: 'DELETE' });
    } else {
      await api(`/api/habits/${habitId}/checkin`, { method: 'POST', body: JSON.stringify({ date: today }) });
    }
    await loadHabits();
    toast(checked ? '已取消打卡' : '打卡成功');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function archiveHabit(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  try {
    await api(`/api/habits/${habitId}`, { method: 'PATCH', body: JSON.stringify({ archived: habit?.archived ? 0 : 1 }) });
    await loadHabits();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteHabit(habitId) {
  if (!confirm('确定删除这个习惯和所有打卡记录吗？')) return;
  try {
    await api(`/api/habits/${habitId}`, { method: 'DELETE' });
    await loadHabits();
    toast('习惯已删除');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* Focus */
async function loadFocus() {
  try {
    const [sessions, tasks] = await Promise.all([
      api(`/api/focus/sessions?date=${state.date}`),
      api(`/api/tasks?date=${state.date}`)
    ]);
    state.focusSessions = sessions;
    const total = sessions.reduce((sum, item) => sum + item.minutes, 0);
    $('#focus-today-total').textContent = total ? durationLabel(total) : '0 分钟';
    $('#focus-sessions').innerHTML = sessions.map((item) => `
      <div class="focus-session-item">
        <div><strong>${durationLabel(item.minutes)}</strong><span>${new Date(item.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</span></div>
      </div>
    `).join('') || '<div class="empty-state"><p>今天还没有专注记录</p></div>';
    $('#focus-task').innerHTML = '<option value="">不关联任务</option>' + tasks
      .filter((task) => task.status === 'pending')
      .map((task) => `<option value="${task.id}">${escapeHtml(task.title)}</option>`)
      .join('');
    const weekStart = mondayOf(state.date);
    $('#focus-week-label').textContent = `本周从 ${weekStart} 开始`;
    refreshIcons();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function mondayOf(dateString) {
  const current = new Date(`${dateString}T00:00:00`);
  const day = current.getDay() || 7;
  current.setDate(current.getDate() - day + 1);
  return localDateString(current);
}

function renderTimer() {
  const minutes = Math.floor(state.focus.remaining / 60);
  const seconds = state.focus.remaining % 60;
  $('#timer-display').textContent = `${pad(minutes)}:${pad(seconds)}`;
  document.querySelectorAll('.timer-mode').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.minutes) === state.focus.minutes);
  });
}

function startFocus() {
  if (state.focus.running) return;
  const custom = Number($('#focus-custom').value);
  if (custom >= 1) {
    state.focus.minutes = custom;
    state.focus.remaining = custom * 60;
  }
  state.focus.running = true;
  $('#focus-start').disabled = true;
  $('#focus-pause').disabled = false;
  state.focus.interval = setInterval(() => {
    state.focus.remaining -= 1;
    if (state.focus.remaining <= 0) {
      completeFocus();
      return;
    }
    renderTimer();
  }, 1000);
  renderTimer();
}

function pauseFocus() {
  state.focus.running = false;
  clearInterval(state.focus.interval);
  state.focus.interval = null;
  $('#focus-start').disabled = false;
  $('#focus-pause').disabled = true;
}

function resetFocus() {
  pauseFocus();
  state.focus.remaining = state.focus.minutes * 60;
  renderTimer();
}

async function completeFocus() {
  pauseFocus();
  try {
    await api('/api/focus/sessions', {
      method: 'POST',
      body: JSON.stringify({
        date: localDateString(new Date()),
        minutes: state.focus.minutes,
        task_id: $('#focus-task').value ? Number($('#focus-task').value) : null,
        note: $('#focus-note').value.trim()
      })
    });
    toast(`完成 ${state.focus.minutes} 分钟专注`);
    $('#focus-note').value = '';
    state.focus.remaining = state.focus.minutes * 60;
    renderTimer();
    await loadFocus();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* Review */
function isoWeekNumber(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function currentReviewWeek() {
  const now = new Date();
  return { year: now.getFullYear(), week: isoWeekNumber(localDateString(now)) };
}

async function loadReview() {
  if (!state.reviewYear) {
    const current = currentReviewWeek();
    state.reviewYear = current.year;
    state.reviewWeek = current.week;
  }
  try {
    const [review, dashboard] = await Promise.all([
      api(`/api/reviews/${state.reviewYear}/${state.reviewWeek}`),
      api(`/api/stats/dashboard?date=${state.date}`)
    ]);
    $('#review-content').value = review.content || '';
    $('#review-week-label').textContent = `${state.reviewYear} 年第 ${state.reviewWeek} 周`;
    $('#review-summary').innerHTML = `
      <div class="stat-card"><span class="stat-label">今日完成率</span><strong>${dashboard.tasks.completion}%</strong></div>
      <div class="stat-card"><span class="stat-label">今日习惯</span><strong>${dashboard.habits.done_today}/${dashboard.habits.total}</strong></div>
      <div class="stat-card"><span class="stat-label">本周专注</span><strong>${durationLabel(dashboard.focus.week_minutes) || '0 分钟'}</strong></div>
    `;
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function shiftReviewWeek(delta) {
  let week = state.reviewWeek + delta;
  let year = state.reviewYear;
  if (week < 1) {
    week = 52;
    year -= 1;
  } else if (week > 52) {
    week = 1;
    year += 1;
  }
  state.reviewYear = year;
  state.reviewWeek = week;
  loadReview();
}

async function saveReview() {
  try {
    await api(`/api/reviews/${state.reviewYear}/${state.reviewWeek}`, {
      method: 'PUT',
      body: JSON.stringify({ content: $('#review-content').value })
    });
    toast('复盘已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* Dashboard */
async function loadDashboard() {
  try {
    state.dashboard = await api(`/api/stats/dashboard?date=${state.date}`);
    const data = state.dashboard;
    $('#dashboard-date').textContent = dateLabel(data.date);
    $('#dashboard-stats').innerHTML = `
      <div class="stat-card"><span class="stat-label">今日任务</span><strong>${data.tasks.done}/${data.tasks.total}</strong><small>${data.tasks.completion}% 完成</small></div>
      <div class="stat-card"><span class="stat-label">今日习惯</span><strong>${data.habits.done_today}/${data.habits.total}</strong><small>已完成打卡</small></div>
      <div class="stat-card"><span class="stat-label">今日专注</span><strong>${durationLabel(data.focus.today_minutes) || '0 分钟'}</strong><small>本周 ${durationLabel(data.focus.week_minutes) || '0 分钟'}</small></div>
      <div class="stat-card"><span class="stat-label">接下来</span><strong>${data.upcoming.length}</strong><small>项待办</small></div>
    `;
    $('#trend-chart').innerHTML = data.trend.map((day) => `
      <div class="trend-day">
        <span>${day.done}/${day.total}</span>
        <div class="trend-bar-wrap"><div class="trend-bar ${day.total && day.done === day.total ? 'done' : ''}" style="height:${day.total ? Math.max(6, (day.done / day.total) * 100) : 4}%"></div></div>
        <span>${day.date.slice(5)}</span>
      </div>
    `).join('');
    $('#dashboard-heatmap').innerHTML = renderHeatmap(data.habits.heatmap, state.habitMonth);
    $('#dashboard-upcoming').innerHTML = data.upcoming.map(taskCard).join('') || '<div class="empty-state"><p>接下来没有待办任务</p></div>';
    refreshIcons();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function renderHeatmap(heatmap, month) {
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const firstOffset = new Date(year, mon - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstOffset; i += 1) cells.push('<span class="heat-cell"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month}-${pad(day)}`;
    const count = heatmap[date] || 0;
    const level = count >= 4 ? 'l4' : count >= 3 ? 'l3' : count >= 2 ? 'l2' : count === 1 ? 'l1' : '';
    cells.push(`<span class="heat-cell ${level}" title="${date}：${count} 次"></span>`);
  }
  return cells.join('');
}

/* Settings */
async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
    $('#setting-day-start').value = minutesToTime(state.settings.day_start_min);
    $('#setting-day-end').value = minutesToTime(state.settings.day_end_min);
    $('#setting-lunch-start').value = minutesToTime(state.settings.lunch_start_min);
    $('#setting-lunch-end').value = minutesToTime(state.settings.lunch_end_min);
    const themeColor = state.settings.theme_color || '#1f6f5c';
    applyTheme(themeColor);
    $('#theme-color').value = themeColor;
    renderThemePresets(state.settings.theme_preset || 'emerald', themeColor);
    renderCurrentUser();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function renderThemePresets(activeId, color) {
  $('#theme-presets').innerHTML = THEME_PRESETS.map((preset) => {
    const active = preset.id === activeId || preset.color.toLowerCase() === String(color).toLowerCase();
    return `<button class="theme-swatch ${active ? 'active' : ''}" data-theme-id="${preset.id}" data-color="${preset.color}" style="background:${preset.color}" title="${preset.name}"></button>`;
  }).join('');
}

async function saveSettings() {
  const themeColor = $('#theme-color').value;
  const activePreset = THEME_PRESETS.find((preset) => preset.color.toLowerCase() === themeColor.toLowerCase());
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        day_start_min: minutesFromTime($('#setting-day-start').value) ?? 540,
        day_end_min: minutesFromTime($('#setting-day-end').value) ?? 1320,
        lunch_start_min: minutesFromTime($('#setting-lunch-start').value) ?? 720,
        lunch_end_min: minutesFromTime($('#setting-lunch-end').value) ?? 810,
        theme_color: themeColor,
        theme_preset: activePreset ? activePreset.id : 'custom'
      })
    });
    applyTheme(state.settings.theme_color || themeColor);
    renderThemePresets(state.settings.theme_preset || 'custom', state.settings.theme_color || themeColor);
    toast('设置已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadRules() {
  try {
    state.rules = await api('/api/rules');
    renderRules();
  } catch (error) {
    if (error.message !== '请先登录') toast(error.message, 'error');
  }
}

function renderRules() {
  $('#rule-list').innerHTML = state.rules.map((rule, index) => `
    <div class="rule-row" data-index="${index}">
      <input class="rule-keyword" value="${escapeHtml(rule.keyword)}" placeholder="关键词">
      <select class="rule-category">${['工作', '学习', '生活', '健康', '其他'].map((category) => `<option value="${category}" ${rule.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select>
      <input class="rule-duration" type="number" min="1" max="1440" value="${rule.duration_min}">
      <select class="rule-block">
        <option value="morning" ${rule.time_block === 'morning' ? 'selected' : ''}>上午</option>
        <option value="afternoon" ${rule.time_block === 'afternoon' ? 'selected' : ''}>下午</option>
        <option value="evening" ${rule.time_block === 'evening' ? 'selected' : ''}>晚上</option>
      </select>
      <input class="rule-start" type="time" value="${rule.start_min !== null && rule.start_min !== undefined ? minutesToTime(rule.start_min) : ''}">
      <input class="rule-end" type="time" value="${rule.end_min !== null && rule.end_min !== undefined ? minutesToTime(rule.end_min) : ''}">
      <input class="rule-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''} title="启用规则">
      <button class="icon-btn rule-delete" title="删除规则" type="button"><i data-lucide="trash-2"></i></button>
    </div>
  `).join('');
  refreshIcons();
}

function addRuleRow() {
  state.rules.push({ keyword: '', category: '其他', duration_min: 30, time_block: 'afternoon', start_min: null, end_min: null, enabled: 1 });
  renderRules();
}

function collectRules() {
  return Array.from(document.querySelectorAll('.rule-row')).map((row) => ({
    keyword: row.querySelector('.rule-keyword').value.trim(),
    category: row.querySelector('.rule-category').value,
    duration_min: Number(row.querySelector('.rule-duration').value),
    time_block: row.querySelector('.rule-block').value,
    start_min: minutesFromTime(row.querySelector('.rule-start').value),
    end_min: minutesFromTime(row.querySelector('.rule-end').value),
    enabled: row.querySelector('.rule-enabled').checked ? 1 : 0
  }));
}

async function saveRules() {
  try {
    state.rules = await api('/api/rules', { method: 'PUT', body: JSON.stringify(collectRules()) });
    renderRules();
    toast('规则已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadAccessInfo() {
  try {
    const info = await fetch('/api/info').then((res) => res.json());
    const urls = info.urls.length
      ? info.urls.map((url) => `<div><a href="${url}" target="_blank" rel="noopener">${url}</a></div>`).join('')
      : '<div>未检测到局域网地址</div>';
    $('#access-urls').innerHTML = `<div class="muted">电脑本机</div><div>http://localhost:${info.port}</div><div class="muted">手机访问</div>${urls}`;
  } catch {
    $('#access-urls').textContent = '无法获取访问地址';
  }
}

async function renderSettingsUsers() {
  try {
    const users = await fetch('/api/users').then((res) => res.json());
    $('#settings-users').innerHTML = users.map((user) => `
      <button class="user-pill" data-username="${escapeHtml(user.username)}" data-has-password="${user.has_password}">
        <span class="avatar" style="background:${user.avatar_color}">${escapeHtml((user.display_name || '?').slice(0, 1))}</span>
        <span>${escapeHtml(user.display_name)}${user.id === state.user?.id ? '（当前）' : ''}</span>
      </button>
    `).join('');
  } catch {}
}

async function downloadBackup(event) {
  event.preventDefault();
  try {
    const response = await fetch('/api/backup', { headers: { Authorization: `Bearer ${state.token}` } });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `daily-planner-backup-${localDateString(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    await api('/api/backup', { method: 'POST', body: text });
    toast('备份已导入');
    await loadTasks();
    await loadRules();
    await loadSettings();
    await loadHabits();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    event.target.value = '';
  }
}

/* Events */
function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  $('#auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  $('#auth-tab-register').addEventListener('click', () => setAuthMode('register'));
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#logout-button').addEventListener('click', logout);
  $('#settings-logout').addEventListener('click', logout);

  $('#auth-users').addEventListener('click', (event) => {
    const pill = event.target.closest('.user-pill');
    if (!pill) return;
    switchToUser(pill.dataset.username, pill.dataset.hasPassword === 'true');
  });
  $('#settings-users').addEventListener('click', (event) => {
    const pill = event.target.closest('.user-pill');
    if (!pill) return;
    switchToUser(pill.dataset.username, pill.dataset.hasPassword === 'true');
  });

  $('#menu-date-prev').addEventListener('click', () => { state.date = shiftDate(state.date, -1); loadTasks(); });
  $('#menu-date-next').addEventListener('click', () => { state.date = shiftDate(state.date, 1); loadTasks(); });
  $('#menu-date-today').addEventListener('click', () => { state.date = localDateString(new Date()); loadTasks(); });
  $('#task-form').addEventListener('submit', submitTask);
  $('#form-clear').addEventListener('click', clearTaskForm);
  $('#auto-schedule').addEventListener('click', () => autoSchedule($('#regenerate-check').checked));
  $('#clear-tasks').addEventListener('click', clearPendingTasks);
  $('#timeline-schedule').addEventListener('click', () => autoSchedule(true));
  $('#dashboard-schedule').addEventListener('click', () => autoSchedule(true));
  $('#timeline').addEventListener('pointerdown', handleTimelinePointerDown);

  const taskClick = async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'toggle') await toggleTask(id);
    if (button.dataset.action === 'edit') editTask(id);
    if (button.dataset.action === 'delete') await deleteTask(id);
  };
  $('#task-list').addEventListener('click', taskClick);
  $('#unscheduled-list').addEventListener('click', taskClick);
  $('#dashboard-upcoming').addEventListener('click', taskClick);

  $('#habit-add').addEventListener('click', () => showHabitForm());
  $('#habit-cancel').addEventListener('click', () => $('#habit-form').classList.add('hidden'));
  $('#habit-save').addEventListener('click', saveHabit);
  $('#habit-month-prev').addEventListener('click', () => shiftMonth(-1));
  $('#habit-month-next').addEventListener('click', () => shiftMonth(1));
  $('#habit-month-today').addEventListener('click', () => { state.habitMonth = new Date().toISOString().slice(0, 7); loadHabits(); });
  $('#habit-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'check') await toggleHabit(id);
    if (button.dataset.action === 'edit') showHabitForm(state.habits.find((item) => item.id === id));
    if (button.dataset.action === 'archive') await archiveHabit(id);
    if (button.dataset.action === 'delete') await deleteHabit(id);
  });

  $('#focus-start').addEventListener('click', startFocus);
  $('#focus-pause').addEventListener('click', pauseFocus);
  $('#focus-reset').addEventListener('click', resetFocus);
  document.querySelectorAll('.timer-mode').forEach((button) => {
    button.addEventListener('click', () => {
      state.focus.minutes = Number(button.dataset.minutes);
      state.focus.remaining = state.focus.minutes * 60;
      $('#focus-custom').value = state.focus.minutes;
      renderTimer();
    });
  });

  $('#review-prev').addEventListener('click', () => shiftReviewWeek(-1));
  $('#review-next').addEventListener('click', () => shiftReviewWeek(1));
  $('#review-current').addEventListener('click', () => {
    const current = currentReviewWeek();
    state.reviewYear = current.year;
    state.reviewWeek = current.week;
    loadReview();
  });
  $('#review-save').addEventListener('click', saveReview);

  $('#theme-presets').addEventListener('click', (event) => {
    const swatch = event.target.closest('.theme-swatch');
    if (!swatch) return;
    $('#theme-color').value = swatch.dataset.color;
    document.querySelectorAll('.theme-swatch').forEach((item) => item.classList.toggle('active', item === swatch));
    applyTheme(swatch.dataset.color);
  });
  $('#theme-save').addEventListener('click', saveSettings);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#rule-add').addEventListener('click', addRuleRow);
  $('#rule-save').addEventListener('click', saveRules);
  $('#rule-list').addEventListener('click', (event) => {
    const button = event.target.closest('.rule-delete');
    if (!button) return;
    const row = button.closest('.rule-row');
    state.rules.splice(Number(row.dataset.index), 1);
    renderRules();
  });
  $('#backup-export').addEventListener('click', downloadBackup);
  $('#backup-import').addEventListener('change', importBackup);

  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (['today', 'timeline', 'dashboard'].includes(state.view)) loadTasks().catch(() => {});
    if (state.view === 'settings') renderSettingsUsers();
  }, 30000);
}

function shiftMonth(delta) {
  const [year, month] = state.habitMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  state.habitMonth = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  loadHabits();
}

async function init() {
  bindEvents();
  const token = localStorage.getItem('dp_token');
  if (token) {
    state.token = token;
    try {
      const user = await api('/api/auth/me');
      enterApp(user, token);
      return;
    } catch {
      showLogin();
      return;
    }
  }
  showLogin();
}

init();
