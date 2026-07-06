const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3002;

// GitHub 配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'LSjian35';
const GITHUB_REPO = 'warehouse-management';
const GITHUB_BRANCH = 'main';

// 临时文件存储目录（用于接收上传文件后再推送到 GitHub）
const STORAGE_ROOT = process.env.STORAGE_ROOT || './storage';
const uploadsDir = path.join(STORAGE_ROOT, 'uploads');
const dataDir = path.join(STORAGE_ROOT, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 数据文件路径
const DATA_FILE = path.join(dataDir, 'db.json');

// 初始化数据
function initData() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
            projects: [],
            folders: [],
            files: [],
            nextId: { project: 1, folder: 1, file: 1 }
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// 保存数据
function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GitHub API 上传文件
function uploadToGitHub(filename, contentBase64) {
    return new Promise((resolve, reject) => {
        if (!GITHUB_TOKEN) {
            return reject(new Error('GITHUB_TOKEN 未配置'));
        }

        const filePath = `files/${filename}`;
        
        // Step 1: 尝试获取现有文件的 SHA（用于更新已存在文件）
        const getOptions = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}?ref=${GITHUB_BRANCH}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'User-Agent': 'warehouse-app',
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        
        const getReq = https.request(getOptions, (getRes) => {
            let body = '';
            getRes.on('data', chunk => body += chunk);
            getRes.on('end', () => {
                let sha = null;
                if (getRes.statusCode === 200) {
                    try {
                        const data = JSON.parse(body);
                        sha = data.sha;
                    } catch(e) {}
                }
                
                // Step 2: 创建或更新文件
                const payload = {
                    message: sha ? `Update ${filename}` : `Upload ${filename}`,
                    content: contentBase64,
                    branch: GITHUB_BRANCH
                };
                if (sha) payload.sha = sha;
                
                const putData = JSON.stringify(payload);
                
                const putOptions = {
                    hostname: 'api.github.com',
                    path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'User-Agent': 'warehouse-app',
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(putData)
                    }
                };
                
                const putReq = https.request(putOptions, (putRes) => {
                    let putBody = '';
                    putRes.on('data', chunk => putBody += chunk);
                    putRes.on('end', () => {
                        if (putRes.statusCode === 200 || putRes.statusCode === 201) {
                            try {
                                const result = JSON.parse(putBody);
                                // 构建 raw GitHub URL
                                const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
                                resolve(rawUrl);
                            } catch(e) {
                                reject(new Error('解析 GitHub 响应失败'));
                            }
                        } else {
                            reject(new Error(`GitHub API 错误: ${putRes.statusCode} ${putBody}`));
                        }
                    });
                });
                
                putReq.on('error', reject);
                putReq.write(putData);
                putReq.end();
            });
        });
        
        getReq.on('error', (err) => {
            // 如果 GET 失败，直接尝试创建
            const putData = JSON.stringify({
                message: `Upload ${filename}`,
                content: contentBase64,
                branch: GITHUB_BRANCH
            });
            
            const putOptions = {
                hostname: 'api.github.com',
                path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(filePath)}`,
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'User-Agent': 'warehouse-app',
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(putData)
                }
            };
            
            const putReq = https.request(putOptions, (putRes) => {
                let putBody = '';
                putRes.on('data', chunk => putBody += chunk);
                putRes.on('end', () => {
                    if (putRes.statusCode === 200 || putRes.statusCode === 201) {
                        try {
                            const result = JSON.parse(putBody);
                            const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filePath}`;
                            resolve(rawUrl);
                        } catch(e) {
                            reject(new Error('解析 GitHub 响应失败'));
                        }
                    } else {
                        reject(new Error(`GitHub API 错误: ${putRes.statusCode} ${putBody}`));
                    }
                });
            });
            
            putReq.on('error', reject);
            putReq.write(putData);
            putReq.end();
        });
        
        getReq.end();
    });
}

// 配置文件上传（临时存储到本地，然后推送到 GitHub）
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== API 路由 =====

// 获取所有项目
app.get('/api/projects', (req, res) => {
    const data = initData();
    res.json(data.projects);
});

// 创建项目
app.post('/api/projects', (req, res) => {
    const data = initData();
    const { name } = req.body;
    const project = {
        id: data.nextId.project++,
        name,
        created_at: new Date().toISOString()
    };
    data.projects.push(project);
    saveData(data);
    res.json(project);
});

// 删除项目
app.delete('/api/projects/:id', (req, res) => {
    const data = initData();
    const projectId = parseInt(req.params.id);
    
    data.files = data.files.filter(f => !(f.parent_id === projectId && f.parent_type === 'project'));
    data.folders = data.folders.filter(f => f.project_id !== projectId);
    data.projects = data.projects.filter(p => p.id !== projectId);
    
    saveData(data);
    res.json({ message: '项目已删除' });
});

// 获取项目下的文件夹
app.get('/api/projects/:id/folders', (req, res) => {
    const data = initData();
    const projectId = parseInt(req.params.id);
    const folders = data.folders.filter(f => f.project_id === projectId);
    res.json(folders);
});

// 创建文件夹
app.post('/api/folders', (req, res) => {
    const data = initData();
    const { name, project_id } = req.body;
    const folder = {
        id: data.nextId.folder++,
        name,
        project_id: parseInt(project_id),
        created_at: new Date().toISOString()
    };
    data.folders.push(folder);
    saveData(data);
    res.json(folder);
});

// 删除文件夹
app.delete('/api/folders/:id', (req, res) => {
    const data = initData();
    const folderId = parseInt(req.params.id);
    
    data.files = data.files.filter(f => !(f.parent_id === folderId && f.parent_type === 'folder'));
    data.folders = data.folders.filter(f => f.id !== folderId);
    
    saveData(data);
    res.json({ message: '文件夹已删除' });
});

// 获取文件列表
app.get('/api/files', (req, res) => {
    const data = initData();
    const parent_id = parseInt(req.query.parent_id);
    const parent_type = req.query.parent_type;
    const files = data.files.filter(f => f.parent_id === parent_id && f.parent_type === parent_type);
    res.json(files);
});

// 上传文件 -> 推送到 GitHub
app.post('/api/files', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ error: '没有上传文件' });
    }
    
    try {
        let downloadUrl = null;
        
        if (GITHUB_TOKEN) {
            // 有 Token 时推送到 GitHub
            const fileContent = fs.readFileSync(file.path);
            const base64Content = fileContent.toString('base64');
            downloadUrl = await uploadToGitHub(file.originalname, base64Content);
            // 删除临时文件
            try { fs.unlinkSync(file.path); } catch(e) {}
        } else {
            // 没有 Token 时保存到本地 storage 目录
            const localDir = path.join(STORAGE_ROOT, 'files');
            if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
            const localPath = path.join(localDir, file.originalname);
            fs.renameSync(file.path, localPath);
            downloadUrl = `/local-files/${encodeURIComponent(file.originalname)}`;
        }
        
        const data = initData();
        const { parent_id, parent_type } = req.body;
        const fileRecord = {
            id: data.nextId.file++,
            name: file.originalname,
            original_name: file.originalname,
            url: downloadUrl,
            size: file.size,
            type: file.mimetype,
            parent_id: parseInt(parent_id),
            parent_type: parent_type,
            created_at: new Date().toISOString()
        };
        
        data.files.push(fileRecord);
        saveData(data);
        res.json(fileRecord);
    } catch (err) {
        console.error('文件上传错误:', err);
        // 删除临时文件
        try { fs.unlinkSync(file.path); } catch(e) {}
        res.status(500).json({ error: '文件上传失败', details: err.message });
    }
});

// 本地文件下载
app.get('/local-files/:filename', (req, res) => {
    const filePath = path.join(STORAGE_ROOT, 'files', decodeURIComponent(req.params.filename));
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: '文件不存在' });
    }
});

// 获取单个文件信息
app.get('/api/files/:id', (req, res) => {
    const data = initData();
    const fileId = parseInt(req.params.id);
    const file = data.files.find(f => f.id === fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    res.json(file);
});

// 下载文件 -> GitHub 重定向 或 本地文件下载
app.get('/api/files/:id/download', (req, res) => {
    const data = initData();
    const fileId = parseInt(req.params.id);
    const file = data.files.find(f => f.id === fileId);
    
    if (!file) {
        return res.status(404).json({ error: '文件不存在' });
    }
    
    if (file.url && file.url.startsWith('/local-files/')) {
        // 本地文件
        const filePath = path.join(STORAGE_ROOT, 'files', decodeURIComponent(file.name));
        if (fs.existsSync(filePath)) {
            res.download(filePath, file.name);
        } else {
            res.status(404).json({ error: '本地文件不存在' });
        }
    } else if (file.url) {
        // GitHub 文件，重定向
        res.redirect(file.url);
    } else {
        res.status(404).json({ error: '文件链接不可用' });
    }
});

// 删除文件 -> 只删除本地记录（GitHub 文件保留，永久可用）
app.delete('/api/files/:id', (req, res) => {
    const data = initData();
    const fileId = parseInt(req.params.id);
    
    data.files = data.files.filter(f => f.id !== fileId);
    saveData(data);
    res.json({ message: '文件已删除' });
});

// 管理员登录验证（密码不暴露在前端）
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '59880723';
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`GITHUB_TOKEN 状态: ${GITHUB_TOKEN ? '已配置' : '未配置'}`);
});
