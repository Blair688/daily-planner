const state = {
  date: localDateString(new Date()),
  view: 'today',
  tasks: [],
  rules: [],
  settings: {},
  editingId: null,
  discovered: null,
  themeColor: '#1f6f5c',
  dragging: null
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
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${pad(hour)}:${pad(minute)}`;
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

function looksLikeAppPassword(value) {
  return /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(String(value || '').trim());
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
  const response = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `请求失败（HTTP ${response.status}）`);
  }
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

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === `view-${view}`);
  });
  if (view === 'today') loadTasks();
  if (view === 'timeline') renderTimeline();
  if (view === 'settings') {
    loadSettings();
    loadRules();
    loadAccessInfo();
    loadSyncStatus();
  }
  refreshIcons();
}

async function loadTasks() {
  try {
    state.tasks = await api(`/api/tasks?date=${state.date}`);
    renderSummary();
    renderTaskList();
    renderTimeline();
  } catch (error) {
    toast(error.message, 'error');
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
  if (task.sync_calendar) meta.push('<span>日历</span>');
  if (task.sync_reminder) meta.push('<span>提醒</span>');

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
        <button class="icon-btn" data-action="edit" data-id="${task.id}" title="编辑任务">
          <i data-lucide="pencil"></i>
        </button>
        <button class="icon-btn" data-action="delete" data-id="${task.id}" title="删除任务">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </article>
  `;
}

function renderTaskList() {
  const list = $('#task-list');
  const visible = state.tasks.filter((task) => task.status !== 'done' || task.date === state.date);
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
  toast(task.status === 'done' ? '已恢复为待办' : '已完成，等待同步');
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
  $('#task-sync-calendar').checked = Boolean(task.sync_calendar);
  $('#task-sync-reminder').checked = Boolean(task.sync_reminder);
  $('#form-submit span').textContent = '保存修改';
  $('#form-submit i').setAttribute('data-lucide', 'save');
  refreshIcons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteTask(id) {
  if (!confirm('确定删除这个任务吗？同步到 iCloud 的内容也会被删除。')) return;
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  await loadTasks();
  toast('任务已删除');
}

function minutesFromTime(value) {
  if (!value) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function formPayload() {
  return {
    title: $('#task-title').value.trim(),
    date: $('#task-date').value || state.date,
    priority: $('#task-priority').value,
    category: $('#task-category').value,
    start_min: minutesFromTime($('#task-time').value),
    duration_min: $('#task-duration').value ? Number($('#task-duration').value) : null,
    note: $('#task-note').value.trim(),
    sync_calendar: $('#task-sync-calendar').checked,
    sync_reminder: $('#task-sync-reminder').checked
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
  const originalText = submitButton.querySelector('span').textContent;
  submitButton.disabled = true;
  submitButton.querySelector('span').textContent = '保存中...';
  try {
    if (state.editingId) {
      await api(`/api/tasks/${state.editingId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      toast('任务已更新');
    } else {
      await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('任务已添加');
    }
    clearTaskForm();
    await loadTasks();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector('span').textContent = state.editingId ? '保存修改' : originalText;
  }
}

function clearTaskForm() {
  state.editingId = null;
  $('#task-id').value = '';
  $('#task-form').reset();
  $('#task-date').value = state.date;
  $('#task-sync-calendar').checked = true;
  $('#task-sync-reminder').checked = false;
  $('#form-submit span').textContent = '添加任务';
  $('#form-submit i').setAttribute('data-lucide', 'plus');
  refreshIcons();
}

async function autoSchedule(regenerate = false) {
  try {
    const result = await api('/api/schedule/auto', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, regenerate })
    });
    const scheduledCount = result.scheduled.length;
    const message = `已排程 ${scheduledCount} 项` + (result.unscheduled.length ? `，${result.unscheduled.length} 项无空闲时段` : '');
    toast(message, result.unscheduled.length ? '' : '');
    await loadTasks();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderTimeline() {
  const timeline = $('#timeline');
  if (!timeline) return;
  const startHour = 7;
  const endHour = 23;
  const totalMinutes = (endHour - startHour) * 60;
  const hourLines = [];
  for (let hour = startHour; hour <= endHour; hour += 1) {
    const top = ((hour - startHour) * 60 / totalMinutes) * 960;
    hourLines.push(`
      <div class="hour-line ${hour === startHour ? 'major' : ''}" style="top:${top}px"></div>
      <div class="hour-label" style="top:${top}px">${pad(hour)}:00</div>
    `);
  }

  const blocks = state.tasks
    .filter((task) => task.start_min !== null && task.start_min !== undefined)
    .map((task) => {
      const top = ((task.start_min - startHour * 60) / totalMinutes) * 960;
      const height = Math.max(26, (task.duration_min || 30) / totalMinutes * 960);
      return `
        <div class="timeline-block block-${task.priority.toLowerCase()} ${task.status === 'done' ? 'done' : ''}" data-id="${task.id}" style="top:${top}px;height:${height}px">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${timeLabel(task.start_min)} · ${durationLabel(task.duration_min)}</span>
          <div class="resize-handle" data-resize="true" title="拖动调整时长"></div>
        </div>
      `;
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

  state.dragging = {
    id: task.id,
    mode,
    startY: event.clientY,
    originalStart: task.start_min,
    originalDuration: duration,
    startMin,
    endMin,
    pixelsPerMinute,
    moved: 0,
    block
  };

  block.classList.add('dragging');
  event.preventDefault();
  block.setPointerCapture?.(event.pointerId);

  const onMove = (moveEvent) => {
    const drag = state.dragging;
    if (!drag || drag.id !== task.id) return;
    const deltaMin = Math.round((moveEvent.clientY - drag.startY) / drag.pixelsPerMinute / 15) * 15;
    drag.moved = Math.max(drag.moved, Math.abs(moveEvent.clientY - drag.startY));

    if (drag.mode === 'move') {
      const newStart = snapMinute(
        drag.originalStart + deltaMin,
        drag.startMin,
        drag.endMin - drag.originalDuration
      );
      block.style.top = `${(newStart - drag.startMin) * drag.pixelsPerMinute}px`;
      block.dataset.pendingStart = newStart;
    } else {
      const newDuration = snapMinute(
        drag.originalDuration + deltaMin,
        15,
        drag.endMin - drag.originalStart
      );
      block.style.height = `${newDuration * drag.pixelsPerMinute}px`;
      block.dataset.pendingDuration = newDuration;
    }
  };

  const onEnd = async (endEvent) => {
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

    const payload =
      drag.mode === 'move'
        ? {
            start_min: Number(block.dataset.pendingStart ?? drag.originalStart),
            duration_min: drag.originalDuration,
            locked: 1
          }
        : {
            start_min: drag.originalStart,
            duration_min: Number(block.dataset.pendingDuration ?? drag.originalDuration),
            locked: 1
          };
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
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

async function loadSettings() {
  try {
    state.settings = await api('/api/settings');
    $('#setting-apple-id').value = state.settings.apple_id || '';
    $('#setting-interval').value = state.settings.sync_interval_min || '10';
    $('#setting-day-start').value = minutesToTime(state.settings.day_start_min);
    $('#setting-day-end').value = minutesToTime(state.settings.day_end_min);
    $('#setting-lunch-start').value = minutesToTime(state.settings.lunch_start_min);
    $('#setting-lunch-end').value = minutesToTime(state.settings.lunch_end_min);
    $('#setting-calendar-enabled').checked = state.settings.sync_calendar_enabled === '1';
    $('#setting-reminder-enabled').checked = state.settings.sync_reminder_enabled === '1';
    $('#setting-calendar-href').value = state.settings.calendar_href || '';
    $('#setting-reminder-href').value = state.settings.reminder_href || '';
    const themeColor = state.settings.theme_color || '#1f6f5c';
    applyTheme(themeColor);
    $('#theme-color').value = themeColor;
    renderThemePresets(state.settings.theme_preset || 'emerald', themeColor);
    updateSyncStatus(state.settings);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderThemePresets(activeId, color) {
  $('#theme-presets').innerHTML = THEME_PRESETS.map((preset) => {
    const active = preset.id === activeId || preset.color.toLowerCase() === String(color).toLowerCase();
    return `
      <button class="theme-swatch ${active ? 'active' : ''}" data-theme-id="${preset.id}" data-color="${preset.color}"
        style="background:${preset.color}" title="${preset.name}"></button>
    `;
  }).join('');
}

function updateSyncStatus(settings) {
  const dot = $('#sync-status');
  const status = settings.last_sync_status || '';
  dot.className = `status-dot ${status === 'ok' ? 'ok' : status === 'error' ? 'error' : ''}`;
  $('#sync-last-at').textContent = settings.last_sync_at ? new Date(settings.last_sync_at).toLocaleString('zh-CN') : '尚未同步';
  $('#sync-last-status').textContent = status === 'ok' ? '成功' : status === 'error' ? '失败' : '未配置';
  $('#sync-last-message').textContent = settings.last_sync_message || '-';
}

async function testConnection() {
  const appleId = $('#setting-apple-id').value.trim();
  const appPassword = $('#setting-app-password').value;
  const resultBox = $('#connection-result');
  resultBox.className = 'result-box';
  resultBox.textContent = '正在连接 iCloud...';
  if (appPassword && !looksLikeAppPassword(appPassword)) {
    toast('提示：当前密码格式不像 App 专用密码，可能无法连接', '');
  }
  try {
    const result = await api('/api/settings/test-connection', {
      method: 'POST',
      body: JSON.stringify({ apple_id: appleId, app_password: appPassword })
    });
    state.discovered = result;
    fillCollectionSelects(result);
    resultBox.className = 'result-box success';
    const reminderHint =
      result.reminderLists && result.reminderLists.length === 0
        ? '\n未发现提醒列表：请先在 iPhone 的“提醒事项”中新建一个列表，然后重新测试。'
        : '';
    resultBox.textContent = result.message + reminderHint;
    toast('连接成功');
  } catch (error) {
    resultBox.className = 'result-box error';
    resultBox.textContent = error.message;
  }
}

function fillCollectionSelects(discovered) {
  const calendarSelect = $('#setting-calendar-href');
  calendarSelect.innerHTML = (discovered.calendars || []).map(
    (calendar) => `<option value="${escapeHtml(calendar.href)}">${escapeHtml(calendar.displayName)}</option>`
  ).join('');
  if (state.settings.calendar_href) calendarSelect.value = state.settings.calendar_href;

  const reminderSelect = $('#setting-reminder-href');
  reminderSelect.innerHTML = (discovered.reminderLists || []).map(
    (list) => `<option value="${escapeHtml(list.href)}">${escapeHtml(list.displayName)}</option>`
  ).join('');
  if (state.settings.reminder_href) reminderSelect.value = state.settings.reminder_href;
  refreshIcons();
}

async function saveSettings() {
  const themeColor = $('#theme-color').value;
  const appPassword = $('#setting-app-password').value;
  if (appPassword && !looksLikeAppPassword(appPassword)) {
    toast('提示：当前密码格式不像 App 专用密码，建议在 appleid.apple.com 重新生成', '');
  }
  const activePreset = THEME_PRESETS.find(
    (preset) => preset.color.toLowerCase() === themeColor.toLowerCase()
  );
  const payload = {
    apple_id: $('#setting-apple-id').value.trim(),
    app_password: appPassword,
    sync_interval_min: Number($('#setting-interval').value),
    sync_calendar_enabled: $('#setting-calendar-enabled').checked,
    sync_reminder_enabled: $('#setting-reminder-enabled').checked,
    calendar_href: $('#setting-calendar-href').value,
    reminder_href: $('#setting-reminder-href').value,
    day_start_min: minutesFromTime($('#setting-day-start').value) ?? 540,
    day_end_min: minutesFromTime($('#setting-day-end').value) ?? 1320,
    lunch_start_min: minutesFromTime($('#setting-lunch-start').value) ?? 720,
    lunch_end_min: minutesFromTime($('#setting-lunch-end').value) ?? 810,
    theme_color: themeColor,
    theme_preset: activePreset ? activePreset.id : 'custom'
  };
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    applyTheme(state.settings.theme_color || themeColor);
    renderThemePresets(state.settings.theme_preset || 'custom', state.settings.theme_color || themeColor);
    $('#setting-app-password').value = '';
    updateSyncStatus(state.settings);
    toast('设置已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function diagnoseConnection() {
  const box = $('#diagnose-result');
  box.className = 'result-box';
  box.textContent = '正在检测到 caldav.icloud.com 的网络连接...';
  try {
    const result = await api('/api/sync/diagnose', { method: 'POST' });
    box.className = `result-box ${result.ok ? 'success' : 'error'}`;
    box.textContent = [
      result.message,
      `DNS：${result.dns.ok ? '正常' : '失败'}（${result.dns.addresses.join(', ') || result.dns.error || '-'}）`,
      `TCP 443：${result.tcp.ok ? '正常' : '失败'}${result.tcp.error ? `（${result.tcp.error}）` : ''}`,
      `HTTPS：${result.https.ok ? `正常（${result.https.status}）` : `失败（${result.https.error || '-'}）`}`
    ].join('\n');
  } catch (error) {
    box.className = 'result-box error';
    box.textContent = error.message;
  }
}

async function manualSync() {
  try {
    const result = await api('/api/sync', { method: 'POST' });
    toast(result.message || '同步完成', result.ok ? '' : 'error');
    await loadSyncStatus();
    if (state.view === 'today') await loadTasks();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadSyncStatus() {
  try {
    const status = await api('/api/sync/status');
    $('#sync-last-at').textContent = status.last_sync_at ? new Date(status.last_sync_at).toLocaleString('zh-CN') : '尚未同步';
    $('#sync-last-status').textContent = status.last_sync_status === 'ok' ? '成功' : status.last_sync_status === 'error' ? '失败' : '未配置';
    $('#sync-last-message').textContent = status.last_sync_message || '-';
    const dot = $('#sync-status');
    dot.className = `status-dot ${status.last_sync_status === 'ok' ? 'ok' : status.last_sync_status === 'error' ? 'error' : ''}`;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadRules() {
  try {
    state.rules = await api('/api/rules');
    renderRules();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderRules() {
  $('#rule-list').innerHTML = state.rules.map((rule, index) => `
    <div class="rule-row" data-index="${index}">
      <input class="rule-keyword" value="${escapeHtml(rule.keyword)}" placeholder="关键词">
      <select class="rule-category">
        ${['工作', '学习', '生活', '健康', '其他'].map((category) => `<option value="${category}" ${rule.category === category ? 'selected' : ''}>${category}</option>`).join('')}
      </select>
      <input class="rule-duration" type="number" min="1" max="1440" value="${rule.duration_min}">
      <select class="rule-block">
        <option value="morning" ${rule.time_block === 'morning' ? 'selected' : ''}>上午</option>
        <option value="afternoon" ${rule.time_block === 'afternoon' ? 'selected' : ''}>下午</option>
        <option value="evening" ${rule.time_block === 'evening' ? 'selected' : ''}>晚上</option>
      </select>
      <input class="rule-start" type="time" value="${rule.start_min !== null && rule.start_min !== undefined ? minutesToTime(rule.start_min) : ''}">
      <input class="rule-end" type="time" value="${rule.end_min !== null && rule.end_min !== undefined ? minutesToTime(rule.end_min) : ''}">
      <input class="rule-enabled" type="checkbox" ${rule.enabled ? 'checked' : ''} title="启用规则">
      <button class="icon-btn rule-delete" title="删除规则" type="button">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `).join('');
  refreshIcons();
}

function addRuleRow() {
  state.rules.push({
    keyword: '',
    category: '其他',
    duration_min: 30,
    time_block: 'afternoon',
    start_min: null,
    end_min: null,
    enabled: 1
  });
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
    state.rules = await api('/api/rules', {
      method: 'PUT',
      body: JSON.stringify(collectRules())
    });
    renderRules();
    toast('规则已保存');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function loadAccessInfo() {
  try {
    const info = await api('/api/info');
    const urls = info.urls.length
      ? info.urls.map((url) => `<div><a href="${url}" target="_blank" rel="noopener">${url}</a></div>`).join('')
      : '<div>未检测到局域网地址</div>';
    $('#access-urls').innerHTML = `<div class="muted">电脑本机</div><div>http://localhost:${info.port}</div><div class="muted">iPhone 同一 Wi-Fi</div>${urls}<div class="muted">远程访问请使用 Tailscale 分配的地址</div>`;
  } catch (error) {
    toast(error.message, 'error');
  }
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  $('#menu-date-prev').addEventListener('click', () => {
    state.date = shiftDate(state.date, -1);
    loadTasks();
  });
  $('#menu-date-next').addEventListener('click', () => {
    state.date = shiftDate(state.date, 1);
    loadTasks();
  });
  $('#menu-date-today').addEventListener('click', () => {
    state.date = localDateString(new Date());
    loadTasks();
  });

  $('#task-form').addEventListener('submit', submitTask);
  $('#form-clear').addEventListener('click', clearTaskForm);
  $('#auto-schedule').addEventListener('click', () => autoSchedule($('#regenerate-check').checked));
  $('#timeline-schedule').addEventListener('click', () => autoSchedule(true));
  $('#timeline').addEventListener('pointerdown', handleTimelinePointerDown);

  $('#task-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'toggle') await toggleTask(id);
    if (button.dataset.action === 'edit') editTask(id);
    if (button.dataset.action === 'delete') await deleteTask(id);
  });

  $('#unscheduled-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    if (button.dataset.action === 'toggle') await toggleTask(id);
    if (button.dataset.action === 'edit') editTask(id);
    if (button.dataset.action === 'delete') await deleteTask(id);
  });

  $('#test-connection').addEventListener('click', testConnection);
  $('#diagnose-connection').addEventListener('click', diagnoseConnection);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#theme-save').addEventListener('click', saveSettings);
  $('#manual-sync').addEventListener('click', manualSync);
  $('#sync-button').addEventListener('click', manualSync);

  $('#theme-presets').addEventListener('click', (event) => {
    const swatch = event.target.closest('.theme-swatch');
    if (!swatch) return;
    $('#theme-color').value = swatch.dataset.color;
    document.querySelectorAll('.theme-swatch').forEach((item) => item.classList.toggle('active', item === swatch));
    applyTheme(swatch.dataset.color);
  });

  $('#rule-add').addEventListener('click', addRuleRow);
  $('#rule-save').addEventListener('click', saveRules);
  $('#rule-list').addEventListener('click', (event) => {
    const button = event.target.closest('.rule-delete');
    if (!button) return;
    const row = button.closest('.rule-row');
    const index = Number(row.dataset.index);
    state.rules.splice(index, 1);
    renderRules();
  });

  $('#backup-import').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await api('/api/backup', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('备份已导入');
      await loadTasks();
      await loadRules();
      await loadSettings();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });
}

async function init() {
  bindEvents();
  clearTaskForm();
  await loadTasks();
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (state.view === 'today' || state.view === 'timeline') loadTasks();
    if (state.view === 'settings') loadSyncStatus();
  }, 30000);
  refreshIcons();
}

init();
