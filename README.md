# 仓库管理系统（Railway 部署版）

## 项目简介

一个基于 Express + Node.js 的仓库管理系统，支持项目/文件夹/文件的分层管理，可上传、下载、删除文件。前端为纯 HTML/CSS/JS，后端提供 REST API。

管理员密码：`59880723`（可在 `public/index.html` 中修改）

---

## 部署到 Railway 步骤

### 1. 在 Railway 创建项目
1. 打开 [https://railway.app](https://railway.app) 并登录
2. 点击 **New Project** → **Deploy from GitHub repo**
3. 将本代码推送到 GitHub，然后选择该仓库

### 2. 部署配置
Railway 会自动识别 `package.json` 并构建 Node.js 项目。

环境变量（可选）：
- `STORAGE_ROOT`：数据存储路径，默认 `./storage`（Railway 会自动在工作目录下创建）
- `PORT`：服务端口，Railway 会自动分配，无需手动设置

### 3. 数据持久化（重要！）
Railway 默认是无状态容器，重启后文件会丢失。你需要添加持久化卷（Volume）：

1. 进入 Railway 项目 → 选择服务 → 点击 **Volumes** 标签
2. 点击 **New Volume**
3. 挂载路径填写：`/app/storage`
4. 大小根据需求选择（默认 5GB 足够）

这样 `db.json` 和上传的文件就会持久化保存。

> 如果不添加 Volume，每次重新部署后数据会丢失。如果不想付费，可以只部署纯静态版本，使用外部对象存储（如 Cloudflare R2）。

### 4. 绑定自定义域名（lsjian.dpdns.org）
1. 进入 Railway 项目 → **Settings** → **Domains**
2. 点击 **Generate Domain**（获得 Railway 提供的临时域名）
3. 点击 **Custom Domain** → 添加你的域名：`lsjian.dpdns.org`
4. Railway 会提供 CNAME 记录，类似 `xxx.up.railway.app`
5. 打开你的 Cloudflare 域名管理 → **DNS** → 添加一条 CNAME 记录：
   - 名称：`lsjian`（子域名）
   - 目标：Railway 提供的 CNAME 地址
   - 代理状态：关闭（灰色云朵），否则 Railway 无法验证域名
6. 回到 Railway 等待域名验证完成，开启 HTTPS

### 5. 部署完成
- 访问你的域名即可使用
- 点击右上角「管理员模式」输入密码即可管理文件

---

## 本地运行（开发测试）

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3002`

---

## 技术栈

- 后端：Express + multer（文件上传）+ cors
- 前端：原生 HTML/CSS/JS
- 数据存储：JSON 文件（db.json）+ 本地磁盘文件

---

## 注意事项

1. 本项目使用文件系统存储数据，适合个人/小范围使用
2. 如需大规模使用，建议改用 PostgreSQL + S3 存储
3. 管理员密码请在 `public/index.html` 中修改第 245 行的 `'59880723'`
