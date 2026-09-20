# 保留的 Agent OS 图稿

[English](README.md) | 中文

这些保留的 Agent OS 资源采用带蓝色底面的折叠钛金属 A 标志。Strugend 使用 `apps/desktop/resources/strugend` 和 `apps/web/public/assets/strugend` 中的独立标志；参见[当前产品方向](../../STRUGEND_PLAN.md)。

## 资源

- `agent-os-mark-master.png`：原始透明标志，1254 × 1254。
- `agent-os-icon-master.png`：原始透明 Dock 图标，1254 × 1254。
- `../../apps/web/public/assets/agent-os/`：用于启动、侧栏、浏览器与已安装网页快捷方式的优化 PNG。
- `../../apps/desktop/resources/agent-os/`：1024 像素图标及包含 16–1024 像素表示的 macOS ICNS。

母版由内置图像生成工具创建。导出保留透明度，仅对母版缩放或重新编码；运行时不需要图像服务。更新标识时须保留对应母版和导出名称。原始 Harness 资源单独保留。

## 加载屏幕

保留的启动设计在石墨色背景上呈现标志，采用轻微呼吸动画与不确定进度光轨，并为浅色系统主题提供对应外观。减少动态效果时，两种动画均关闭。不引入额外启动等待或虚构进度百分比；交接由现有应用加载器控制。中英文启动文案在本地提供。发生错误时保留诊断文本并停止标志动画。

## 生成提示词

模式：内置图像生成。第二个提示词将第一张图像作为参考。以下保留原始英文提示词。

### 透明标志

```text
Create a production-ready original app logo icon for 'Agent OS', a premium macOS AI agent workspace. Output one centered symbol ONLY, no text, no letters spelled out, no mockup, no presentation board. Design: an elegant continuous folded ribbon forming a distinctive abstract capital A / upward portal, with a crisp triangular negative-space aperture. Two broad balanced tapering legs with an asymmetric short forward-pointing upper fold; feels like intentional action and intelligent navigation. Simple silhouette readable at 24px. Polished restrained satin titanium, icy white upper planes, subtle periwinkle-blue to cool lavender underside, very subtle dimensional bevels; premium industrial design, precise vector-like edges. Avoid robot faces, brains, sparkles, circuit boards, rings, whale motifs, knots, and existing brand logos. Transparent alpha background, fully isolated emblem, no app tile, no background or cast shadow, generous 16% clear margins on all four sides. Square 1024x1024 composition, central symbol occupies about 68% width and 70% height. Beautiful confident geometry suitable for a dark graphite interface and a macOS Dock icon. One coherent solid mark, minimal complexity.
```

### Dock 图标

```text
Create the macOS app-icon companion of this exact Agent OS emblem. Preserve this exact folded titanium A emblem geometry, aperture, broad ribbon folds, silver face, and periwinkle underside. Cleanly reduce it and center it inside a beautiful deep graphite rounded-square macOS icon tile with subtle rounded beveled edge, extremely restrained top-left light. Icon silhouette: 824 by 824 rounded square centered on a 1024 by 1024 transparent alpha canvas, continuous corners radius 182, leaving equal transparent margin of 100 pixels. The emblem occupies 64% of the tile width and 64% of the tile height with balanced breathing room. It should look like a premium finished macOS Dock icon with rich charcoal contrast. No lettering, no words, no additional symbols, no border outside the tile, no extra backdrop, no long shadow, no glow outside the tile. Outside the rounded tile must be truly transparent. Single front-on icon, not a mockup. Preserve exact logo, smooth clean anti-aliased edges at small sizes.
```
