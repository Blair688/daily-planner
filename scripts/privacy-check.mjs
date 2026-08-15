import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);

const findings = [];

for (const file of files) {
  if (file.startsWith('data/') || /\.(db|db-shm|db-wal)$/.test(file)) {
    findings.push(`${file}: 数据库文件不应被 Git 跟踪`);
    continue;
  }
  if (!fs.existsSync(file)) continue;
  if (file.includes('privacy-check')) continue;

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const checks = [
    { name: '手机号', re: /\b1[3-9]\d{9}\b/ },
    { name: '邮箱', re: /\b[\w.+-]+@[\w-]+\.\w+\b/ },
    { name: 'iCloud 账号字段', re: /apple_id|app_password|@icloud\.com/i }
  ];
  if (!file.startsWith('tests/') && !file.includes('privacy-check')) {
    checks.push({ name: '疑似明文密码', re: /(?:password|passwd|密码)\s*[:=]\s*['"][^'"]{8,}['"]/i });
  }

  for (let index = 0; index < lines.length; index += 1) {
    for (const check of checks) {
      if (check.name === '疑似明文密码' && lines[index].includes('data-has-password')) continue;
      if (check.re.test(lines[index])) {
        findings.push(`${file}:${index + 1} ${check.name}: ${lines[index].trim().slice(0, 100)}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error('隐私检查未通过：');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`隐私检查通过：已扫描 ${files.length} 个 Git 跟踪文件，未发现个人或敏感信息。`);
