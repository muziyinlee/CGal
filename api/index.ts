import express from "express";
import pLimit from 'p-limit';
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const GUEST_PASSWORD = process.env.GUEST_PASSWORD || "guest";

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = process.env.VERCEL ? "/tmp/data" : path.join(process.cwd(), "data");
const UPLOAD_DIR = process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureLocalDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ images: [] }, null, 2));
    }
  } catch (e) {}
}
ensureLocalDb();

async function readLocalDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      if (!data.siteConfig) data.siteConfig = { title: "CGal" };
      if (!data.passwords) data.passwords = { admin: process.env.ADMIN_PASSWORD || "admin", guest: process.env.GUEST_PASSWORD || "guest" };
      return data;
    }
  } catch(e) {}
  return { images: [], siteConfig: { title: "CGal" }, passwords: { admin: process.env.ADMIN_PASSWORD || "admin", guest: process.env.GUEST_PASSWORD || "guest" } };
}

async function writeLocalDb(data: any) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Local file write err:", e);
  }
}

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Prevent API caching (especially important for Vercel edge/CDN)
app.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/files") && !req.path.startsWith("/proxy_download")) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
  next();
});

// 1. Verify Login
app.post("/api/login", async (req, res) => {
  const { password } = req.body;
  const db = await readLocalDb();
  if (password === db.passwords.admin) {
    res.json({ success: true, token: "admin_token_xyz", role: "admin" });
  } else if (password === db.passwords.guest) {
    res.json({ success: true, token: "guest_token_xyz", role: "guest" });
  } else {
    res.status(401).json({ success: false, message: "Invalid password" });
  }
});

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.query.t) {
    token = req.query.t as string;
  }
  if (token === "admin_token_xyz" || token === "guest_token_xyz") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.query.t) {
    token = req.query.t as string;
  }
  if (token === "admin_token_xyz") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Forbidden: Admins only" });
  }
};

function getGitConfig() {
  const token = process.env.GITCODE_TOKEN?.trim() || "";
  const projectId = process.env.GITCODE_PROJECT_ID?.trim() || "";
  return { token, projectId, isActive: !!projectId };
}

async function fetchDirContents(projectId: string, token: string, path: string, currentDepth: number, maxDepth: number): Promise<any[]> {
  if (currentDepth > maxDepth) return [];
  const headers: Record<string, string> = {};
  if (token) headers["PRIVATE-TOKEN"] = token;
  const encodedPath = path ? path.split('/').map(encodeURIComponent).join('/') : '';
  const dirUrl = `https://api.gitcode.com/api/v5/repos/${projectId}/contents${encodedPath ? `/${encodedPath}` : ''}${token ? `?access_token=${token}` : ''}`;
  const res = await fetch(dirUrl, { headers });
  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];
  
  const files = items.filter(item => item.type === 'file' || item.type === 'blob');
  const dirs = items.filter(item => item.type === 'dir');
  
  const subDirsPromises = dirs.map(dir => fetchDirContents(projectId, token, dir.path, currentDepth + 1, maxDepth));
  const subDirsResults = await Promise.all(subDirsPromises);
  
  return files.concat(...subDirsResults);
}

// 2. Get Images (Protected)
app.get("/api/images", requireAuth, async (req, res) => {
  const { projectId, isActive } = getGitConfig();
  
  // If GitCode is configured at all (even without a token for read operations)
  if (isActive) {
    try {
      const { token } = getGitConfig();
      let allFiles = await fetchDirContents(projectId, token, '', 0, 5);

      let images = allFiles.filter((f: any) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f.path || f.name)).map((f: any) => {
          let createdAt = 0;
          const fileName = f.name || f.path.split('/').pop() || "";
          const timeMatch = fileName.match(/_(\d{13})(?:\.[a-zA-Z0-9]+)?$/);
          if (timeMatch && timeMatch[1]) {
             createdAt = parseInt(timeMatch[1], 10);
          }
          
          let folder = 'root';
          const itemPath = f.path || f.name || "";
          const parts = itemPath.split('/');
          if (parts.length > 1) {
              parts.pop();
              folder = parts.join('/');
          }

          return {
            id: f.sha || f.id || fileName,
            originalName: fileName,
            md5: f.sha || f.id || fileName,
            path: f.download_url ? `/api/proxy_download?url=${encodeURIComponent(f.download_url)}` : `/api/proxy_download?path=${encodeURIComponent(itemPath)}`,
            size: parseInt(f.size || 0, 10),
            mimetype: 'image/jpeg',
            folder: folder,
            createdAt: createdAt
          };
        });
        return res.json({ success: true, images });
    } catch (e) {
      console.error("GitCode APIs error", e);
    }
  }

  // Fallback to local
  const db = await readLocalDb();
  const sorted = db.images.sort((a: any, b: any) => b.createdAt - a.createdAt);
  res.json({ success: true, images: sorted });
});

app.get("/api/config", async (req, res) => {
  const db = await readLocalDb();
  res.json({ success: true, siteConfig: db.siteConfig });
});

app.post("/api/config", requireAdmin, async (req, res) => {
  const { title } = req.body;
  const db = await readLocalDb();
  if (title) db.siteConfig.title = title;
  await writeLocalDb(db);
  res.json({ success: true, siteConfig: db.siteConfig });
});

app.post("/api/password", requireAdmin, async (req, res) => {
  const { role, newPassword } = req.body;
  const db = await readLocalDb();
  if (role === "admin") db.passwords.admin = newPassword;
  else if (role === "guest") db.passwords.guest = newPassword;
  await writeLocalDb(db);
  res.json({ success: true });
});

// 3. Upload Image (Admin)
app.post("/api/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const { md5, originalName, folder = "images" } = req.body;
  const { token, projectId, isActive } = getGitConfig();

  let finalName = originalName;
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);

  if (isActive) {
    if (!token) {
        return res.status(500).json({ success: false, message: "GITCODE_TOKEN environment variable is required to upload images. Please configure it in the AI Studio Settings." });
    }

    let gitPath = `${folder}/${finalName}`;

    try {
      // Check if file exists first
      const encodedGitPath = gitPath.split('/').map(encodeURIComponent).join('/');
      const checkUrl = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/${encodedGitPath}`;
      const checkRes = await fetch(checkUrl, { headers: { "PRIVATE-TOKEN": token } });
      if (checkRes.ok) { // File exists
         finalName = `${base}_${Date.now()}${ext}`;
         gitPath = `${folder}/${finalName}`;
      }

      const content = req.file.buffer.toString("base64");
      const encodedGitPathFinal = gitPath.split('/').map(encodeURIComponent).join('/');
      const url = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/${encodedGitPathFinal}`;
      
      const gitRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": token },
        body: JSON.stringify({
          access_token: token,
          content: content,
          message: `Upload ${finalName}`
        })
      });
      
      if (!gitRes.ok) {
         console.error("GitCode upload HTTP errors:", await gitRes.text());
         return res.status(500).json({ success: false, message: "GitCode upload failed. Please check your GITCODE_TOKEN permissions." });
      }
      
      let responseData: any = {};
      try {
         responseData = await gitRes.json();
      } catch (err) {
         console.warn("Could not parse GitCode response as JSON, but upload succeeded.");
      }

      return res.json({ 
        success: true, 
        image: { 
          id: responseData?.content?.sha || md5,
          originalName: finalName,
          path: responseData?.content?.download_url ? `/api/proxy_download?url=${encodeURIComponent(responseData.content.download_url)}` : `/api/proxy_download?path=${encodeURIComponent(gitPath)}`,
          folder: folder,
          createdAt: Date.now()
        } 
      });
    } catch (e) {
      console.error("Gitcode upload err:", e);
      return res.status(500).json({ success: false, message: "Upload failed" });
    }
  } else {
    // Local storage
    let filename = finalName;
    let targetFolder = path.join(UPLOAD_DIR, folder);
    
    // Ensure target folder exists
    if (!fs.existsSync(targetFolder)) {
       fs.mkdirSync(targetFolder, { recursive: true });
    }

    let filePath = path.join(targetFolder, filename);
    if (fs.existsSync(filePath)) {
       filename = `${base}_${Date.now()}${ext}`;
       filePath = path.join(targetFolder, filename);
    }
    
    fs.writeFileSync(filePath, req.file.buffer);
    
    // Update image path to include folder
    const imagePath = `/api/files/${folder}/${filename}`;
    const newImage = {
      id: Math.random().toString(36).substring(2, 9),
      originalName: filename,
      md5: md5,
      path: imagePath,
      size: req.file.size,
      mimetype: req.file.mimetype,
      folder: folder,
      createdAt: Date.now(),
    };

    const db = await readLocalDb();
    db.images.push(newImage);
    await writeLocalDb(db);

    res.json({ success: true, image: newImage });
  }
});

// 4. Delete Image (Admin)
app.delete("/api/images/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { token, projectId, isActive } = getGitConfig();
  let deletedFromGit = false;

  if (isActive && token) {
    try {
      // get default branch
      const repoRes = await fetch(`https://api.gitcode.com/api/v5/repos/${projectId}`, { headers: { "PRIVATE-TOKEN": token } });
      let gitBranch = "master";
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        if (repoData.default_branch) gitBranch = repoData.default_branch;
      }

      const allFiles = await fetchDirContents(projectId, token, '', 0, 5);
      const fileToDel = allFiles.find((f: any) => f.id === id || f.sha === id || f.name === id);

      if (fileToDel) {
          const itemPath = fileToDel.path || fileToDel.name;
          const encodedItemPath = itemPath.split('/').map(encodeURIComponent).join('/');
          const delRes = await fetch(`https://api.gitcode.com/api/v5/repos/${projectId}/contents/${encodedItemPath}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": token },
            body: JSON.stringify({
              access_token: token,
              message: `Delete ${itemPath}`,
              sha: fileToDel.id || fileToDel.sha,
              branch: gitBranch
            })
          });
          if (delRes.ok) {
            deletedFromGit = true;
          } else {
            console.error("GitCode delete failed:", await delRes.text());
          }
        }
    } catch (e) {
      console.error(e);
    }
  }

  // Local delete fallback
  const db = await readLocalDb();
  const imageIndex = db.images.findIndex((img: any) => img.id === id);
  if (imageIndex > -1) {
    const image = db.images[imageIndex];
    db.images.splice(imageIndex, 1);
    try {
      // Decode URL component to handle spaces and special chars, then remove the /api/files/ prefix
      const relativePath = decodeURIComponent(image.path).replace('/api/files/', '');
      const filePath = path.join(UPLOAD_DIR, relativePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) { }
    await writeLocalDb(db);
    return res.json({ success: true });
  }

  if (deletedFromGit) {
    return res.json({ success: true });
  } else if (isActive) {
    return res.status(500).json({ success: false, message: "Failed to delete from GitCode" });
  } else {
    // If GitCode is not active and local logic didn't return, then just assume success
    return res.json({ success: true });
  }
});


const gitcodeLimit = pLimit(3); // Max 3 concurrent requests to GitCode

// Simple memory cache
const imageCache = new Map<string, { mime: string, buf: Buffer, time: number }>();

// Proxy Download
app.get("/api/proxy_download", requireAuth, async (req, res) => {
  let targetPath = req.query.url as string;
  let filePath = req.query.path as string;
  
  if (!targetPath && !filePath) {
     // try to extract path from targetPath if it matches raw.gitcode.com
     if (targetPath && targetPath.includes("raw.gitcode.com") && targetPath.includes("/blobs/")) {
       const parts = targetPath.split("/blobs/")[1].split("/");
       parts.shift(); // remove sha
       filePath = parts.join("/");
     }
  }

  // extract filepath from raw url if missing
  if (!filePath && targetPath && targetPath.includes("raw.gitcode.com")) {
      const match = targetPath.match(/\/blobs\/[a-f0-9]+\/(.*)/);
      if (match && match[1]) filePath = match[1];
  }

  if (!targetPath && !filePath) return res.status(400).send("No url or path provided");
  
  if (filePath && targetPath) filePath = decodeURIComponent(filePath);

  const cacheKey = (filePath || targetPath) + (req.query.thumb ? '_thumb' : '');
  if (imageCache.has(cacheKey)) {
     const cached = imageCache.get(cacheKey)!;
     res.setHeader('Content-Type', cached.mime);
     res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
     return res.end(cached.buf);
  }
  
  let { token, projectId, isActive } = getGitConfig();
  if (targetPath && targetPath.includes('raw.gitcode.com')) {
      const pMatch = targetPath.match(/raw\.gitcode\.com\/([^\/]+\/[^\/]+)\/blobs\//);
      if (pMatch && pMatch[1]) {
          projectId = pMatch[1];
          isActive = true;
      }
  }
  
  if (filePath && isActive) {
     try {
        const encodedFilePath = filePath.split('/').map(encodeURIComponent).join('/');
        const url = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/${encodedFilePath}`;
        const headers: Record<string, string> = {};
        if (token) headers["PRIVATE-TOKEN"] = token;
        
        
        const fetchGitCode = async (retryCount = 0): Promise<any> => {
           const r = await gitcodeLimit(() => fetch(url + (token ? `?access_token=${token}` : ''), { headers }));
           if (r.status === 429 || r.status >= 500) {
              if (retryCount < 2) {
                 await new Promise(res => setTimeout(res, 1000 + Math.random() * 2000));
                 return fetchGitCode(retryCount + 1);
              }
           }
           return r;
        };
        const r = await fetchGitCode();
        if (r.ok) {
           const data = await r.json();
           if (data.content) {
             const buf = Buffer.from(data.content, data.encoding || 'base64');
             const ext = path.extname(filePath).toLowerCase();
             let mime = 'image/jpeg';
             if (ext === '.png') mime = 'image/png';
             else if (ext === '.gif') mime = 'image/gif';
             else if (ext === '.webp') mime = 'image/webp';
             else if (ext === '.svg') mime = 'image/svg+xml';
             
             res.setHeader('Content-Type', mime);
             res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
             res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
             let finalBuf = buf;
              if (req.query.thumb && mime !== 'image/svg+xml') {
                try {
                  finalBuf = await sharp(buf).resize(400).jpeg({ quality: 40 }).toBuffer();
                  mime = 'image/jpeg';
                } catch (e) {
                  console.error('Thumb error:', e);
                }
              }
              res.setHeader('Content-Type', mime);
              return res.end(finalBuf);
           } else {
             console.error("GitCode file has no content field:", data);
             // fallback
           }
        } else {
           console.error("GitCode fetch failed:", r.status, await r.text());
           // fallback
        }
     } catch (e) {
        console.error("Error fetching via GitCode API", e);
        // fallback
     }
  }

  if (targetPath && targetPath.startsWith("https://")) {
    try {
       const headers: Record<string, string> = {};
       if (token && targetPath.includes("gitcode.com")) {
         headers["PRIVATE-TOKEN"] = token;
         if (!targetPath.includes("private_token=")) {
             targetPath += (targetPath.includes("?") ? "&" : "?") + `private_token=${token}`;
         }
       }
       const fetchGitCodeRaw = async (retryCount = 0): Promise<any> => {
          const res = await gitcodeLimit(() => fetch(targetPath, { headers }));
          if (res.status === 429 || res.status >= 500) {
             if (retryCount < 2) {
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                return fetchGitCodeRaw(retryCount + 1);
             }
          }
          return res;
       };
       const fileRes = await fetchGitCodeRaw();
       if (!fileRes.ok) return res.status(404).send("File not found on GitCode");
       
       const filename = path.basename(new URL(targetPath).pathname) || "download.png";
       res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
       res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
       res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
       
       const arrayBuffer = await fileRes.arrayBuffer();
       let finalBuf = Buffer.from(arrayBuffer);
        let mime = fileRes.headers.get('content-type') || 'application/octet-stream';
        
        if (req.query.thumb && !mime.includes('svg')) {
          try {
            finalBuf = await sharp(finalBuf).resize(400).jpeg({ quality: 40 }).toBuffer();
            mime = 'image/jpeg';
            res.setHeader('Content-Type', mime);
          } catch (e) {
            console.error('Thumb error:', e);
          }
        }
        imageCache.set(cacheKey, { mime, buf: finalBuf, time: Date.now() });
        if (imageCache.size > 200) {
            const oldestKey = Array.from(imageCache.entries()).sort((a,b) => a[1].time - b[1].time)[0][0];
            imageCache.delete(oldestKey);
        }
        res.end(finalBuf);
     } catch (err) {
       res.status(500).send("Error fetching from GitCode");
     }
  } else if (targetPath && targetPath.startsWith("/api/files/")) {
       const relativePath = decodeURIComponent(targetPath).replace('/api/files/', '');
       const localPath = path.join(UPLOAD_DIR, relativePath);
       const filename = path.basename(relativePath);
       if (fs.existsSync(localPath)) {
         res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
         res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
         if (req.query.thumb && !localPath.toLowerCase().endsWith('.svg')) {
             try {
               const buf = fs.readFileSync(localPath);
               const finalBuf = await sharp(buf).resize(400).jpeg({ quality: 40 }).toBuffer();
               res.setHeader('Content-Type', 'image/jpeg');
               return res.end(finalBuf);
             } catch (e) {
               console.error('Thumb error:', e);
             }
          }
          res.sendFile(localPath);
       } else {
         res.status(404).send("File not found");
       }
  } else {
       res.status(403).send("Forbidden url");
  }
});

// Expose files statics
app.use("/api/files", express.static(UPLOAD_DIR, {
  maxAge: '1y',
  immutable: true
}));

export default app;
