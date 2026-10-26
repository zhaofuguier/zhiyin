# 数据备份现状

检查日期：2026-10-26。范围是本机 `D:\zhiyin\api` 与 `D:\zhiyin\admin`。本轮没有配置云备份。

**结论：仅本机，发布风险。** 没有定时任务、没有异地副本、对象存储备份桶未配置。磁盘损坏或误删后，JSON 数据和本地上传文件无法从别处恢复。

## 现在有什么

- API 默认 `PERSISTENCE_PROVIDER=json`（见 `zhiyin-api/.env.example`）。业务数据是本机文件，目录默认是 API 的 `data/`：
  - `data/users.json`
  - `data/music-spaces.json`
  - `data/user-activity.json`
  - `data/orders.json`
  - `data/audit-logs.json`
  - `feedback.json` 由代码在同一 `data/` 目录按需创建，检查时目录里还没有这个文件。
- 媒体默认 `STORAGE_PROVIDER=local`。上传文件在 API 的 `uploads/`。检查时该目录只有本地图片，没有远程副本。
- 管理端没有自己的 `data/*.json`。它通过 API 读写，数据只在 API 这侧。
- `GET /backups/export`（管理员令牌）会把上述 JSON 数据集读出来作为一次 HTTP 响应，并写一条 `backup.export` 审计。它不落盘、不上传、不按计划执行。
- 隐私治理写入时会做一份临时目录备份，操作结束后删除。这不是保留备份。
- `.env.example` 里有 `S3_COMPATIBLE_BACKUP_BUCKET`，但示例状态是 `OBJECT_STORAGE_CREDENTIALS_STATUS=NOT_CONFIGURED`，当前存储提供者是 `local`。备份桶没有接入这台机器。

## 没有什么

- 没有云备份、对象存储备份桶、或异地磁盘副本。
- 没有 cron / 计划任务去跑导出或复制 `data/`、`uploads/`。
- 管理端没有独立数据目录可备份。
- `package-lock.json` 和代码仓库不是数据备份。
