# Retained Agent OS artwork

English | [中文](README.zh.md)

These retained Agent OS assets use a folded titanium A with a blue underside. Strugend uses the separate mark in `apps/desktop/resources/strugend` and `apps/web/public/assets/strugend`; see [the current product direction](../../STRUGEND_PLAN.md).

## Assets

- `agent-os-mark-master.png`: original transparent logo, 1254 × 1254.
- `agent-os-icon-master.png`: original transparent Dock tile, 1254 × 1254.
- `../../apps/web/public/assets/agent-os/`: optimized PNG exports for startup, sidebar, browser, and installed web shortcuts.
- `../../apps/desktop/resources/agent-os/`: 1024-pixel icon and macOS ICNS with 16–1024-pixel representations.

Masters were created with the built-in image generation tool. Exports preserve alpha and only resize/re-encode the masters; no runtime image service is required. Keep the masters and export names together when updating the identity. The original Harness assets are retained separately.

## Loading screen

The retained startup design presents the mark over graphite, with a quiet breathing movement and a small indeterminate light track. It has a corresponding pale appearance for a light system theme. Reduced motion disables both animations. There is no imposed startup delay or invented progress percentage; the existing application loader controls the handoff. English and Chinese startup copy is local. Errors retain their diagnostic text and stop the mark animation.

## Generation prompts

Mode: built-in image generation. The second prompt used the first image as its reference.

### Transparent mark

```text
Create a production-ready original app logo icon for 'Agent OS', a premium macOS AI agent workspace. Output one centered symbol ONLY, no text, no letters spelled out, no mockup, no presentation board. Design: an elegant continuous folded ribbon forming a distinctive abstract capital A / upward portal, with a crisp triangular negative-space aperture. Two broad balanced tapering legs with an asymmetric short forward-pointing upper fold; feels like intentional action and intelligent navigation. Simple silhouette readable at 24px. Polished restrained satin titanium, icy white upper planes, subtle periwinkle-blue to cool lavender underside, very subtle dimensional bevels; premium industrial design, precise vector-like edges. Avoid robot faces, brains, sparkles, circuit boards, rings, whale motifs, knots, and existing brand logos. Transparent alpha background, fully isolated emblem, no app tile, no background or cast shadow, generous 16% clear margins on all four sides. Square 1024x1024 composition, central symbol occupies about 68% width and 70% height. Beautiful confident geometry suitable for a dark graphite interface and a macOS Dock icon. One coherent solid mark, minimal complexity.
```

### Dock tile

```text
Create the macOS app-icon companion of this exact Agent OS emblem. Preserve this exact folded titanium A emblem geometry, aperture, broad ribbon folds, silver face, and periwinkle underside. Cleanly reduce it and center it inside a beautiful deep graphite rounded-square macOS icon tile with subtle rounded beveled edge, extremely restrained top-left light. Icon silhouette: 824 by 824 rounded square centered on a 1024 by 1024 transparent alpha canvas, continuous corners radius 182, leaving equal transparent margin of 100 pixels. The emblem occupies 64% of the tile width and 64% of the tile height with balanced breathing room. It should look like a premium finished macOS Dock icon with rich charcoal contrast. No lettering, no words, no additional symbols, no border outside the tile, no extra backdrop, no long shadow, no glow outside the tile. Outside the rounded tile must be truly transparent. Single front-on icon, not a mockup. Preserve exact logo, smooth clean anti-aliased edges at small sizes.
```
