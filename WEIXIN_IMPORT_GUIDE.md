# 知音微信小程序导入说明

## 1. 微信导入目录

微信开发者工具请选择导入这个目录：

```text
C:\Users\whzha\Documents\Codex\2026-06-06\new-chat\work\zhiyin-miniapp\dist\build\mp-weixin
```

不要导入 `zhiyin-miniapp` 根目录。根目录是 uni-app 源码工程，微信开发者工具需要的是编译后的 `mp-weixin` 目录。

## 2. 导入时怎么填

- 项目目录：选择 `dist\build\mp-weixin`
- 项目名称：知音
- AppID：填写你在微信公众平台申请到的小程序 AppID
- 后端服务：不使用云服务

微信 AppID 位置：

```text
src/manifest.json
```

当前配置里 `mp-weixin.appid` 为空，拿到微信 AppID 后填进去：

```json
"mp-weixin": {
  "appid": "你的小程序AppID"
}
```

## 3. 每次改完代码后

只构建微信小程序：

```text
npm.cmd run build:mp-weixin
```

同时构建抖音和微信两个小程序：

```text
npm.cmd run build:miniapps
```

## 4. 正式上线前注意

- 微信后台需要配置合法请求域名，指向正式 HTTPS 后端。
- 音频、图片、微动画所在域名也要配置为合法下载或媒体域名。
- 会员支付需要从当前开发版模拟支付，替换为微信支付。
- 抖音和微信可以共用同一套后端、后台、音乐空间数据和素材字段。

