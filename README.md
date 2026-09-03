# CC Switch

CC Switch 是一个用于管理 Claude Code、Codex 等多种 CLI 供应商配置的工具。当前仓库已重构为前后端分离架构，后端可以部署到任意电脑，前端可以在浏览器中切换不同的后端服务器。

## 关于本项目

本项目由 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 重写而来。

## 项目结构

```text
cc-switch/
├── front-end/   # React + Vite 前端
└── server/      # Node.js + Fastify 后端
```

- `front-end/`：负责界面展示，构建后输出静态资源。
- `server/`：负责配置存储、REST API 和 WebSocket 推送。
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
http://localhost:37801
```

开发模式下，Vite 会将 `/api` 和 `/ws` 代理到 `http://localhost:37800`。如果后端不在本机或端口不同，需要修改 `front-end/vite.config.ts` 中的代理配置。

## 构建与部署

### 1. 构建产物

```bash
# 后端
cd server
npm ci
npm run build          # 产物：server/dist/

# 前端
cd ../front-end
npm ci
npm run build          # 产物：front-end/dist/
```

前端使用相对路径（`base: "./"`），`dist/` 可以部署到任意目录或子路径。

### 2. 部署后端（Ubuntu）

以下方式把后端部署为用户级 systemd 服务，数据沿用 `~/.cc-switch`，无需 root。

```bash
# 停止旧的开发服务后构建
cd server
npm run build

# 部署生产目录（只复制构建产物和清单，node_modules 重新安装）
mkdir -p ~/.cc-switch-web/server
cp -r dist package.json package-lock.json ~/.cc-switch-web/server/
cd ~/.cc-switch-web/server
npm ci --omit=dev

# 备份数据目录（可选但推荐）
tar -czf ~/cc-switch-data-backup-$(date +%Y%m%d).tar.gz -C ~ .cc-switch
```

创建用户级 systemd 服务 `~/.config/systemd/user/cc-switch-backend.service`：

```ini
[Unit]
Description=CC Switch backend
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/.cc-switch-web/server
ExecStart=%h/.nvm/versions/node/v22.18.0/bin/node dist/index.js
Environment=CC_SWITCH_HOST=0.0.0.0
Environment=CC_SWITCH_PORT=37800
Environment=CC_SWITCH_CONFIG_DIR=%h/.cc-switch
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

> `ExecStart` 请替换为 `which node` 输出的实际路径；使用 nvm 时建议写死绝对路径，避免 systemd 找不到 node。
> 用户级服务开机自启需要 `loginctl enable-linger $USER`（Ubuntu 桌面/ WSL systemd 环境通常已默认开启，可先 `loginctl show-user $USER -p Linger` 确认）。

启动并设为开机自启：

```bash
systemctl --user daemon-reload
systemctl --user enable --now cc-switch-backend
systemctl --user status cc-switch-backend
```

验证：

```bash
curl http://127.0.0.1:37800/api/health
```

常用维护：

```bash
systemctl --user restart cc-switch-backend
journalctl --user -u cc-switch-backend -f -n 100
```

若部署在 WSL 中，Windows 重启后需要主动拉起 WSL，可在 Windows 管理员命令行添加计划任务：

```bat
schtasks /create /tn "cc-switch-wsl-boot" /tr "wsl.exe --distribution Ubuntu --exec /bin/true" /sc onstart /ru SYSTEM /rl highest
```

### 3. 部署前端（Windows Nginx）

把 `front-end/dist/` 复制到 Nginx 的站点目录（示例为 `html/cc-switch`），并添加如下 `server` 块：

```nginx
server {
    listen 37801;
    server_name _;

    root html/cc-switch;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:37800;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://127.0.0.1:37800;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

```powershell
# 检查配置
D:\Software\nginx-1.31.3\nginx.exe -t
# 后台启动
Start-Process -FilePath "D:\Software\nginx-1.31.3\nginx.exe" -WorkingDirectory "D:\Software\nginx-1.31.3"
```

验证：

```bat
curl http://localhost:37801/api/health
```

前端访问地址：`http://localhost:37801/`。默认后端地址为 `http://<主机名>:37800`；如从局域网访问，在页面“设置 → 后端服务器”中填 `http://<Windows 机器 IP>:37801`（走 Nginx 的 `/api`、`/ws` 代理），并在 Windows 防火墙放行对应端口。

### 4. 独立部署前端

也可以把 `front-end/dist/` 部署到任意的静态文件服务器，例如 Nginx、Caddy 或对象存储静态站点。前端部署后，在“设置”页面配置并切换后端服务器地址，REST 和 WebSocket 地址会根据当前选择的后端动态生成。

## 后端环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CC_SWITCH_HOST` | `0.0.0.0` | 后端监听地址 |
| `CC_SWITCH_PORT` | `37800` | 后端监听端口 |
| `CC_SWITCH_CONFIG_DIR` | `~/.cc-switch` | 配置和数据目录 |
| `CC_SWITCH_DB_PATH` | `<配置目录>/cc-switch.db` | SQLite 数据库路径 |
| `CC_SWITCH_SETTINGS_PATH` | `<配置目录>/settings.json` | 设置文件路径 |

示例：

```bash
cd server
CC_SWITCH_HOST=0.0.0.0 \
CC_SWITCH_PORT=37800 \
CC_SWITCH_CONFIG_DIR=/data/cc-switch \
CC_SWITCH_DB_PATH=/data/cc-switch/cc-switch.db \
CC_SWITCH_SETTINGS_PATH=/data/cc-switch/settings.json \
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
