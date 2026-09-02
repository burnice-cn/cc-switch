# CC Switch

CC Switch 是一个用于管理 Claude Code、Codex 等多种 CLI 供应商配置的工具。当前仓库已重构为前后端分离架构，后端可以部署到任意电脑，前端可以在浏览器中切换不同的后端服务器。

## 项目结构

```text
cc-switch/
├── front-end/   # React + Vite 前端
└── server/      # Node.js + Fastify 后端
```

- `front-end/`：负责界面展示，构建后输出静态资源。
- `server/`：负责配置存储、REST API、WebSocket 推送和静态资源托管。
- 两个目录互相独立，可以分别安装依赖、构建和部署。

## 环境要求

- Node.js 20 或更高版本
- npm 10

npm 随 Node.js 一起安装，无需单独启用。

## 开发模式

### 1. 启动后端

```bash
cd server
npm install
npm run dev
```

后端默认监听：

```text
http://0.0.0.0:37800
```

### 2. 启动前端

```bash
cd front-end
npm install
npm run dev
```

前端开发服务器默认监听：

```text
http://localhost:3000
```

开发模式下，Vite 会将 `/api` 和 `/ws` 代理到 `http://localhost:37800`。如果后端不在本机或端口不同，需要修改 `front-end/vite.config.ts` 中的代理配置。

## 构建与部署

### 构建前端

```bash
cd front-end
npm install
npm run build
```

构建产物位于：

```text
front-end/dist/
```

### 构建并启动后端

```bash
cd server
npm install
npm run build
npm run start
```

后端默认会尝试托管以下目录中的前端静态文件：

```text
../front-end/dist
```

因此，如果后端和前端构建产物保持上面的相对位置，直接访问后端端口即可。

## 独立部署前端

也可以把 `front-end/dist/` 部署到 Nginx、Caddy 或其他静态文件服务器。

前端启动后，可以在“设置”页面配置并切换后端服务器地址。REST 和 WebSocket 地址会根据当前选择的后端动态生成。

## 后端环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CC_SWITCH_HOST` | `0.0.0.0` | 后端监听地址 |
| `CC_SWITCH_PORT` | `37800` | 后端监听端口 |
| `CC_SWITCH_CONFIG_DIR` | `~/.cc-switch` | 配置和数据目录 |
| `CC_SWITCH_DB_PATH` | `<配置目录>/cc-switch.db` | SQLite 数据库路径 |
| `CC_SWITCH_SETTINGS_PATH` | `<配置目录>/settings.json` | 设置文件路径 |
| `CC_SWITCH_STATIC_DIR` | `../front-end/dist` | 前端静态资源目录 |

示例：

```bash
cd server
CC_SWITCH_HOST=0.0.0.0 \
CC_SWITCH_PORT=37800 \
CC_SWITCH_CONFIG_DIR=/data/cc-switch \
CC_SWITCH_DB_PATH=/data/cc-switch/cc-switch.db \
CC_SWITCH_SETTINGS_PATH=/data/cc-switch/settings.json \
CC_SWITCH_STATIC_DIR=/data/cc-switch/front-end-dist \
npm run start
```

## 常用检查

在 `front-end/` 中执行：

```bash
npm run typecheck
npm run test:unit
```

在 `server/` 中执行：

```bash
npm run build
```

服务启动后可以访问健康检查接口：

```bash
curl http://localhost:37800/api/health
```

## 安全提示

当前后端 API 允许跨域访问，并且没有内置用户认证。请不要直接暴露到公网。建议只在以下环境中使用：

- 本机
- 可信内网
- VPN 或受防火墙保护的网络

如果需要公网部署，应在前方加入认证、HTTPS 和访问控制。
