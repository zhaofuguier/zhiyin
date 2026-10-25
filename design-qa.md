# Design QA — H5 Mobile Shell

## Evidence

- Source visual truth path: `D:\知音项目\work\zhiyin-miniapp\design-reference-mobile-shell.png`
- Implementation screenshot path: `D:\知音项目\work\zhiyin-miniapp\h5-mobile-shell-home-390x844.png`
- Desktop implementation screenshot path: `D:\知音项目\work\zhiyin-miniapp\h5-mobile-shell-home.png`
- Player screenshot path: `D:\知音项目\work\zhiyin-miniapp\h5-mobile-shell-player.png`
- Effect-sheet screenshot path: `D:\知音项目\work\zhiyin-miniapp\h5-mobile-shell-player-effect.png`
- Combined comparison path: `D:\知音项目\work\zhiyin-miniapp\design-qa-mobile-shell-comparison.jpg`
- Viewports: desktop 1422 × 800 CSS px; mobile 390 × 844 CSS px
- State: home ready; player ready; visual-effect sheet open

## Full-view comparison evidence

The Tingchan reference and the 390 × 844 Zhiyin render were normalized and inspected together in the combined comparison. The intended shared behavior is the centered, fixed-width mobile canvas—not the unrelated product content or visual language. Zhiyin now renders edge-to-edge at phone width and as a centered 430 px canvas with neutral side gutters on desktop.

## Focused-region comparison evidence

Separate browser captures were checked for the top navigation, fixed bottom tab bar, player ambient background, and visual-effect mask/sheet. These regions required focused checks because fixed-position elements previously escaped or shifted with the page scroll.

## Findings

- No actionable P0, P1, or P2 differences remain for the mobile-shell target.
- Fonts and typography: existing Zhiyin type tokens and the approved larger mobile Chinese text are preserved; no clipping, forced wrapping, or density regression was introduced.
- Spacing and layout rhythm: desktop canvas width is 430 px; mobile canvas width is 390 px; top navigation, content, and tab bar share the same horizontal bounds.
- Colors and visual tokens: the current Zhiyin light palette remains unchanged; the desktop-only neutral gutter and subtle canvas shadow match the reference shell behavior without recoloring product content.
- Image quality and asset fidelity: all existing scene covers remain source assets with their established crop behavior; no placeholder, CSS-drawn, or replacement imagery was introduced.
- Copy and content: product labels and music-space data are unchanged.
- Responsiveness: no horizontal overflow at 390 px; the desktop document scroll width equals its client width; the player fixed background and effect sheet remain constrained to the 430 px canvas.
- Accessibility and interactions: existing tap targets remain intact; home-to-player navigation works; the effect-sheet mask covers the complete mobile canvas after scrolling.

## Comparison history

1. Pass 1 — P1: fixed 430 px canvas worked, but `#app` became a scroll container and retained scroll offset during route changes. Fix: removed the transformed scrolling container behavior.
2. Pass 2 — P1: after removing the app transform, Uni top/bottom navigation expanded to the desktop viewport. Fix: constrained `.uni-page-head` and `.uni-tabbar` directly to `min(100vw, 430px)` and centered them.
3. Pass 2 — P2: player background and visual-effect mask could escape the shell or move with the player scroller. Fix: centered the fixed player layers independently at 430 px while keeping them viewport-fixed.
4. Pass 3 — P2: narrow desktop emulation reserved a scrollbar gutter and reduced the phone canvas. Fix: limited stable scrollbar gutters to desktop and hid browser scrollbars at the phone breakpoint.
5. Final pass: desktop and mobile dimensions, player fixed layers, effect sheet, and console were rechecked; no actionable P0/P1/P2 findings remain.

## Primary interactions tested

- Opened the home page and entered the player through the primary hero card.
- Opened “画面效果” and verified the mask and sheet remain exactly within the 430 px canvas.
- Verified the mobile breakpoint at 390 × 844 and desktop centering at 1422 × 800.
- Checked the final browser console: no errors.
- Verified local H5 URL returns HTTP 200.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 21/21 passed.

## Follow-up polish

- P3: the neutral desktop gutter can later be promoted into a branded texture if the product establishes a desktop-web art direction. The current solid neutral surface deliberately follows the reference shell and keeps attention on the mobile product.

final result: passed