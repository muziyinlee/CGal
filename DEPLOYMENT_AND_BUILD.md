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

> **⚠️ 最新 Vercel 容灾与 500/405 报错说明：**
> 
> **原因分析**：这是由于 Vercel 等 Serverless (无状态) 平台的**只读文件系统**和**随时销毁**特性导致的。以往版本在 Vercel 初始化时由于无法创建本地持久化目录 `data/` 进而崩溃抛出 500 / 405 无法交互的报错。
> 
> **解决方案 (V1.2.0 已修复与妥协)**：
> 1. 我们已更新了项目中 `vercel.json` 的路由规则，避免将 `/api` 的请求拦截。并移除了顶级 `vite` 引入导致模块缺失的服务器级别崩溃。
> 2. 当检测到运行在 Vercel 且未使用 GitCode Token 绑定外部存储时，系统会自动将本地文件操作重定向至 `/tmp` 临时虚拟内存以防止程序级崩溃报错 (500 Error Fix)。
> 3. **致命警告**：Vercel 的 `/tmp` 目录是易失性的，当平台自动休眠您的项目或服务下线后，**您所有在此期间上传的图片与数据库密码全都会被销毁清空。**
> 4. **最佳解决指导**：
>    - **云端免维护模式（强烈推荐）**：请在 Vercel 项目的 `Environment Variables` 中配置 `GITCODE_TOKEN` 与 `GITCODE_PROJECT_ID` 环境变量以使用远程云端服务器存储图片。
>    - **迁移至本地/云服务器服务器运行**：如果您坚决想要把图片安全存在本地服务器磁盘内，请放弃 Vercel，将代码放在个人 VPS 等传统服务器节点上运行。

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

## 2. Node.js 本地独立可执行文件打包手册

由于本系统后端基于 TypeScript / Express，前端由 React/Vite 编译构建，我们可以将其打包成跨平台独立二进制可执行文件 (`.exe`, `.bin` 等)，无需用户安装 Node.js 环境。可配合 `pkg` 等工具实现。

### 环境准备

1. 全局安装 `pkg`：
   ```bash
   npm install -g pkg
   ```
2. 在 `package.json` 内确保：
   - 有正确的 `dist/server.cjs` 编译链输出。
   - 配置 `"bin": "dist/server.cjs"` 入口设定。

### 打包步骤

1. **构建与融合**：先编译前端文件及后端 Typescript。
   ```bash
   npm run build
   ```
2. **执行 PKG 封包指令**：
   ```bash
   pkg . -t node18-win-x64 -o clover-gallery.exe
   ```
3. 您可以根据需要修改 Target `node18-linux-arm64` 供服务器直接运行。

### 本地发版与分发

将生成的 `.exe` 与基础的环境示例 `.env.example` 放到同一个文件夹即可对外发布分享。用户双击即可建立专属且安全、基于他们本身自带物理硬盘的个人私有图床网络！

