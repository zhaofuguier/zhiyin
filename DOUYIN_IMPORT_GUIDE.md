# 知音抖音小程序导入说明

## 1. 已生成的导入目录

抖音开发者工具请选择导入这个目录：

```text
C:\Users\whzha\Documents\Codex\2026-06-06\new-chat\work\zhiyin-miniapp\dist\build\mp-toutiao
```

不要导入 `zhiyin-miniapp` 根目录。根目录是 uni-app 源码工程，抖音开发者工具需要的是编译后的 `mp-toutiao` 目录。

## 2. 导入时怎么填

- 项目目录：选择 `dist\build\mp-toutiao`
- 项目名称：知音
- AppID：`ttf55d83e06b3ae89901`
- 后端服务：不使用云服务

## 3. 后续每次改代码后

在 `zhiyin-miniapp` 目录重新编译：

```text
npm.cmd run build:mp-toutiao
```

然后回到抖音开发者工具刷新或重新编译即可。

## 4. 当前阶段说明

现在是第一版可继续迭代的工程骨架，已经包含：

- 首页
- 分类页
- 播放页
- 收藏页
- 我的页
- 学生模式
- 学生场景推荐：写作业、自习、备考、背书、午休、睡前
- 精选、最新、热门三种排序
- 通用音乐空间匹配逻辑，例如“雨夜白噪音”可以进入多个场景
- 抖音小程序 AppID 配置
- 音乐空间演示数据
- 预留后端 API 连接能力
- 播放页真实音频播放能力
- 16:9 图片预览与循环微动画展示
- 微动画横屏满屏入口

如果暂时没有正式服务器，小程序会自动使用本地演示数据。

如果后续有正式后端域名，把后端地址填到：

```text
src/services/config.ts
```

例如：

```text
export const API_BASE_URL = 'https://api.example.com';
```

然后重新执行编译，再导入抖音开发者工具。

注意：真实上线前，音频、图片和微动画 URL 需要使用抖音小程序允许访问的 HTTPS 域名，并在平台后台配置合法域名。
