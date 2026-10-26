# 知音小程序

包管理器是 **npm**。锁定文件是仓库根目录的 `package-lock.json`。全新安装用 `npm ci`，不要用浮动的 `latest`。

`npm run typecheck` 和 `npm run test` 都会先执行 `tools/verify-feedback-catalog.cjs`。

- 本机 monorepo（`work/zhiyin-miniapp` 在知音项目目录下）会转交上一级 `tools/verify-feedback-catalog.cjs`，核对三端生成目录和 `shared/` 源文件。
- 只 clone 本 GitHub 仓库时，脚本只检查本仓 `src/shared/*.generated.ts` 是否是可导出的普通文件，因此 `npm run typecheck` 不依赖仓库外路径。

备份现状见 `docs/ops-backup-status.md`。
