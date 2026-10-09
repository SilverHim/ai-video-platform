# 给 agent 的接入说明：安装 AI视频生成平台并接入 MCP

> 这份文档写给 Claude Code 等 agent 执行。用户只需要对 agent 说：
>
> 帮我按 https://raw.githubusercontent.com/SilverHim/ai-video-platform/main/docs/agent-setup.md 安装并接入 AI视频生成平台的 MCP

**agent 请先读原文**：如果你是通过网页抓取 / 摘要工具读到这份文档的，先用 `curl -fsSL https://raw.githubusercontent.com/SilverHim/ai-video-platform/main/docs/agent-setup.md` 读取原文，下面的命令必须逐字执行。

**目标**：确保本机装了「AI视频生成平台」桌面版并正在运行，然后把它的 MCP 服务器以 `ai-video` 为名登记到 Claude Code 的用户级配置。完成后用户开一个新会话就能用 `list_models`、`generate_image` 等工具。

## 约定（agent 必须遵守）

- 开始前用一两句话告诉用户你要做什么：可能要下载并安装桌面版（来自 GitHub Releases），以及修改 Claude Code 的用户级配置（`~/.claude.json`）。
- **每个代码块作为一条命令完整执行**（不要拆开）：每次执行命令都是新的 shell，前一条命令里的变量不会保留。代码块都包在 `( … )` / `& { … }` 里，可以安全地整段运行。
- 下载和等待服务就绪可能要一两分钟：执行时把命令超时设长一些（例如 5 分钟）。
- **不要在对话里输出令牌**。不要运行 `claude mcp get ai-video`（它会明文打印令牌）。
- 已经装好、正在运行的桌面版不要重装，也不要退出它。
- 每个代码块最后会输出一个大写标记（如 `REGISTERED`、`NO_RELEASE`），按下面「标记含义」处理。
- 接入不需要任何 API Key；生成内容用的 API Key 由用户在桌面版「设置」里填。

---

## macOS（只支持 Apple 芯片）

### 第 1 步：检查

```bash
(
uname -m
claude --version 2>/dev/null || echo NO_CLAUDE_CLI
pgrep -x "AI视频生成平台" >/dev/null && echo RUNNING
for a in "/Applications/AI视频生成平台.app" "$HOME/Applications/AI视频生成平台.app"; do [ -d "$a" ] && echo "INSTALLED $a"; done
true
)
```

- `uname -m` 不是 `arm64`（是 `x86_64` 即 Intel Mac）：告诉用户桌面版不支持 Intel Mac，可以从源码运行（见仓库 README），然后停止。
- 输出 `NO_CLAUDE_CLI`：告诉用户先安装 Claude Code 命令行，然后停止。
- 输出了 `RUNNING` 或 `INSTALLED …`：跳过第 2 步，直接第 3 步。

### 第 2 步：从 GitHub Releases 下载并安装（仅在未安装时）

```bash
(
API=$(curl -sS -m 30 -w '\n%{http_code}' https://api.github.com/repos/SilverHim/ai-video-platform/releases/latest) || { echo NETWORK_ERROR; exit 1; }
CODE=$(printf '%s' "$API" | tail -n 1)
[ "$CODE" = 404 ] && { echo NO_RELEASE; exit 0; }
[ "$CODE" = 200 ] || { echo "GITHUB_HTTP_$CODE"; exit 1; }
URL=$(printf '%s' "$API" | grep -o '"browser_download_url": *"[^"]*mac-arm64\.dmg"' | sed -E 's/.*"(https[^"]+)"/\1/' | head -n 1)
[ -n "$URL" ] || { echo NO_MAC_ASSET; exit 1; }
TMP=$(mktemp -d); DMG="$TMP/ai-video-platform.dmg"; MNT="$TMP/mnt"; mkdir "$MNT"
curl -fL --retry 2 -o "$DMG" "$URL" || { echo DOWNLOAD_FAILED; rm -rf "$TMP"; exit 1; }
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$DMG" || { echo MOUNT_FAILED; rm -rf "$TMP"; exit 1; }
DEST=/Applications; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
ditto "$MNT/AI视频生成平台.app" "$DEST/AI视频生成平台.app"; RC=$?
hdiutil detach "$MNT" -quiet || hdiutil detach "$MNT" -force -quiet
rm -rf "$TMP"
[ "$RC" = 0 ] && echo "INSTALLED $DEST/AI视频生成平台.app" || echo COPY_FAILED
)
```

- `hdiutil` 可能打印 deprecated 警告，可以忽略。
- 用 `curl` 下载的文件不带「来自互联网」的隔离标记，第一次打开一般不会被拦；如果系统仍提示「无法验证开发者」，请用户到「系统设置 › 隐私与安全性」点「仍要打开」。

### 第 3 步：启动并接入（已安装时直接从这里开始；以后令牌变了、报 401 也只需要重跑这一步）

```bash
(
D="$HOME/Library/Application Support/ai-video-platform"
pgrep -x "AI视频生成平台" >/dev/null || open -a "AI视频生成平台" || { echo LAUNCH_FAILED; exit 1; }
READY=; PORT=
for i in $(seq 1 90); do
  PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$D/desktop-state.json" 2>/dev/null | head -n 1)
  if [ -n "$PORT" ] && curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" -H "x-ark-client: web" 2>/dev/null | grep -qF "\"dataDir\":\"$D/data\""; then READY=1; break; fi
  sleep 1
done
[ -n "$READY" ] || { echo NOT_READY; tail -n 20 "$D/logs/server.log" 2>/dev/null; exit 1; }
INFO=$(curl -fsS -m 5 "http://127.0.0.1:$PORT/api/mcp" -H "x-ark-client: web") || { echo MCP_INFO_FAILED; exit 1; }
URL=$(printf '%s' "$INFO" | sed -nE 's/.*"url":"([^"]+)".*/\1/p')
TOKEN=$(printf '%s' "$INFO" | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
[ -n "$URL" ] && [ -n "$TOKEN" ] || { echo MCP_INFO_INVALID; exit 1; }
claude mcp remove ai-video --scope user >/dev/null 2>&1 || true
claude mcp add --transport http --scope user ai-video "$URL" --header "Authorization: Bearer $TOKEN" >/dev/null || { echo REGISTER_FAILED; exit 1; }
echo REGISTERED
claude mcp list 2>&1 | grep "ai-video"
)
```

最后一行 `ai-video` 显示 Connected（前面的符号不同版本可能不一样）即成功。

---

## Windows（x64）

以下代码块在 PowerShell 里执行。（Windows 流程按安装包的配置写成，尚未在 Windows 实机上逐步验证；遇到和描述不一致的地方，如实告诉用户。）

### 第 1 步：检查并在需要时安装

```powershell
& {
  $ProgressPreference = 'SilentlyContinue'
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { 'NO_CLAUDE_CLI'; return }
  $key = 'HKCU:\Software\cb15f69f-06ac-5950-8842-5800a7696daa'
  $exe = "$env:LOCALAPPDATA\Programs\ai-video-platform\ai-video-platform.exe"
  $loc = (Get-ItemProperty $key -ErrorAction SilentlyContinue).InstallLocation
  if ($loc) { $exe = Join-Path $loc 'ai-video-platform.exe' }
  if ((Get-Process ai-video-platform -ErrorAction SilentlyContinue) -or (Test-Path $exe)) { "INSTALLED $exe"; return }
  try { $rel = Invoke-RestMethod -UseBasicParsing -TimeoutSec 30 'https://api.github.com/repos/SilverHim/ai-video-platform/releases/latest' }
  catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { 'NO_RELEASE' } else { "GITHUB_ERROR $($_.Exception.Message)" }; return }
  $asset = $rel.assets | Where-Object { $_.name -like '*win-x64-setup.exe' } | Select-Object -First 1
  if (-not $asset) { 'NO_WINDOWS_ASSET'; return }
  $setup = Join-Path $env:TEMP $asset.name
  try { Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $setup } catch { "DOWNLOAD_FAILED $($_.Exception.Message)"; return }
  # 只等安装程序本身结束（它装完会自动打开应用）；不要用 Start-Process -Wait，那会一直等到应用退出
  Start-Process $setup -PassThru | Wait-Process
  $loc = (Get-ItemProperty $key -ErrorAction SilentlyContinue).InstallLocation
  if ($loc) { $exe = Join-Path $loc 'ai-video-platform.exe' }
  if (Test-Path $exe) { "INSTALLED $exe" } else { 'INSTALL_FAILED' }
}
```

- 安装包是一键安装（按用户安装，不需要管理员）。如果出现「Windows 已保护你的电脑」，请用户点「更多信息」→「仍要运行」。

### 第 2 步：启动并接入（以后令牌变了、报 401 也只需要重跑这一步）

```powershell
& {
  $D = "$env:APPDATA\ai-video-platform"
  $exe = "$env:LOCALAPPDATA\Programs\ai-video-platform\ai-video-platform.exe"
  $loc = (Get-ItemProperty 'HKCU:\Software\cb15f69f-06ac-5950-8842-5800a7696daa' -ErrorAction SilentlyContinue).InstallLocation
  if ($loc) { $exe = Join-Path $loc 'ai-video-platform.exe' }
  if (-not (Get-Process ai-video-platform -ErrorAction SilentlyContinue)) {
    if (Test-Path $exe) { Start-Process $exe } else { 'NOT_INSTALLED'; return }
  }
  $port = $null; $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $port = (Get-Content "$D\desktop-state.json" -Raw | ConvertFrom-Json).port
      $h = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$port/api/health" -Headers @{ 'x-ark-client' = 'web' }
      if ($h.dataDir -eq "$D\data") { $ready = $true; break }
    } catch {}
    Start-Sleep 1
  }
  if (-not $ready) { 'NOT_READY'; Get-Content "$D\logs\server.log" -Tail 20 -ErrorAction SilentlyContinue; return }
  $info = Invoke-RestMethod -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$port/api/mcp" -Headers @{ 'x-ark-client' = 'web' }
  if (-not $info.url -or $info.token -notmatch '^[a-f0-9]{64}$') { 'MCP_INFO_INVALID'; return }
  claude mcp remove ai-video --scope user 2>$null | Out-Null
  claude mcp add --transport http --scope user ai-video $info.url --header "Authorization: Bearer $($info.token)" | Out-Null
  if ($LASTEXITCODE -ne 0) { 'REGISTER_FAILED'; return }
  'REGISTERED'
  claude mcp list 2>&1 | Select-String 'ai-video'
}
```

最后一行 `ai-video` 显示 Connected 即成功。

---

## 标记含义

| 标记 | 怎么处理 |
|---|---|
| `REGISTERED` | 成功，按「完成后告诉用户」收尾 |
| `RUNNING` / `INSTALLED …` | 已安装，进入「启动并接入」那一步 |
| `NO_RELEASE` | 仓库还没有正式发布桌面版：告诉用户先在 GitHub 上发布 Release（或从源码运行），然后停止 |
| `NO_MAC_ASSET` / `NO_WINDOWS_ASSET` | 最新 Release 里没有对应的安装包：告诉用户，然后停止 |
| `NETWORK_ERROR` / `GITHUB_HTTP_403` / `GITHUB_ERROR …` | 网络问题或 GitHub 限流（匿名每小时 60 次）：稍后重试一次，仍失败就告诉用户 |
| `DOWNLOAD_FAILED` / `MOUNT_FAILED` / `COPY_FAILED` / `INSTALL_FAILED` | 安装失败：把输出告诉用户；macOS 上也可以请用户手动把 dmg 里的应用拖进「应用程序」 |
| `NOT_INSTALLED` / `LAUNCH_FAILED` | 没找到已安装的应用：回到第 1 步 |
| `NOT_READY` | 服务 90 秒内没有就绪：把输出的日志末尾给用户看。常见原因：应用被系统拦截（macOS 请用户到「隐私与安全性」点「仍要打开」；Windows 点「仍要运行」） |
| `MCP_INFO_FAILED` / `MCP_INFO_INVALID` / `REGISTER_FAILED` | 把输出告诉用户 |
| `NO_CLAUDE_CLI` | 请用户先安装 Claude Code 命令行 |

## 完成后告诉用户

- 已接入，**需要开一个新的 Claude Code 会话**才能看到这些工具（已经开着的会话不会加载新登记的 MCP 服务器）。
- 可以这样说：「用 ai-video 看看有哪些模型」「用 ai-video 的 Seedream 5.0 flash 生成一张……，先预览请求和费用给我看」。
- 桌面版要保持运行：macOS 上关窗口不会退出（⌘Q 才会）；**Windows 上关掉窗口就会退出**，可以最小化。
- 生成要用到 BytePlus / MiniMax 的 API Key，在桌面版「设置」里填；生成会产生费用，工具结果里附预估费用。
- 以后如果在桌面版里轮换了令牌、或者 agent 报 401，重跑「启动并接入」那一步即可（它会先删掉旧的登记）。

## 其他情况

- **401 重跑后仍然存在**：用 `claude mcp list` 看看某个项目里是否还有同名的 local / project 级 `ai-video` 登记，用 `claude mcp remove ai-video --scope local`（或 `--scope project`）删掉。
- **从源码运行（`npm start` / `npm run dev`）而不是桌面版**：数据目录是仓库下的 `data/`，端口默认 8787。地址和令牌可以用 `curl -fsS http://127.0.0.1:8787/api/mcp -H "x-ark-client: web"` 取得，登记命令同上。
- **不是 Claude Code 的 agent**：MCP 服务器是本机 Streamable HTTP，地址和令牌同样从 `/api/mcp` 取得（`url`、`token` 字段），请求头 `Authorization: Bearer <令牌>`；按你自己的 MCP 配置方式登记即可。
- 工具列表与用法见 [`docs/mcp.md`](mcp.md)。
