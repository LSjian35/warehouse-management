const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// 文件存储根目录（通过环境变量配置，Railway 部署时可用 Volume 挂载）
const STORAGE_ROOT = process.env.STORAGE_ROOT || './storage';

// 确保目录存在
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

// 配置文件上传
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
app.use('/uploads', express.static(uploadsDir));

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
    
    const filesToDelete = data.files.filter(f => f.parent_id === projectId && f.parent_type === 'project');
    filesToDelete.forEach(f => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
    
    const foldersToDelete = data.folders.filter(f => f.project_id === projectId);
    foldersToDelete.forEach(folder => {
        const folderFiles = data.files.filter(f => f.parent_id === folder.id && f.parent_type === 'folder');
        folderFiles.forEach(f => {
            if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        data.files = data.files.filter(f => !(f.parent_id === folder.id && f.parent_type === 'folder'));
    });
    
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
    
    const filesToDelete = data.files.filter(f => f.parent_id === folderId && f.parent_type === 'folder');
    filesToDelete.forEach(f => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
    
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

// 上传文件
app.post('/api/files', upload.single('file'), (req, res) => {
    const data = initData();
    const { parent_id, parent_type } = req.body;
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '没有上传文件' });
    }
    
    const fileRecord = {
        id: data.nextId.file++,
        name: file.originalname,
        original_name: file.originalname,
        path: file.path,
        size: file.size,
        type: file.mimetype,
        parent_id: parseInt(parent_id),
        parent_type: parent_type,
        created_at: new Date().toISOString()
    };
    
    data.files.push(fileRecord);
    saveData(data);
    res.json(fileRecord);
});

// 下载文件
app.get('/api/files/:id/download', (req, res) => {
    const data = initData();
    const fileId = parseInt(req.params.id);
    const file = data.files.find(f => f.id === fileId);
    
    if (!file) {
        return res.status(404).json({ error: '文件不存在' });
    }
    
    if (!fs.existsSync(file.path)) {
        return res.status(404).json({ error: '文件已被删除' });
    }
    
    res.download(file.path, file.original_name);
});

// 删除文件
app.delete('/api/files/:id', (req, res) => {
    const data = initData();
    const fileId = parseInt(req.params.id);
    const file = data.files.find(f => f.id === fileId);
    
    if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
    }
    
    data.files = data.files.filter(f => f.id !== fileId);
    saveData(data);
    res.json({ message: '文件已删除' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
