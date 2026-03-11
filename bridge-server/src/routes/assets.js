/**
 * Asset routes — user file uploads
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });
        cb(null, config.uploadDir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.fbx', '.obj', '.gltf', '.glb', '.png', '.jpg', '.jpeg', '.bmp', '.tga', '.mp3', '.ogg', '.rbxm'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${ext} not supported. Allowed: ${allowed.join(', ')}`));
        }
    }
});

// Upload asset file
router.post('/upload-asset', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
        id: path.parse(req.file.filename).name,
        filename: req.file.originalname,
        path: req.file.path,
        size: req.file.size
    });
});

// List uploaded assets
router.get('/assets', (req, res) => {
    if (!fs.existsSync(config.uploadDir)) return res.json({ assets: [] });

    const files = fs.readdirSync(config.uploadDir).map(f => {
        const stat = fs.statSync(path.join(config.uploadDir, f));
        return {
            filename: f,
            size: stat.size,
            uploadedAt: stat.mtime
        };
    });
    res.json({ assets: files });
});

module.exports = router;
