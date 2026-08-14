# 国内部署说明

项目已经改为标准 Node.js + SQLite 服务，不依赖 Cloudflare、D1 或其他境外运行平台。可部署到阿里云、腾讯云、华为云等任意支持 Docker 的国内云服务器。

## 服务器要求

- 1 核 1 GB 或更高配置的 Linux 云服务器
- Docker 与 Docker Compose
- 安全组放行 80/443（临时测试可放行 3000）

## 启动

将项目上传到服务器后，在项目目录执行：

```bash
docker compose up -d --build
```

浏览器访问 `http://服务器公网IP:3000`。房间数据保存在项目的 `data` 目录，重启容器不会丢失。

## 域名与 HTTPS

正式上线建议在容器前配置 Nginx 或云厂商负载均衡，将域名的 80/443 端口反向代理到 `127.0.0.1:3000`。域名若解析到中国大陆服务器，需要先完成 ICP 备案；使用中国香港节点通常无需备案。

## 非 Docker 启动

服务器需安装 Node.js 22：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

可通过 `PORT`、`HOST`、`DATA_DIR`、`STATIC_DIR` 环境变量调整端口、监听地址、数据目录和前端文件目录。
