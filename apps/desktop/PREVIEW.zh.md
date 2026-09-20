# Strugend Harness 测试预览版

此预览版使用您自己的 API 密钥。计费和 Strugend 托管订阅尚未启用。服务商用量由对应密钥的服务商收费；下载内容不包含任何服务商密钥。

请选择 Windows x64 安装程序、适用于 Apple Silicon 的 macOS arm64 下载，或适用于 Intel 的 macOS x64 下载。这些测试版本没有开发者证书签名；macOS 使用临时签名且未经公证。Windows SmartScreen 或 macOS Gatekeeper 可能要求用户明确确认后才能打开。请使用随附的 SHA256 文件核对下载产物。

打开设置 → 智能服务，添加 Core 密钥。Decision（Jev）和 Memory（Chronograph）是可选服务；测试时再配置。密钥由操作系统加密并保存在本地。应用不包含托管计费服务或共享图数据库。

预览版包含浏览器、文件、终端、技能、分组、队列及视频工作室。视频渲染要求本机安装 FFmpeg 和 FFprobe 并将其加入 PATH；修改 PATH 后请重启 Strugend。也可通过 AGENT_OS_FFMPEG 和 AGENT_OS_FFPROBE 提供可执行文件的绝对路径。测试发布流程前必须登录社交账户。

此预览版没有自动更新功能。后续预览版需手动安装。真实服务商及社交账户流程仍需使用您自己的密钥和账户测试；夹具测试通过并不代表已验证这些服务。
