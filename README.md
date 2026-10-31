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
- 本地网页与桌面版支持一次粘贴多个作品链接（每行一个，最多 10 个），逐个解析后可一键批量下载；浏览器首次批量下载可能询问是否允许。
- 桌面版和网页版的“平台管理”可以启用或停用抖音、B 站、小红书；停用后入口和新解析请求都会关闭，历史记录保留。平台代码仍随安装包，不做运行时插件下载。
- 平台接口会变。遇到失效链接、解析失败或页面改版，欢迎带链接提 Issue。

## 项目定位与相似项目

> 本项目与 GitHub 上其他名为 MediaSaver / Media Saver 的项目无关联，也未复用其代码；同名只是常见命名。

我们的定位是**本地优先、三平台、四端统一、无 Python/yt-dlp 运行时、JSON 历史、MIT**。同类项目很多，下面只列代表性项目（排名不分先后）：

| 项目                                                                                                                                             | 形态 / 栈                    | 覆盖                                        | 与我们的关系                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------- | -------------------------------------------- |
| [清影下载器](https://github.com/zhangtt08/multi-platform-video-downloader)                                                                       | Electron + yt-dlp/gallery-dl | 抖音 / B站 / 小红书 / TikTok / YouTube / IG | 最接近；站点更广；我们无 Python/外部下载引擎 |
| [UmauVDownloader](https://github.com/mcxiaoke/UmaoVDownloader)                                                                                   | Flutter + Node Web/CLI       | 抖音 / 小红书                               | 多端；我们多 B站、Electron 与浏览器扩展      |
| [ClawKit](https://github.com/JoeyZ1105/clawkit)                                                                                                  | Python 本地提取器            | 抖音 / 小红书 / B站 / 微博等                | 偏元数据、评论提取，不是下载 GUI             |
| [Douyin_TikTok_Download_API](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)                                                            | Python 自托管 API            | 抖音 / TikTok / B站                         | 托管 API/Web 控制台，不是本地桌面工具        |
| [douyin-downloader](https://github.com/jiji262/douyin-downloader)                                                                                | Python                       | 抖音                                        | 单平台；批量、SQLite 去重、浏览器回退        |
| [XHS-Downloader](https://github.com/JoeanAmier/XHS-Downloader) / [TikTokDownloader](https://github.com/JoeanAmier/TikTokDownloader)              | GPL-3.0                      | 小红书 / 抖音 + TikTok                      | 单平台成熟；未复用其代码                     |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) / [Lux](https://github.com/iawia002/lux)                                                              | Python / Go CLI              | B站等                                       | 通用或 B 站强；抖音/小红书非强项             |
| [BBDown](https://github.com/nilaoda/BBDown) / [BiliTools](https://github.com/btjawa/BiliTools) / [DownKyi](https://github.com/leiurayer/downkyi) | C# / Tauri / 桌面            | 仅 B站                                      | 单平台；部分已归档/停更                      |

我们的差异：

- 不依赖 Python、yt-dlp、gallery-dl；抖音由本机浏览器完成签名，B 站走原生 API + WBI，XHS 解析页面状态。
- CLI、本地网页、Electron、浏览器扩展共用一套 core 与 JSON 历史。
- 代价：平台覆盖只有三个；不做主页/评论采集，批量只支持多个作品链接；XHS 与 B 站高清仍受登录态限制。
- 同类项目可作为平台改版的预警来源；我们不会把 GPL/AGPL 项目的代码直接搬进本 MIT 项目。

## 快速开始

需要 Node.js >= 20.19 与 pnpm。没有 pnpm 时先执行 `npm i -g pnpm` 或 `corepack enable`。

```bash
pnpm install
```

### 一键启动（免安装）

- Windows：双击 `start.bat`
- macOS / Linux：双击 `start.command`（首次可能需要 `chmod +x`）

启动器会在首次运行时安装依赖、启动本地服务，并打开 <http://127.0.0.1:17890>。需要原生窗口和双击安装时，用下面的桌面安装版。

想在桌面放一个启动器（Windows）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-desktop-shortcut.ps1
```

脚本会在桌面创建 `MediaSaver.lnk`，优先指向已安装的桌面版或本机构建，都没有时指向 `start.bat`。

### 桌面安装版（Electron，Windows）

安装包由 GitHub Actions 的 `Release Desktop` 工作流或本地 `pnpm desktop:dist` 生成。双击安装；未签名会有 SmartScreen 提示，选择“更多信息 → 仍要运行”。

- 安装包约 135MB；安装后从桌面或开始菜单打开。
- 默认下载到系统“下载”目录下的 `MediaSaver` 子文件夹；菜单“文件 → 更改下载文件夹…”可修改，“文件 → 打开下载文件夹”直接打开当前目录。
- 与网页/CLI 共用历史、Cookie 和浏览器登录态；抖音仍依赖系统 Edge/Chrome。
- 若本机已有 MediaSaver 本地服务，应用会复用它；否则自己启动。17890 被其他程序占用时会提示。

### 本地网页

```bash
pnpm web
```

打开 <http://127.0.0.1:17890>。服务只监听 `127.0.0.1`，不会暴露到局域网或公网。图集下载默认转换为 JPG；缩略图仍使用平台原图。

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

图集默认转换为 JPG；如需保留平台原始格式（例如 WebP），加 `--image-format original`。

```bash
pnpm cli "https://www.douyin.com/note/xxxx" --image-format original
```

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

扩展是薄壳：解析和下载都交给本地服务，因此不复制平台 Cookie，也不需要额外申请平台权限。图集下载默认 JPG。

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

- Node.js >= 20.19、pnpm（仅源码/开发；安装版不需要）
- Chrome 或 Edge（仅抖音需要；其余平台不依赖浏览器）
- ffmpeg：作为 npm 依赖自动安装（`@ffmpeg-installer/ffmpeg`）。如需使用系统 ffmpeg，可设置 `FFMPEG_PATH`。
- Windows 10/11 x64（仅桌面安装版）

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
├─ apps/desktop/           Electron 桌面安装版
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
pnpm desktop        # 开发模式启动 Electron
pnpm desktop:dist   # 构建 Windows NSIS 安装包
```

CI 在 PR 与 `main` 推送时运行 lint、typecheck、test，并构建 CLI。

## 桌面版发布

1. 修改 `apps/desktop/package.json` 的 `version`。
2. 推送 `v<version>` 标签，或手动运行 GitHub Actions 的 `Release Desktop`。
3. Windows runner 会生成 `MediaSaver-<version>-Setup.exe` 并上传为 Artifact；打标签时同时附到 Release。
4. 未签名安装包会有 SmartScreen 提示；消除提示需要购买代码签名证书。

本地构建（Windows）：

```bash
pnpm desktop:dist
```

国内网络下如果 Electron/构建组件下载失败，设置镜像后重试：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
pnpm desktop:dist
```

## 维护策略

- 平台解析集中在 `packages/core/src/platforms/`；平台改版只改对应适配器，CLI/网页/桌面共用。
- 历史使用 JSON，没有数据库或原生模块；桌面壳不引入第二套后端。
- GitHub Actions 负责 CI 与 Windows 安装包构建；建议一年集中升级一次 Electron/pnpm 依赖。
- 桌面壳可以一年维护一次；平台接口是否失效不由我们控制，届时更新对应适配器即可，通常不需要重写前端或桌面壳。

## 隐私与安全

- 服务只绑定 `127.0.0.1`，不提供公网托管。
- Cookie 只保存在本机文件里；网页端只返回“是否配置”，不回传 Cookie 值。
- 下载接口只接受解析结果里的任务 ID 与变体 ID，不接受任意 URL 代理，避免 SSRF。
- 浏览器配置目录在 `~/.media-saver/browser-profile`，不会写入仓库。
- 下载历史只保存在本机 `~/.media-saver/history.json`，只含元数据；可在网页里删除或清空。
- 平台启用状态保存在本机 `~/.media-saver/platforms.json`，不上传。
- 桌面版同样只启动本地服务；下载文件默认保存在系统下载目录，可在“文件 → 更改下载文件夹…”中修改，历史元数据规则与网页/CLI 相同。

## License

[MIT](LICENSE)
