const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { XMLParser } = require('fast-xml-parser');
const ical = require('node-ical');
const { nowIso } = require('./db');

const BASE_URL = 'https://caldav.icloud.com/';
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  removeNSPrefix: false
});

class CalDavError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function friendlySyncError(error) {
  if (error instanceof CalDavError) {
    if (error.status === 401) {
      return 'iCloud 认证失败（401）：请检查 Apple ID，并确认使用的是 App 专用密码（在 appleid.apple.com 生成），而不是 Apple ID 登录密码';
    }
    if (error.status === 403) {
      return 'iCloud 拒绝了操作（403）：请确认 iCloud 日历和提醒事项已开启，并使用 App 专用密码';
    }
    return `iCloud 请求失败（HTTP ${error.status}）：${error.message}`;
  }
  const cause = error?.cause || error;
  const code = cause?.code || cause?.errno;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return '无法解析 caldav.icloud.com，请检查网络连接和 DNS 设置';
  }
  if (['ECONNREFUSED', 'EACCES', 'EPERM', 'EADDRNOTAVAIL'].includes(code)) {
    return '系统或防火墙拦截了到 caldav.icloud.com 的连接，请放行网络后重试';
  }
  if (code === 'ETIMEDOUT') {
    return '连接 iCloud 超时，请检查网络后重试';
  }
  const message = error?.message || String(error);
  if (message === 'fetch failed') {
    return '无法连接到 iCloud（fetch failed）。请在设置页点击“同步诊断”查看网络状态';
  }
  return message;
}

async function diagnoseConnection() {
  const host = 'caldav.icloud.com';
  const port = 443;
  const dnsResult = { ok: false, addresses: [] };
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    dnsResult.ok = records.length > 0;
    dnsResult.addresses = records.map((record) => record.address);
  } catch (error) {
    dnsResult.error = friendlySyncError(error);
  }

  const tcpResult = { ok: false };
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host, port, timeout: 5000 });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('timeout'));
      });
      socket.once('error', reject);
    });
    tcpResult.ok = true;
  } catch (error) {
    tcpResult.error = friendlySyncError(error);
  }

  const httpsResult = { ok: false };
  try {
    const response = await fetch(`https://${host}/`, { method: 'HEAD', redirect: 'manual' });
    httpsResult.ok = response.status < 500;
    httpsResult.status = response.status;
  } catch (error) {
    httpsResult.error = friendlySyncError(error);
  }

  const ok = dnsResult.ok && tcpResult.ok && httpsResult.ok;
  const message = ok
    ? '网络连接正常，可以访问 iCloud'
    : '网络连接异常。请检查电脑网络、防火墙，或改用非受限终端启动服务';
  return { host, port, ok, message, dns: dnsResult, tcp: tcpResult, https: httpsResult };
}

function keyName(key) {
  return String(key).split(':').pop().toLowerCase();
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findNode(item, predicate);
        if (found) return found;
      }
    } else {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function findNodeByKey(node, suffix) {
  return findNode(node, (candidate) =>
    candidate && typeof candidate === 'object'
      ? Object.keys(candidate).some((key) => keyName(key) === String(suffix).toLowerCase())
      : false
  );
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') return textOf(value['#text'] ?? value.text ?? '');
  return String(value).trim();
}

function firstHref(node) {
  const hrefNode = findNodeByKey(node, 'href');
  if (!hrefNode) return '';
  const key = Object.keys(hrefNode).find((k) => keyName(k) === 'href');
  const value = hrefNode[key];
  if (Array.isArray(value)) return textOf(value[0]);
  return textOf(value);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function childValues(node, suffix) {
  if (!node || typeof node !== 'object') return [];
  const values = [];
  for (const key of Object.keys(node)) {
    if (keyName(key) === suffix) {
      values.push(...asArray(node[key]));
    } else {
      values.push(...childValues(node[key], suffix));
    }
  }
  return values;
}

function compNames(node) {
  const set = findNodeByKey(node, 'supported-calendar-component-set');
  if (!set) return [];
  const names = [];
  for (const key of Object.keys(set)) {
    if (keyName(key) !== 'comp') continue;
    const comp = set[key];
    for (const item of asArray(comp)) {
      if (item && typeof item === 'object' && item['@_name']) names.push(item['@_name'].toUpperCase());
    }
  }
  return names;
}

function resolveUrl(pathOrUrl) {
  try {
    return new URL(pathOrUrl, BASE_URL).toString();
  } catch {
    return pathOrUrl;
  }
}

function itemHrefFor(collectionHref, uid) {
  const base = collectionHref.endsWith('/') ? collectionHref : `${collectionHref}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}

async function davRequest(settings, method, pathOrUrl, options = {}) {
  const { body, depth, contentType = 'application/xml; charset=utf-8' } = options;
  const auth = Buffer.from(`${settings.apple_id}:${settings.app_password}`, 'utf8').toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    'User-Agent': 'Daily-Planner/1.0',
    Accept: 'application/xml, text/calendar'
  };
  if (contentType) headers['Content-Type'] = contentType;
  if (depth !== undefined) headers.Depth = String(depth);
  const extraHeaders = options.headers || {};
  Object.assign(headers, extraHeaders);

  const response = await fetch(resolveUrl(pathOrUrl), {
    method,
    headers,
    body: body || undefined
  });
  const text = await response.text();
  if (!response.ok) {
    throw new CalDavError(`CalDAV ${method} ${pathOrUrl} 失败：HTTP ${response.status}`, response.status, text);
  }
  return { status: response.status, headers: response.headers, text };
}

async function findPrincipal(settings) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`;
  const result = await davRequest(settings, 'PROPFIND', '', { body, depth: 0 });
  const xml = xmlParser.parse(result.text);
  const principal = findNodeByKey(xml, 'current-user-principal');
  const href = principal ? firstHref(principal) : '';
  if (!href) throw new CalDavError('无法从 iCloud 发现当前用户身份', 0, result.text);
  return href;
}

async function findHome(settings, principalHref) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;
  const result = await davRequest(settings, 'PROPFIND', principalHref, { body, depth: 0 });
  const xml = xmlParser.parse(result.text);
  const home = findNodeByKey(xml, 'calendar-home-set');
  const href = home ? firstHref(home) : '';
  if (!href) throw new CalDavError('无法发现 iCloud 日历目录', 0, result.text);
  return href;
}

async function discoverCollections(settings) {
  const principal = await findPrincipal(settings);
  const home = await findHome(settings, principal);
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;
  const result = await davRequest(settings, 'PROPFIND', home, { body, depth: 1 });
  const xml = xmlParser.parse(result.text);
  const collections = [];

  for (const response of childValues(xml, 'response')) {
    const href = firstHref(response);
    if (!href) continue;
    const typeNode = findNodeByKey(response, 'resourcetype');
    const isCalendar = typeNode && Object.keys(typeNode).some((key) => keyName(key) === 'calendar');
    if (!isCalendar) continue;

    const displayNode = findNodeByKey(response, 'displayname');
    const displayKey = displayNode ? Object.keys(displayNode).find((key) => keyName(key) === 'displayname') : null;
    const displayName = displayKey ? textOf(displayNode[displayKey]) : href;
    const components = compNames(response);
    const isReminder = components.includes('VTODO');

    collections.push({
      href: resolveUrl(href),
      displayName: displayName || href,
      components,
      kind: isReminder ? 'reminder' : 'calendar'
    });
  }

  return {
    home,
    calendars: collections.filter((collection) => collection.kind === 'calendar'),
    reminderLists: collections.filter((collection) => collection.kind === 'reminder')
  };
}

async function ensureCalendar(settings, displayName = '日常规划') {
  const discovered = await discoverCollections(settings);
  const existing = discovered.calendars.find(
    (calendar) => calendar.displayName === displayName || calendar.href === settings.calendar_href
  );
  if (existing) return { ...existing, home: discovered.home };

  const home = discovered.home.endsWith('/') ? discovered.home : `${discovered.home}/`;
  const newHref = `${home}daily-planner-${crypto.randomUUID()}/`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:set>
    <d:prop>
      <d:displayname>${escapeXml(displayName)}</d:displayname>
      <c:supported-calendar-component-set>
        <c:comp name="VEVENT"/>
      </c:supported-calendar-component-set>
    </d:prop>
  </d:set>
</c:mkcalendar>`;
  const result = await davRequest(settings, 'MKCALENDAR', newHref, { body });
  if (result.status >= 200 && result.status < 300) {
    return {
      href: resolveUrl(newHref),
      displayName,
      components: ['VEVENT'],
      kind: 'calendar',
      home: discovered.home
    };
  }
  throw new CalDavError('无法在 iCloud 创建“日常规划”日历，请选择已有日历', result.status, result.text);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeIcs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function pad(num) {
  return String(num).padStart(2, '0');
}

function toIcsDate(date, minutes) {
  return `${date.replace(/-/g, '')}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function toIcsDateOnly(date) {
  return date.replace(/-/g, '');
}

function nextDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(year, month - 1, day + 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function isDateOnly(ics, prop) {
  return new RegExp(`^${prop}(;[^:\\n]*)?:([0-9]{8})(\\r?\\n|$)`, 'm').test(ics);
}

function foldIcsLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  for (let i = 0; i < line.length; i += 75) chunks.push(line.slice(i, i + 75));
  return chunks.join('\r\n ');
}

function icsLines(lines) {
  return lines.map(foldIcsLine).join('\r\n');
}

function buildEventIcs(task, uid) {
  const date = task.date;
  const status = task.status === 'done' ? 'CANCELLED' : 'CONFIRMED';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Planner//CN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `SUMMARY:${escapeIcs(task.title)}`,
    `STATUS:${status}`,
    `CATEGORIES:${escapeIcs(task.category)}`
  ];

  if (task.start_min !== null && task.start_min !== undefined) {
    const endMin = (task.start_min + (task.duration_min || 30)) % 1440;
    lines.push(`DTSTART:${toIcsDate(task.date, task.start_min)}`);
    lines.push(`DTEND:${toIcsDate(task.date, endMin)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDateOnly(task.date)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcsDateOnly(nextDate(task.date))}`);
  }

  if (task.note) lines.push(`DESCRIPTION:${escapeIcs(task.note)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return icsLines(lines);
}

function buildReminderIcs(task, uid) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Planner//CN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `SUMMARY:${escapeIcs(task.title)}`,
    `STATUS:${task.status === 'done' ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    `CATEGORIES:${escapeIcs(task.category)}`
  ];

  if (task.start_min !== null && task.start_min !== undefined) {
    lines.push(`DTSTART:${toIcsDate(task.date, task.start_min)}`);
    lines.push(`DUE:${toIcsDate(task.date, task.start_min)}`);
  } else {
    lines.push(`DUE;VALUE=DATE:${toIcsDateOnly(task.date)}`);
  }

  if (task.note) lines.push(`DESCRIPTION:${escapeIcs(task.note)}`);
  if (task.status === 'done') {
    const completed = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    lines.push(`COMPLETED:${completed}`);
  }
  lines.push('END:VTODO', 'END:VCALENDAR');
  return icsLines(lines);
}

async function fetchCollectionItems(settings, href) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:propfind>`;
  const result = await davRequest(settings, 'PROPFIND', href, { body, depth: 1 });
  const xml = xmlParser.parse(result.text);
  const items = [];

  for (const response of childValues(xml, 'response')) {
    const itemHref = firstHref(response);
    if (!itemHref || itemHref.endsWith('/')) continue;
    const etagNode = findNodeByKey(response, 'getetag');
    const etagKey = etagNode ? Object.keys(etagNode).find((key) => keyName(key) === 'getetag') : null;
    const etag = etagKey ? textOf(etagNode[etagKey]) : '';
    const dataNode = findNodeByKey(response, 'calendar-data');
    const dataKey = dataNode ? Object.keys(dataNode).find((key) => keyName(key) === 'calendar-data') : null;
    const raw = dataKey ? textOf(dataNode[dataKey]) : '';
    if (!raw) continue;

    try {
      const parsed = ical.sync.parseICS(raw);
      const event = Object.values(parsed).find((value) => value && typeof value === 'object' && value.type);
      if (!event) continue;
      items.push({
        href: resolveUrl(itemHref),
        etag,
        raw,
        uid: event.uid || crypto.randomUUID(),
        kind: event.type === 'VTODO' ? 'reminder' : 'calendar',
        summary: event.summary || '(未命名)',
        description: event.description || '',
        categories: Array.isArray(event.categories)
          ? event.categories
          : event.categories
            ? [event.categories]
            : [],
        start: event.start || event.due || null,
        end: event.end || null,
        due: event.due || null,
        status: event.status || 'NEEDS-ACTION',
        lastModified: event.lastmodified || event.dtstamp || null,
        isDateOnly: isDateOnly(raw, event.type === 'VTODO' ? 'DUE' : 'DTSTART')
      });
    } catch (error) {
      // 跳过无法解析的远端条目，避免单个坏事件阻断整个同步
    }
  }
  return items;
}

async function putItem(settings, href, etag, ics) {
  const headers = {};
  if (etag) {
    headers['If-Match'] = etag;
  } else {
    headers['If-None-Match'] = '*';
  }
  const result = await davRequest(settings, 'PUT', href, {
    body: ics,
    contentType: 'text/calendar; charset=utf-8',
    headers
  });
  return {
    href: resolveUrl(href),
    etag: result.headers.get('etag') || ''
  };
}

async function deleteRemoteItem(settings, href, etag) {
  const headers = etag ? { 'If-Match': etag } : {};
  await davRequest(settings, 'DELETE', href, { headers });
}

function localDate(date) {
  if (!date) return { date: null, startMin: null };
  const local = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(local.getTime())) return { date: null, startMin: null };
  return {
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    startMin: local.getHours() * 60 + local.getMinutes()
  };
}

function remoteTimeMs(item) {
  const value = item.lastModified || item.due || item.start || null;
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function categoryFromRemote(categories) {
  const known = ['工作', '学习', '生活', '健康', '其他'];
  for (const category of categories || []) {
    if (known.includes(String(category).trim())) return String(category).trim();
  }
  return '其他';
}

function taskFromRemoteItem(item, db) {
  const { date, startMin } = localDate(item.due || item.start);
  if (!date) return null;
  const duration =
    item.start && item.end && !item.isDateOnly
      ? Math.max(1, Math.round((item.end.getTime() - item.start.getTime()) / 60000))
      : null;
  const status = ['COMPLETED', 'CANCELLED'].includes(String(item.status).toUpperCase()) ? 'done' : 'pending';
  const note = item.description || '';
  return db.createTask({
    title: item.summary || '(未命名)',
    date,
    start_min: item.isDateOnly ? null : startMin,
    duration_min: duration,
    priority: 'P2',
    category: categoryFromRemote(item.categories),
    note,
    status,
    sync_calendar: item.kind === 'calendar' ? 1 : 0,
    sync_reminder: item.kind === 'reminder' ? 1 : 0,
    source: 'icloud',
    locked: startMin === null ? 0 : 1,
    remote_kind: item.kind,
    remote_uid: item.uid,
    remote_href: item.href,
    remote_etag: item.etag,
    remote_updated: item.lastModified ? item.lastModified.toISOString() : '',
    last_synced_at: nowIso()
  });
}

function applyRemoteToLocal(db, local, item) {
  const { date, startMin } = localDate(item.due || item.start);
  const duration =
    item.start && item.end && !item.isDateOnly
      ? Math.max(1, Math.round((item.end.getTime() - item.start.getTime()) / 60000))
      : null;
  return db.updateTask(local.id, {
    title: item.summary || local.title,
    date: date || local.date,
    start_min: item.isDateOnly ? null : startMin,
    duration_min: duration,
    note: item.description || local.note,
    status: ['COMPLETED', 'CANCELLED'].includes(String(item.status).toUpperCase()) ? 'done' : 'pending',
    category: categoryFromRemote(item.categories),
    sync_calendar: item.kind === 'calendar' ? 1 : 0,
    sync_reminder: item.kind === 'reminder' ? 1 : 0,
    locked: startMin === null ? 0 : 1,
    remote_etag: item.etag,
    remote_updated: item.lastModified ? item.lastModified.toISOString() : '',
    last_synced_at: nowIso()
  });
}

async function syncCollection(db, settings, href, kind) {
  const items = await fetchCollectionItems(settings, href);
  const byUid = new Map();
  const byHref = new Map();
  for (const item of items) {
    byUid.set(String(item.uid).toLowerCase(), item);
    byHref.set(String(item.href).toLowerCase(), item);
  }

  const allTasks = db.getTasks({ includeDeleted: true });
  const relevant = allTasks.filter((task) => {
    if (task.deleted_at) return task.remote_kind === kind;
    if (kind === 'calendar') return task.sync_calendar || task.remote_kind === 'calendar';
    return task.sync_reminder || task.remote_kind === 'reminder';
  });

  const counts = { created: 0, updated: 0, pushed: 0, deletedRemote: 0, deletedLocal: 0 };

  for (const item of items) {
    const local = relevant.find(
      (task) =>
        task.remote_uid &&
        String(task.remote_uid).toLowerCase() === String(item.uid).toLowerCase()
    ) || relevant.find(
      (task) =>
        task.remote_href &&
        String(task.remote_href).toLowerCase() === String(item.href).toLowerCase()
    );

    if (!local) {
      if (taskFromRemoteItem(item, db)) counts.created += 1;
      continue;
    }
    if (local.deleted_at) {
      try {
        await deleteRemoteItem(settings, item.href, item.etag);
        counts.deletedRemote += 1;
      } catch {
        // 远端可能已删除，继续清理本地
      }
      db.purgeDeletedTask(local.id);
      counts.deletedLocal += 1;
      continue;
    }

    const remoteTime = remoteTimeMs(item);
    const localTime = new Date(local.updated_at).getTime() || 0;
    if (remoteTime > localTime) {
      applyRemoteToLocal(db, local, item);
      counts.updated += 1;
    } else {
      const uid = local.remote_uid || `daily-planner-${local.id}-${crypto.randomUUID()}`;
      const ics = kind === 'calendar' ? buildEventIcs(local, uid) : buildReminderIcs(local, uid);
      const remote = await putItem(settings, local.remote_href || item.href, local.remote_etag || item.etag, ics);
      db.updateTask(local.id, {
        remote_kind: kind,
        remote_uid: uid,
        remote_href: remote.href,
        remote_etag: remote.etag,
        remote_updated: new Date().toISOString(),
        last_synced_at: nowIso()
      });
      counts.pushed += 1;
    }
  }

  for (const local of relevant) {
    if (local.deleted_at) {
      const remote = local.remote_href && byHref.get(String(local.remote_href).toLowerCase());
      if (remote) {
        try {
          await deleteRemoteItem(settings, remote.href, remote.etag);
          counts.deletedRemote += 1;
        } catch {
          // 忽略删除失败，下次同步重试
        }
      }
      db.purgeDeletedTask(local.id);
      counts.deletedLocal += 1;
      continue;
    }

    if (local.remote_kind !== kind) continue;
    if (kind === 'calendar' && !local.sync_calendar) continue;
    if (kind === 'reminder' && !local.sync_reminder) continue;

    const remote = byUid.get(String(local.remote_uid || '').toLowerCase()) || byHref.get(String(local.remote_href || '').toLowerCase());
    if (!remote) {
      const uid = local.remote_uid || `daily-planner-${local.id}-${crypto.randomUUID()}`;
      const ics = kind === 'calendar' ? buildEventIcs(local, uid) : buildReminderIcs(local, uid);
      const result = await putItem(settings, local.remote_href || itemHrefFor(href, uid), '', ics);
      db.updateTask(local.id, {
        remote_kind: kind,
        remote_uid: uid,
        remote_href: result.href,
        remote_etag: result.etag,
        remote_updated: new Date().toISOString(),
        last_synced_at: nowIso()
      });
      counts.pushed += 1;
      continue;
    }

    if (!local.last_synced_at || new Date(local.updated_at).getTime() > new Date(local.last_synced_at).getTime()) {
      const uid = local.remote_uid || remote.uid;
      const ics = kind === 'calendar' ? buildEventIcs(local, uid) : buildReminderIcs(local, uid);
      const result = await putItem(settings, remote.href, remote.etag, ics);
      db.updateTask(local.id, {
        remote_kind: kind,
        remote_uid: uid,
        remote_href: result.href,
        remote_etag: result.etag,
        remote_updated: new Date().toISOString(),
        last_synced_at: nowIso()
      });
      counts.pushed += 1;
    }
  }

  for (const local of relevant) {
    if (local.deleted_at || local.remote_kind !== kind) continue;
    const known = byUid.get(String(local.remote_uid || '').toLowerCase()) || byHref.get(String(local.remote_href || '').toLowerCase());
    if (!known && local.remote_uid) {
      db.hardDeleteTask(local.id);
      counts.deletedLocal += 1;
    }
  }

  return counts;
}

async function runSync(db) {
  const settings = db.getSettings();
  if (!settings.apple_id || !settings.app_password) {
    db.setSetting('last_sync_status', 'error');
    db.setSetting('last_sync_message', '请先在设置中填写 Apple ID 和 App 专用密码');
    return { ok: false, message: '请先在设置中填写 Apple ID 和 App 专用密码' };
  }

  const result = { ok: true, calendar: null, reminder: null, message: '' };
  try {
    if (settings.sync_calendar_enabled === '1' || settings.sync_reminder_enabled === '1') {
      const discovered = await discoverCollections(settings);
      let calendarHref = settings.calendar_href;
      let reminderHref = settings.reminder_href;

      if (settings.sync_calendar_enabled === '1') {
        if (!calendarHref || !discovered.calendars.some((calendar) => calendar.href === calendarHref)) {
          const calendar = await ensureCalendar(settings, '日常规划');
          calendarHref = calendar.href;
        }
      }
      if (settings.sync_reminder_enabled === '1' && !reminderHref) {
        result.ok = false;
        result.message = '请先在设置中选择要同步的提醒事项列表';
      }

      db.setSettings({
        calendar_href: calendarHref || '',
        reminder_href: reminderHref || ''
      });

      if (calendarHref && result.ok !== false) {
        result.calendar = await syncCollection(db, db.getSettings(), calendarHref, 'calendar');
      }
      if (reminderHref && result.ok !== false) {
        result.reminder = await syncCollection(db, db.getSettings(), reminderHref, 'reminder');
      }
      if (result.ok) result.message = '同步完成';
    } else {
      result.message = '未启用任何同步目标';
    }
  } catch (error) {
    result.ok = false;
    result.message = friendlySyncError(error);
  }

  db.setSetting('last_sync_at', nowIso());
  db.setSetting('last_sync_status', result.ok ? 'ok' : 'error');
  db.setSetting('last_sync_message', result.message);
  return result;
}

module.exports = {
  CalDavError,
  diagnoseConnection,
  friendlySyncError,
  discoverCollections,
  ensureCalendar,
  fetchCollectionItems,
  buildEventIcs,
  buildReminderIcs,
  putItem,
  deleteRemoteItem,
  syncCollection,
  runSync
};
