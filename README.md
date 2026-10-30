# MediaSaver

把抖音、小红书、哔哩哔哩的链接粘进来，拿到视频和图集。本地运行，不上传任何数据。

> 仅限个人学习、备份和已获授权的内容。请遵守平台服务条款与著作权法，不要用于商业分发或盗用他人作品。

## 支持情况

| 平台     | 视频 | 图集 | 去水印         | 说明                                                           |
| -------- | ---- | ---- | -------------- | -------------------------------------------------------------- |
| 抖音     | 支持 | 支持 | 支持           | 网页端目前只提供无水印源，带水印版本需在 App 内保存            |
| 哔哩哔哩 | 支持 | —    | 平台本身无水印 | 匿名最高 720P 单文件；登录后通常可到 1080P+，4K/杜比需要大会员 |
| 小红书   | 支持 | 支持 | 原图 / 原视频  | 需要有效分享链接；部分内容需要登录 Cookie                      |

几个现实限制：

- **抖音解析需要本机 Chrome 或 Edge。** 工具会启动一个隐藏的浏览器页面，让抖音自己的脚本完成签名，再截获作品数据。首次解析可能多等几秒；遇到安全验证时可以用 `MEDIA_SAVER_HEADLESS=0` 打开浏览器手动完成。
- **抖音带水印版本**：2026-10 实测网页端只返回无水印源，`playwm` 等旧地址也不再烧录可见水印。本工具不伪造水印版。
- **哔哩哔哩 1080P+** 需要 `SESSDATA` 登录 Cookie；高清流是 DASH 分离音视频，工具内置 ffmpeg 负责合并。
- 平台接口会变。遇到失效链接、解析失败或页面改版，欢迎带链接提 Issue。

## 快速开始

需要 Node.js >= 20.19 与 pnpm。没有 pnpm 时先执行 `npm i -g pnpm` 或 `corepack enable`。

```bash
pnpm install
```

### 一键启动（桌面入口）

- Windows：双击 `start.bat`
- macOS / Linux：双击 `start.command`（首次可能需要 `chmod +x`）

启动器会在首次运行时安装依赖、启动本地服务，并打开 <http://127.0.0.1:17890>。这是一个便于日常使用的启动器，不是独立安装包；Electron 桌面安装包还在后续计划中。

### 本地网页

```bash
pnpm web
```

打开 <http://127.0.0.1:17890>。服务只监听 `127.0.0.1`，不会暴露到局域网或公网。

### 命令行

```bash
# 直接下载最高画质
pnpm cli "https://v.douyin.com/xxxx/"

# 查看可用清晰度 / 版本
pnpm cli "https://www.bilibili.com/video/BV1GJ411x7h7" --list

# 指定版本与目录
pnpm cli "https://www.bilibili.com/video/BV1GJ411x7h7" --variant 1080p --out ./downloads

# 一次性传入 Cookie
pnpm cli "https://www.bilibili.com/video/BV1GJ411x7h7" --cookie "SESSDATA=..."
```

`--variant` 接受版本 id（如 `durl-64`）或清晰度（如 `1080p`）。默认下载排序后的第一个版本。

### 下载历史

网页右上角的“历史记录”会列出最近下载的作品（最多 200 条，网页显示最近 50 条）：

- 存储为 `~/.media-saver/history.json`（JSON，可直接阅读和备份）。
- 只记录平台、标题、作品页链接、下载的清晰度/图集、时间和本地路径；不保存 Cookie，也不保存会过期的带签名媒体 URL。
- 只有实际下载后才写入；仅解析/查看不会产生记录。
- 支持重新解析、打开作品页、删除单条和清空；点击“重新解析”会重新获取当前可用的地址。
- CLI 下载也会写入同一个文件，因此网页端能看到 CLI 的保存路径。

### 浏览器扩展

1. 先启动本地服务（`pnpm web` 或一键启动器）。
2. Chrome / Edge 打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”。
3. 选择本仓库的 `apps/extension` 目录。
4. 打开抖音、小红书或 B 站作品页，点击工具栏上的 MediaSaver 图标，选择版本下载。

扩展是薄壳：解析和下载都交给本地服务，因此不复制平台 Cookie，也不需要额外申请平台权限。

## 登录 Cookie

把 Cookie 写入 `~/.media-saver/cookies.json`（Windows 为 `%USERPROFILE%\.media-saver\cookies.json`）：

```json
{
  "bilibili": "SESSDATA=...; bili_jct=...;",
  "xiaohongshu": "a1=...; web_session=...;"
}
```

- 哔哩哔哩：登录后可选清晰度更多；没有 Cookie 时自动退回匿名可用的清晰度。
- 小红书：部分笔记匿名读取为空，需要 Cookie。
- 抖音：使用 `~/.media-saver/browser-profile` 里的浏览器登录态，不读取上面的 Cookie。
- Cookie 等价于账号凭据：不要提交到 Git，不要发给别人。工具只会把 Cookie 发往对应平台的接口，不会转发给 CDN 或第三方。

## 前置条件

- Node.js >= 20.19、pnpm
- Chrome 或 Edge（仅抖音需要；其余平台不依赖浏览器）
- ffmpeg：作为 npm 依赖自动安装（`@ffmpeg-installer/ffmpeg`）。如需使用系统 ffmpeg，可设置 `FFMPEG_PATH`。

环境变量：

| 变量                       | 作用                                                     |
| -------------------------- | -------------------------------------------------------- |
| `PORT`                     | 本地网页端口，默认 `17890`                               |
| `FFMPEG_PATH`              | 指定系统 ffmpeg 可执行文件                               |
| `MEDIA_SAVER_BROWSER`      | 指定 Chrome/Edge 可执行文件路径                          |
| `MEDIA_SAVER_HEADLESS=0`   | 打开可见浏览器窗口，用于完成安全验证或登录               |
| `MEDIA_SAVER_HISTORY_FILE` | 自定义历史文件路径（默认 `~/.media-saver/history.json`） |

## 项目结构

```text
media-saver/
├─ packages/core/          平台适配器 + 下载引擎 + 历史存储
│  ├─ src/history.ts       本地下载历史（JSON，原子写入）
│  └─ src/platforms/       douyin.ts · bilibili.ts · xiaohongshu.ts
├─ apps/cli/               命令行
├─ apps/web/               本地网页（Fastify + 原生前端）
├─ apps/extension/         MV3 浏览器扩展
└─ scripts/launch.mjs      一键启动器
```

所有平台差异都收在 `PlatformAdapter` 接口后面：`match(url)` 判断平台，`resolve(url)` 返回标题、封面与带清晰度标记的媒体变体。新增平台只需要新增一个适配器并注册。

抖音适配器优先通过隐藏浏览器截获详情接口响应；哔哩哔哩使用原生 API + WBI 签名；小红书解析分享页里的 `__INITIAL_STATE__`。下载层统一处理单文件、DASH 音视频合并、重试与文件名。

## 开发

```bash
pnpm install
pnpm test        # 纯单元测试，不访问网络、不启动浏览器
pnpm lint
pnpm typecheck
pnpm --filter @media-saver/cli build
```

CI 在 PR 与 `main` 推送时运行 lint、typecheck、test，并构建 CLI。

## 隐私与安全

- 服务只绑定 `127.0.0.1`，不提供公网托管。
- Cookie 只保存在本机文件里；网页端只返回“是否配置”，不回传 Cookie 值。
- 下载接口只接受解析结果里的任务 ID 与变体 ID，不接受任意 URL 代理，避免 SSRF。
- 浏览器配置目录在 `~/.media-saver/browser-profile`，不会写入仓库。
- 下载历史只保存在本机 `~/.media-saver/history.json`，只含元数据；可在网页里删除或清空。

## License

[MIT](LICENSE)
