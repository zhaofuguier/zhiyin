# UI Audit — Homepage to Playback and Scenes

## Audit scope

- Product surface: 知音移动端首页、播放页、场景页。
- User goal: 从首页选择音乐空间，在播放页沉浸观看与控制音频，并可继续探索同场景内容。
- Viewport: 390 × 844。
- Evidence folder: `D:\\知音项目\\outputs\\ui-audit`。

## Step 1 — 首页

- Evidence: `01-home.png`
- Health: healthy; no actionable P0/P1/P2 issues.
- Strengths: 2 × 2 scene entry is clear, today’s space is visually dominant, media is consistently 16:9, and the separate “进入声境” CTA remains removed without weakening discoverability.
- Residual P3: the search control has no search icon; its label and touch target remain understandable.

## Step 2 — 播放页

- Before evidence: `02-player-before.png`
- After evidence: `04-player-after.png`
- Health after fixes: healthy.
- Earlier P2 findings: duplicated landscape entry, handcrafted/text-symbol transport and favorite icons, no visible video-effect selection, and fixed rpx media proportions.
- Fixes: kept one “横屏沉浸” entry inside the 16:9 visual; replaced symbol/CSS icons with existing raster assets or explicit text labels; added a working “原画 / 柔和 / 静谧” effect sheet; strengthened the media-derived background; normalized 16:9 media and safe-area spacing.
- Interaction checks: landscape entry remains on playback only; visual-effect selection updates the button label and the rendered CSS filter; complete hero remains 16:9.

## Step 3 — 画面效果面板

- Evidence: `05-player-effect-sheet.png`
- Health: healthy.
- Strengths: the sheet explains that effects are non-destructive, shows a clear current state, and keeps the three options short enough for phone use.

## Step 4 — 场景页

- Before evidence: `03-categories-before.png`
- After evidence: `06-categories-after.png`
- Health after fixes: healthy.
- Earlier P2 findings: visible browser scrollbar in the scene-chip row, weak indication that more categories exist, and panoramic cards that did not preserve the product’s 16:9 media contract.
- Fixes: hid the technical scrollbar, sized chips so the next category peeks into view, matched the neutral homepage shell, and converted content cards to measured 1.778:1 media frames.
- Interaction checks: scene selection updates the heading and list; sort selection updates the active state.

## Accessibility and evidence limits

- Visible touch targets are large enough for phone interaction and text remains readable over the tested covers.
- Screenshots cannot prove screen-reader semantics, keyboard focus order, or full WCAG compliance.
- Demo audio URLs are empty and the configured external API was unavailable in the clean player check. Local fallback content rendered correctly, but real audio start, network recovery, and production video fullscreen require integration testing with uploaded media and a reachable backend.

## Final assessment

- Homepage: proceed; P3 polish only.
- Playback page: P2 findings resolved.
- Scene page: P2 findings resolved.
- Recommended next surface: search and upload/management flow, because the newly agreed cover/title/description rules should be enforced there.
