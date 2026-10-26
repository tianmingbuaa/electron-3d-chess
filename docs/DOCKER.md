# Docker 容器运行

项目提供一个面向浏览器模式的 Docker 镜像：同一容器内提供静态前端、HTTP API 和 WebSocket 棋局服务。容器内不包含 Electron，也不需要运行时 `node_modules`。

## 1. 构建并运行

```bash
docker build -t nocturne-chess-web:local .
docker run --rm \
  --name nocturne-chess-web \
  -p 127.0.0.1:8787:8787 \
  nocturne-chess-web:local
```

然后在浏览器打开：

```text
http://127.0.0.1:8787/
```

容器日志会打印监听地址。按 `Ctrl+C` 停止 `docker run`；使用后台模式时用 `docker stop`。

也可以使用 Compose：

```bash
docker compose up --build
# 浏览器打开 http://127.0.0.1:8787/
docker compose down
```

`compose.yaml` 默认已经把宿主机端口绑定到 `127.0.0.1`，不会把无认证的游戏服务暴露到局域网。

## 2. 镜像结构

```text
Dockerfile
├─ build stage（node:24-bookworm-slim）
│  ├─ 只安装 web/server 的 pnpm 依赖（不安装 Electron）
│  ├─ Vite 构建 apps/web/dist
│  └─ tsup 将 apps/server + ws + chess.js + shared 打包为单个 server.cjs
└─ runtime stage（node:24-bookworm-slim）
   ├─ apps/web/dist
   ├─ apps/server/server.cjs
   ├─ scripts/serve-web.mjs
   └─ 非 root 用户 node，暴露 8787，带 Node fetch 健康检查
```

- **多阶段构建**：构建依赖只存在于 builder 层，运行镜像没有 pnpm、Vite 或游戏业务源码。
- **自包含服务端**：`apps/server/tsup.container.config.ts` 将 `ws`、`chess.js` 与共享协议一起打包进 `server.cjs`，运行阶段无需安装任何 npm 包。
- **非 root**：运行用户为官方镜像内置的 `node`。
- **健康检查**：每 30 秒请求 `/api/health`，启动宽限期 10 秒。
- **优雅停止**：Node 进程处理 SIGTERM，关闭 HTTP/WebSocket 服务；Compose 设置 10 秒停止宽限。
- **端口**：容器内固定以 `CHESS_HOST=0.0.0.0` 监听 8787，宿主机通过 `-p` 显式发布。

## 3. 配置

镜像内已经设置：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CHESS_HOST` | `0.0.0.0` | 容器内必须监听非 loopback 地址才能被端口映射访问 |
| `CHESS_PORT` | `8787` | 服务端口 |
| `CHESS_NO_OPEN` | `1` | 不在容器内尝试打开浏览器 |
| `CHESS_STATIC_DIR` | `/app/apps/web/dist` | 构建后的前端 |
| `CHESS_SERVER_ENTRY` | `/app/apps/server/server.cjs` | 自包含后端 |

如需换端口：

```bash
docker run --rm \
  -e CHESS_PORT=9000 \
  -p 127.0.0.1:9000:9000 \
  nocturne-chess-web:local
```

健康检查使用 `CHESS_PORT`，因此自定义端口仍然有效。

## 4. 单机 / 安全边界

该项目按需求面向**本机单人试玩**：

- 不需要登录、账号或用户认证；
- 不使用 HTTPS；
- 容器内的服务监听 `0.0.0.0` 只是为了 Docker 端口映射；
- 示例始终发布到宿主机 `127.0.0.1`，因此只有本机能访问。

如果把端口发布成所有网卡（如 `-p 8787:8787`），这套无认证服务就可能被局域网访问。项目默认**不建议**这样做；若要远程访问，应在前面加鉴权、TLS 反代和访问控制。

棋局保存在容器进程内存中：容器重启或浏览器刷新后会开始新对局。这是当前单机模式的设计边界。

## 5. 构建缓存与验证

```bash
# 仅构建镜像
docker build -t nocturne-chess-web:local .

# 启动后检查
curl -fsS http://127.0.0.1:8787/api/health
curl -fsS http://127.0.0.1:8787/api/runtime
curl -fsS http://127.0.0.1:8787/ | grep -q "Nocturne Chess"

# 健康状态
docker inspect --format '{{.State.Health.Status}}' nocturne-chess-web
```

`Dockerfile` 的构建层先复制 manifests 再复制源码，以便依赖层可缓存。CI 中也有独立的 Docker job 做镜像构建、运行与 HTTP 冒烟测试。

本地实测（Docker 26.1.5 / Linux）：

| 检查 | 结果 |
| --- | --- |
| `docker build` | 通过 |
| `docker run` + 端口映射 | 通过，页面正常 |
| 容器健康检查 | `healthy` |
| 容器进程用户 | `uid=1000(node)` |
| 页面 / `/api/health` / `/api/runtime` / favicon | 通过 |
| 浏览器原生 WebSocket `e2→e4` | 通过 |
| 真实浏览器 1440×960 渲染 | 通过（Brave headless） |
| `docker compose up --build` | 通过 |
| `docker stop` | Node 进程捕获 SIGTERM 并优雅关闭 |
| 镜像体积 | 约 232 MB（未压缩） |

## 6. 常见问题

**宿主机 8787 已被本地 `pnpm web` 占用**
停止本地进程，或把宿主机端口换掉：

```bash
docker run --rm -p 127.0.0.1:8788:8787 nocturne-chess-web:local
# 打开 http://127.0.0.1:8788/
```

**容器启动后无法访问**
确认 `docker ps` 显示容器在运行，并使用 `127.0.0.1:<宿主机端口>`；不要直接访问容器内部的 `0.0.0.0`。

**为什么仍需要 `serve-web.mjs`**
它是容器/本地共用的小型启动器，负责读取构建产物、绑定端口、打印 URL、处理 SIGINT/SIGTERM；不包含业务逻辑。

**镜像里为什么不包含 Electron**
浏览器模式不需要 Electron。桌面安装包仍由原来的 electron-builder 流程生成，和 Docker 镜像相互独立。
