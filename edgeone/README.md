# 内容多面手 · EdgeOne Pages 部署版

这是「内容多面手」用于 **EdgeOne Pages（Git 自动部署）** 的版本。前端静态页 + `node-functions/` 边缘函数后端，API Key 走环境变量，不硬编码。

## 目录结构

```
edgeone/
├── edgeone.json          # EdgeOne 配置（Node Functions maxDuration 120s）
├── index.html            # 前端页面（部署根）
├── style.css
├── script.js
└── node-functions/
    ├── _shared.js        # prompts + 智谱文案/生图调用 + 工具函数
    └── api/
        ├── generate.js   # POST /api/generate  从零创作
        ├── polish.js     # POST /api/polish    帮我打磨（含网感体检）
        └── image.js      # POST /api/image     单张生图
```

## 在 EdgeOne Pages 控制台首次接入（一次性）

1. 进入 **EdgeOne Pages 控制台 → 创建项目 → 从 Git 导入**，选择仓库 `harryjzhang69-web/content-creator-tool`
2. **根目录（Root Directory）填 `edgeone`**（关键：让 EdgeOne 从这个子目录构建，而不是仓库根的 Express 版本）
3. 框架预设选「无 / 静态」，构建命令留空，输出目录留空（本项目无需构建，纯静态 + Functions）
4. **环境变量**里添加：`ZHIPU_API_KEY = <你的智谱 Key>`（必填，否则文案/配图无法生成）
5. 部署完成后会得到一个固定域名（形如 `xxxxx.edgeone.app`），即永久访问地址

## 之后如何更新

改完代码 `git push` 到 main，EdgeOne 会自动重新部署，网址不变。

## 模型说明

- 文案：智谱 `glm-4.7-flash`（关闭思考模式提速）
- 配图：智谱 `cogview-3-flash`（账号专属配额，同步接口）
- 两者共用同一个 `ZHIPU_API_KEY`
