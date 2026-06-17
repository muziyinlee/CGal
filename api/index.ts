import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";

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
      if (!data.siteConfig) data.siteConfig = { title: "AIGal" };
      if (!data.passwords) data.passwords = { admin: process.env.ADMIN_PASSWORD || "admin", guest: process.env.GUEST_PASSWORD || "guest" };
      return data;
    }
  } catch(e) {}
  return { images: [], siteConfig: { title: "AIGal" }, passwords: { admin: process.env.ADMIN_PASSWORD || "admin", guest: process.env.GUEST_PASSWORD || "guest" } };
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

// 2. Get Images (Protected)
app.get("/api/images", requireAuth, async (req, res) => {
  const { projectId, isActive } = getGitConfig();
  
  // If GitCode is configured at all (even without a token for read operations)
  if (isActive) {
    try {
      const url = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/images`;
      const { token } = getGitConfig();
      const headers: Record<string, string> = {};
      if (token) headers["PRIVATE-TOKEN"] = token;
      const r = await fetch(url, { headers });
      if (r.ok) {
        const files = await r.json();
        let images = [];
        if (Array.isArray(files)) {
          images = files.map((f: any) => ({
            id: f.sha,
            originalName: f.name,
            md5: f.sha,
            path: `/api/proxy_download?url=${encodeURIComponent(f.download_url)}`,
            size: f.size || 0,
            mimetype: 'image/jpeg',
            folder: 'images',
            createdAt: 0
          }));
        }
        return res.json({ success: true, images });
      } else {
        const errText = await r.text();
        console.error("GitCode fetch images error:", errText);
      }
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
  finalName = `${base}_${Date.now()}${ext}`;

  if (isActive) {
    const gitPath = `images/${finalName}`;
    if (!token) {
        return res.status(500).json({ success: false, message: "GITCODE_TOKEN environment variable is required to upload images. Please configure it in the AI Studio Settings." });
    }

    try {
      const content = req.file.buffer.toString("base64");
      const url = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/${gitPath}`;
      
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
      
      const responseData = await gitRes.json();
      return res.json({ 
        success: true, 
        image: { 
          id: responseData.content?.sha || md5,
          originalName: finalName,
          path: responseData.content?.download_url || "",
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
    const filename = `${Date.now()}-${finalName}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);
    
    const imagePath = `/api/files/${filename}`;
    const newImage = {
      id: Math.random().toString(36).substring(2, 9),
      originalName: finalName,
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
      // We need to fetch the file path first because delete requires the path and sha
      const listUrl = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/images?access_token=${token}`;
      const r = await fetch(listUrl, { headers: { "PRIVATE-TOKEN": token } });
      if (r.ok) {
        const files = await r.json();
        const fileToDel = files.find((f: any) => f.sha === id);
        if (fileToDel) {
          // get default branch
          const repoRes = await fetch(`https://api.gitcode.com/api/v5/repos/${projectId}`, { headers: { "PRIVATE-TOKEN": token } });
          let gitBranch = "master";
          if (repoRes.ok) {
            const repoData = await repoRes.json();
            if (repoData.default_branch) gitBranch = repoData.default_branch;
          }

          const delRes = await fetch(`https://api.gitcode.com/api/v5/repos/${projectId}/contents/${encodeURIComponent(fileToDel.path)}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": token },
            body: JSON.stringify({
              access_token: token,
              message: `Delete ${fileToDel.name}`,
              sha: fileToDel.sha,
              branch: gitBranch
            })
          });
          if (delRes.ok) {
            deletedFromGit = true;
          } else {
            console.error("GitCode delete failed:", await delRes.text());
          }
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
      const filePath = path.join(UPLOAD_DIR, path.basename(image.path));
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
  
  const { token, projectId, isActive } = getGitConfig();
  
  if (filePath && isActive) {
     try {
        const url = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/${filePath}`;
        const headers: Record<string, string> = {};
        if (token) headers["PRIVATE-TOKEN"] = token;
        
        const r = await fetch(url + (token ? `?access_token=${token}` : ''), { headers });
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
             return res.end(buf);
           }
        }
     } catch (e) {
        console.error("Error fetching via GitCode API", e);
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
       const fileRes = await fetch(targetPath, { headers });
       if (!fileRes.ok) return res.status(404).send("File not found on GitCode");
       
       const filename = path.basename(new URL(targetPath).pathname) || "download.png";
       res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
       res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
       
       const arrayBuffer = await fileRes.arrayBuffer();
       res.end(Buffer.from(arrayBuffer));
     } catch (err) {
       res.status(500).send("Error fetching from GitCode");
     }
  } else if (targetPath && targetPath.startsWith("/api/files/")) {
       const filename = path.basename(targetPath);
       const localPath = path.join(UPLOAD_DIR, filename);
       if (fs.existsSync(localPath)) {
         res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
         res.sendFile(localPath);
       } else {
         res.status(404).send("File not found");
       }
  } else {
       res.status(403).send("Forbidden url");
  }
});

// Expose files statics
app.use("/api/files", express.static(UPLOAD_DIR));

export default app;
