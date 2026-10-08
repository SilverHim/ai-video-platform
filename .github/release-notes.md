本机运行的 AI 图像 / 视频生成平台（BytePlus Seedream / Seedance、MiniMax image-01 / H3，支持 MCP）。

## 下载

| 系统 | 文件 |
|---|---|
| macOS（Apple 芯片；不支持 Intel Mac） | `ai-video-platform-<版本>-mac-arm64.dmg` |
| Windows 10/11（x64） | `ai-video-platform-<版本>-win-x64-setup.exe` |

## 第一次打开（安装包没有付费签名）

- **macOS**：把应用拖进「应用程序」，先双击打开一次（会提示无法验证开发者），然后到「系统设置 › 隐私与安全性」，在页面下方点「仍要打开」（尝试打开后约 1 小时内有效），输入登录密码确认。之后正常打开即可。
- **Windows**：运行安装包时如果出现「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」。开启了「智能应用控制」的 Windows 11 可能直接拦截。

## 说明

- 数据（Key、历史、生成结果）保存在：macOS `~/Library/Application Support/ai-video-platform/data`，Windows `%APPDATA%\ai-video-platform\data`。
- MCP 地址与接入命令见应用内「设置 → MCP 接入」。
- 这一版没有自动更新，新版本请到 Releases 页下载。
