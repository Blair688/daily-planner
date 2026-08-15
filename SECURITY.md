# 安全与隐私说明

这个仓库只包含日常规划系统的代码、测试和文档，不包含任何用户数据。

## 本地数据

- 所有个人数据保存在本机 `data/daily-planner.db` 中。
- `data/`、`*.db`、`*.db-shm`、`*.db-wal` 已加入 `.gitignore`，永远不会被提交到 Git。
- 账号密码使用 Node 内置 `crypto.scrypt` 哈希后存储，不保存明文密码。

## 提交前检查

每次发布前请运行：

```bash
npm run privacy-check
npm test
```

`privacy-check` 会扫描 Git 跟踪文件，检查是否存在手机号、邮箱、第三方账号/凭据字段或疑似明文密码。

## 报告问题

如果你在代码中发现了可能泄露个人信息的文件，请先不要公开讨论，直接删除相关文件并重新提交。
