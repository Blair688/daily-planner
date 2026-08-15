# 日常规划

一个在 Windows 上运行的本地日常规划应用：输入每日待办，按 P1/P2/P3 优先级排序；没有安排时长时，根据任务标题关键词和分类自动估算时长并放入当天最合适的空闲时段；通过 CalDAV 与苹果 iCloud 日历、提醒事项双向同步，iPhone 与 Windows 看到同一份数据。

## 功能

- 每日待办：标题、日期、优先级、分类、备注、开始时间、时长
- 自动排程：识别“30分钟、1小时、5公里”等描述，支持自定义排程时段和午休，P1 优先、长任务优先，自动避开已锁定时间段
- 时间轴拖拽：拖动任务条修改开始时间，拖底部手柄修改时长
- iCloud 同步：自动发现或创建“日常规划”日历，双向同步事件和提醒
- 多端刷新：页面每 30 秒自动刷新，手机上的修改很快出现在电脑上
- 主题颜色：6 套预设色或自定义主色，保存后立即生效
- 手机访问：iPhone 通过同一 Wi-Fi 打开网页，可添加到主屏幕
- 远程访问：通过 Tailscale 在任何网络访问
- 数据备份：导出/导入全部任务与规则

## 快速开始

1. 双击 `启动.bat`（首次会自动安装依赖并打开浏览器）。
2. 在“今日”页添加任务，点击“自动排程”。
3. 在“设置”页填写 Apple ID（手机号或 iCloud 邮箱）和 App 专用密码，点击“测试连接”。
4. 选择要同步的日历和提醒列表，保存设置，点击“立即同步”。

如果同步失败，先在设置页点击“同步诊断”，页面会显示 DNS、TCP 443 和 HTTPS 的检测结果；常见的“fetch failed”通常是系统或防火墙拦截了到 iCloud 的网络请求。

手动启动：

```bat
npm install
npm start
```

运行测试：

```bat
npm test
```

## iPhone 访问

1. 手机和 Windows 连接同一个 Wi-Fi。
2. 启动服务后，终端会打印 `http://192.168.x.x:3000` 形式的地址。
3. 在 iPhone 的 Safari 打开该地址。
4. 点分享按钮，选择“添加到主屏幕”，之后可像 App 一样打开。

如果手机打不开，放行 Windows 防火墙（以管理员身份运行 PowerShell 或 CMD）：

```bat
netsh advfirewall firewall add rule name="Daily Planner" dir=in action=allow protocol=TCP localport=3000
```

## 远程访问（Tailscale）

1. 在 [tailscale.com](https://tailscale.com) 注册免费账号。
2. Windows 安装并登录 Tailscale。
3. iPhone 安装 Tailscale App 并登录同一个账号。
4. 两台设备都会获得 `100.x.x.x` 的 Tailscale 地址。
5. iPhone 浏览器打开 `http://<Windows 的 Tailscale 地址>:3000`。

注意：Tailscale 地址是私有的，只有登录同一账号的设备能访问。

## iCloud 设置

1. 在电脑浏览器打开 [appleid.apple.com](https://appleid.apple.com)，进入“登录与安全”。
2. 开启双重认证后，点击“App 专用密码”生成一个新密码。
3. 把 Apple ID（手机号或 iCloud 邮箱均可）和这个专用密码填进本应用的“设置”页。请勿填写 Apple ID 的网页登录密码。
4. 点击“测试连接”，选择“日常规划”日历（首次会自动创建）。
5. 如需同步提醒事项：先在 iPhone 的“提醒事项”App 中新建一个列表（例如“日常规划”），再在本应用设置页选择该列表。

同步逻辑：

- 本地任务和 iCloud 通过 UID 关联，ETag 做增量更新，每 10 分钟自动同步一次（可在设置中修改）。
- 手机日历/提醒事项中新建或修改的内容，会自动出现在 Windows 端。
- 任一端删除，另一端也会删除。
- 两端同时修改时，按最后修改时间覆盖。
- 未填写开始时间的任务会同步为全天事件；排程后再次同步会变为具体时间。

## 自动排程规则

默认规则示例：

| 关键词 | 时长 | 时段 |
| --- | --- | --- |
| 会议 / 开会 | 60 分钟 | 上午 |
| 写作 / 报告 / 方案 / 文档 | 60-90 分钟 | 上午 |
| 学习 / 阅读 / 课程 | 60 分钟 | 下午 |
| 电话 | 20 分钟 | 下午 |
| 健身 / 跑步 / 运动 / 瑜伽 | 45 分钟 | 晚上 |
| 买菜 / 购物 / 家务 | 30 分钟 | 晚上 |

未匹配关键词时按分类兜底：工作 60 分钟上午、学习 60 分钟下午、健康 45 分钟晚上、生活 30 分钟晚上、其他 30 分钟下午。用户在任务中填写时长时，以填写值为准。

排程默认从 09:00 开始、22:00 结束，午休 12:00-13:30 不会被安排普通任务；这些时间可以在设置页修改，也可以给规则设置更精确的偏好开始/结束时间。

## 目录结构

```text
lib/db.js           SQLite 数据层、任务/设置/规则读写
lib/scheduler.js    关键词规则估算与自动排程
lib/caldav.js       iCloud CalDAV 双向同步
server.js           Express API 与静态页面服务
public/             前端页面（原生 JS + CSS + PWA）
tests/              Node 内置 test runner 单元测试
data/               运行时生成的 SQLite 数据库
```

## 安全说明

- App 专用密码只保存在本机 `data/daily-planner.db` 中，不会上传到任何第三方服务器。
- 本应用是局域网/私有网络应用，不建议直接暴露到公网。
- 备份文件包含设置但不包含密码，导入后需要重新填写 App 专用密码。

## GitHub

项目已经内置 MIT License 和 GitHub Actions CI（`npm ci` + `npm test`）。`node_modules/` 与 `data/` 已加入 `.gitignore`，数据库和 App 专用密码不会进入仓库。

```bat
git init
git add .
git commit -m "Initial commit"
```

之后可在 GitHub 创建空仓库，再按 GitHub 提示关联并推送。
