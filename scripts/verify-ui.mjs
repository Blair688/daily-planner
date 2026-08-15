import { chromium } from 'playwright-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const username = `uitest_${Date.now()}`;
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const errors = [];

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

async function textOverflow(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.button, .nav-item, .task-title, .stat-card strong, .habit-card strong'))
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map((el) => el.textContent.trim())
      .slice(0, 20)
  );
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('pageerror', (error) => errors.push(`desktop: ${error.message}`));
  desktop.on('console', (message) => {
    if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`);
  });
  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('#login-view');

  await desktop.click('#auth-tab-register');
  await desktop.fill('#auth-username', username);
  await desktop.fill('#auth-display-name', '界面测试');
  await desktop.click('#auth-submit');
  await desktop.waitForSelector('#app-view:not(.hidden)');
  await desktop.waitForSelector('#dashboard-stats .stat-card');

  const desktopOverflowLogin = await overflow(desktop);

  await desktop.click('button[data-view="today"]');
  await desktop.waitForSelector('#task-form');
  await desktop.fill('#task-title', '界面验证任务');
  await desktop.fill('#task-duration', '30');
  await desktop.click('#form-submit');
  await desktop.waitForTimeout(3000);
  const titlesAfterAdd = await desktop.locator('.task-title').allTextContents();
  const toastText = await desktop.textContent('#toast');
  console.log('DEBUG_AFTER_ADD', JSON.stringify({ titlesAfterAdd, toastText }));
  await desktop.waitForFunction((title) => Array.from(document.querySelectorAll('.task-title')).some((el) => el.textContent.includes(title)), '界面验证任务');

  await desktop.click('#auto-schedule');
  await desktop.waitForTimeout(700);
  await desktop.click('button[data-view="timeline"]');
  await desktop.waitForSelector('.timeline-block');

  await desktop.click('button[data-view="monthly"]');
  await desktop.waitForSelector('.month-day[data-date]');
  const monthDays = await desktop.locator('.month-day[data-date]').count();

  await desktop.click('button[data-view="habits"]');
  await desktop.waitForSelector('#habit-add');
  await desktop.click('#habit-add');
  await desktop.fill('#habit-name', '界面验证习惯');
  await desktop.click('#habit-save');
  await desktop.waitForTimeout(2500);
  const habitToast = await desktop.textContent('#toast');
  const habitListText = await desktop.textContent('#habit-list');
  console.log('DEBUG_HABIT', JSON.stringify({ habitToast, habitListText: habitListText.slice(0, 200) }));
  await desktop.waitForFunction(() => document.querySelector('#habit-list')?.textContent.includes('界面验证习惯'));

  await desktop.click('button[data-view="focus"]');
  await desktop.waitForSelector('#timer-display');
  const timerText = await desktop.textContent('#timer-display');

  await desktop.click('button[data-view="review"]');
  await desktop.waitForSelector('#review-content');
  await desktop.fill('#review-content', '本周界面验证');
  await desktop.click('[data-review-tab="daily"]');
  await desktop.fill('#daily-review-content', '今天界面验证');
  await desktop.click('#daily-review-save');
  await desktop.waitForTimeout(500);
  await desktop.click('[data-review-tab="goals"]');
  await desktop.fill('#goal-title', '年度目标验证');
  await desktop.click('#goal-add');
  await desktop.waitForSelector('.goal-item');

  await desktop.click('button[data-view="settings"]');
  await desktop.waitForSelector('#theme-presets .theme-swatch');
  const desktopOverflow = await overflow(desktop);
  const desktopText = await textOverflow(desktop);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', (error) => errors.push(`mobile: ${error.message}`));
  mobile.on('console', (message) => {
    if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`);
  });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('#login-view');
  await mobile.click(`#auth-users .user-pill[data-username="${username}"]`);
  await mobile.waitForSelector('#app-view:not(.hidden)');
  await mobile.waitForSelector('#dashboard-stats .stat-card');
  const mobileOverflow = await overflow(mobile);
  const mobileText = await textOverflow(mobile);

  await mobile.click('.bottom-nav .nav-item[data-view="habits"]');
  await mobile.waitForSelector('.habit-card');

  console.log(JSON.stringify({
    username,
    timerText,
    monthDays,
    desktopOverflowLogin,
    desktopOverflow,
    mobileOverflow,
    desktopText,
    mobileText,
    errors
  }, null, 2));
} finally {
  await browser.close();
}
