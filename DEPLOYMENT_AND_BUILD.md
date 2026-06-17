# Clover Gallery - 部署与本地打包手册

## 1. Vercel 云端部署指南

本项目采用前后端分离结构。在构建好前端资源后，支持将完整的纯静态资源或带有后台服务的项目部署到 Vercel。目前项目配置了 `vercel.json` 用于前端路由重写。

### 部署步骤

1. **注册并关联账户**：前往 [Vercel](https://vercel.com/) 注册并绑定你的 GitHub 账户。
2. **导入项目**：在 Vercel 仪表盘点击 **Add New -> Project**，从你的 GitHub 仓库中选择本项目。
3. **配置环境变量**：在部署设置（Environment Variables）中添加：
   - `ADMIN_PASSWORD`：管理员密码（默认：`admin`）
   - `GUEST_PASSWORD`：访客密码（默认：`guest`）
   - `GITCODE_TOKEN`：GitCode 的个人访问令牌 (Personal Access Token)，用于如果后续要接入 GitCode 作为远程图床时进行 API 鉴权。
   - `GITCODE_PROJECT_ID`：用于存储图片的 GitCode 目标仓库项目 ID（例如 `your-username/your-repo` 或纯数字 ID）。
4. **构建命令**：
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. **部署**：点击 Deploy 即刻完成自动化部署。

> **⚠️ 常见错误：部署后登录出现 HTTP 405 (Method Not Allowed)？**
> 
> **原因分析**：这是由于前端被部署到了 Vercel 等静态托管平台，由于我们的纯静态重写规则，导致您的 `POST /api/login` 请求被当作访问静态页面的 GET 请求处理，引发 405 报错。
> 更核心的原因是：Vercel 是**无状态 Serverless** 平台，不支持直接运行本地的文件读写后台服务（例如 Node Express 或 FastAPI），您单纯部署前端上去后，后台服务（负责验证密码和读写本地 `data/db.json`）并未启动。
> 
> **解决方案**：
> 1. 我们已更新了项目中 `vercel.json` 的路由规则，避免将 `/api` 的请求拦截到前端静态文件。
> 2. 但由于应用依赖本地文件持久化存储 (`db.json` 和 `uploads/`)，**不推荐**将此项目以后端模式直接部署在 Vercel（每次请求会导致文件重置，图片丢失）。
> 3. **最佳部署方案**：
>    - **本地独立运行**：使用附带的 `start.bat` 一键启动或打包为 Windows `.exe` 单文件。
>    - **云端服务器部署**：将代码放置在自己的 VPS/云服务器上（如阿里云/腾讯云 Linux），使用 `pm2 start server.ts --interpreter tsx` 或 Docker 后台运行。
>    - **前后端分离部署方案**：将前端（`dist`）部署至 Vercel，将后端服务端部署至 Railway/Render/自己的云服务器，并在前端环境变量中设置相应的 API 跨域转发。

### 🌐 Cloudflare 域名解析与 418 报错处理 (重要)

当我们在 Vercel 上部署并使用 **Cloudflare** 作为 DNS 和 CDN 服务时，在下载某些类型的文件或进行批量下载时，偶尔会遇到 HTTP `418 I'm a teapot` 或浏览器无响应的问题。这通常是因为 Cloudflare 的 WAF (Web Application Firewall) 防火墙规则拦截了机器人类请求，或是 Vercel 拦截了非规范的请求载荷。

**解决方案：**

1. **代码层面已优化**：项目中我们使用了 `Blob` 结合 `JSZip` 在浏览器内存中构建压缩包来触发下载（针对批量下载），并且单独提供了 `/api/proxy_download` 接口，强制加上了 `Content-Disposition: attachment` 头，避免由于 URL 过长或二进制数据特征被截断。
2. **Cloudflare WAF 配置调整**：
   - 登录 Cloudflare -> 进入相关域名 -> 安全 (Security) -> WAF。
   - 查找被拦截的规则日志（如果存在由 Bot Fight Mode 引起的 418）。
   - 可在 **Page Rules (页面规则)** 或 **Skip Rules (跳过规则)** 选择您的 API 路径或下载路径（例如：`*yourdomain.com/api/proxy_download*`），关闭 "Bot Fight Mode" 或降低安全级别。
   - 关闭浏览器完整性检查 (Browser Integrity Check) 对于下载路由的支持。
3. **取消云朵代理 (仅 DNS)**：如果依旧被 Vercel/Cloudflare 共同限流拦截，最简单粗暴的方法是在 Cloudflare 的 DNS 记录页，把指向 Vercel 的 CNAME 的“橘黄色云朵（Proxy）”点灰（设为 DNS Only）。这样让流量直连 Vercel 节点，绕过 Cloudflare 防火墙。

---

## 2. Windows 本地独立 EXE 打包手册

我们已经在项目根目录下编写了 FastAPI 版本的前后端整合入口 `main.py` 以及初始化脚本 `start.bat`。如果希望把整个系统打包成可以分发给小白用户的绿色单文件 `.exe` 服务，可通过 `PyInstaller` 实现。

### 环境准备

1. 安装 [Python 3.9+](https://www.python.org/downloads/)。
2. 安装 Node.js (针对需要重新编译前端的用户)。

### 打包步骤

**第一步：编译前端（如果之前没编译过）**

```bash
# 在项目根目录执行，将 React/Vite 编译出静态网页
npm install
npm run build
```

执行完毕后，项目下会生成一个 `dist` 目录。

**第二步：配置 Python 环境与依赖**

```bash
# 为了保持包体积较小，建议使用虚拟环境
python -m venv venv
venv\Scripts\activate

# 安装相关依赖包
pip install fastapi uvicorn pydantic python-multipart
pip install pyinstaller
```

**第三步：使用 PyInstaller 进行打包**

我们需要将 FastAPI 代码以及前端 `dist` 目录打包在一起。

在根目录执行以下命令：

```bash
pyinstaller -F --name "CloverGallery" --add-data "dist;dist" main.py
```

_参数说明：_

- `-F`: 强制生成单文件。
- `--name`: 命名打包后的程序，如 `CloverGallery`。
- `--add-data "dist;dist"`: 将前端打包好的静态文件 `dist` 目录附加到 EXE 文件中（Windows 下用分号区分 src 和 dest）。

**第四步：运行**

1. 打包完成后，在 `dist` 文件夹（PyInstaller生成的外层dist）内可以找到 `CloverGallery.exe`。
2. 双击运行即可，系统会自动监听 `http://localhost:3000`。
3. 用户在本地浏览器敲击由于前端在 Python 中被通过 `StaticFiles` 托管，即可像运行本地软件一样使用。后台会在 exe 同级目录下自动生成 `data/` 和 `uploads/` 用以本地数据留存。
