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
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch(e) {}
  return { images: [] };
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
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: "admin_token_xyz", role: "admin" });
  } else if (password === GUEST_PASSWORD) {
    res.json({ success: true, token: "guest_token_xyz", role: "guest" });
  } else {
    res.status(401).json({ success: false, message: "Invalid password" });
  }
});

const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token === "admin_token_xyz" || token === "guest_token_xyz") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
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
      const r = await fetch(url);
      if (r.ok) {
        const files = await r.json();
        let images = [];
        if (Array.isArray(files)) {
          images = files.map((f: any) => ({
            id: f.sha,
            originalName: f.name,
            md5: f.sha,
            path: f.download_url,
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
        headers: { "Content-Type": "application/json" },
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

  if (isActive) {
    if (!token) {
        return res.status(500).json({ success: false, message: "GITCODE_TOKEN environment variable is required to delete images." });
    }

    try {
      // We need to fetch the file path first because delete requires the path and sha
      const listUrl = `https://api.gitcode.com/api/v5/repos/${projectId}/contents/images`;
      const r = await fetch(listUrl);
      if (r.ok) {
        const files = await r.json();
        const fileToDel = files.find((f: any) => f.sha === id);
        if (fileToDel) {
          const delRes = await fetch(`https://api.gitcode.com/api/v5/repos/${projectId}/contents/${fileToDel.path}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: token,
              message: `Delete ${fileToDel.name}`,
              sha: fileToDel.sha
            })
          });
          if (delRes.ok) {
            return res.json({ success: true });
          } else {
            console.error("Delete err:", await delRes.text());
            return res.status(500).json({ success: false, message: "Failed to delete from GitCode" });
          }
        } else {
            return res.status(404).json({ success: false, message: "Image not found on GitCode" });
        }
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, message: "Error deleting from GitCode" });
    }
  }

  // Local delete
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
  } else {
    res.status(404).json({ success: false, message: "Image not found" });
  }
});

// Proxy Download
app.get("/api/proxy_download", requireAuth, async (req, res) => {
  let targetPath = req.query.url as string;
  if (!targetPath) return res.status(400).send("No url provided");
  
  if (targetPath.startsWith("https://")) {
    try {
       const fileRes = await fetch(targetPath);
       if (!fileRes.ok) return res.status(404).send("File not found on GitCode");
       
       const filename = path.basename(new URL(targetPath).pathname) || "download.png";
       res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
       res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
       
       const arrayBuffer = await fileRes.arrayBuffer();
       res.end(Buffer.from(arrayBuffer));
     } catch (err) {
       res.status(500).send("Error fetching from GitCode");
     }
  } else if (targetPath.startsWith("/api/files/")) {
       const filename = path.basename(targetPath);
       const filePath = path.join(UPLOAD_DIR, filename);
       if (fs.existsSync(filePath)) {
         res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
         res.download(filePath);
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
