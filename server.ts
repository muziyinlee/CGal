import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";

const PORT = 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const GUEST_PASSWORD = process.env.GUEST_PASSWORD || "guest";

// If using GitCode, set these env vars
const USE_GITCODE = !!(process.env.GITCODE_TOKEN && process.env.GITCODE_PROJECT_ID);

const app = express();
app.use(cors());
app.use(express.json());

// Local Database Fallback Config
const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!USE_GITCODE) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ images: [] }, null, 2));
  }
}

async function readDb() {
  if (USE_GITCODE) {
    try {
      const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
      const branch = process.env.GITCODE_BRANCH || "main";
      const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/data%2Fdb.json/raw?ref=${branch}`;
      const res = await fetch(url, { headers: { "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! }});
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("GitCode read err:", e);
    }
    return { images: [] };
  } else {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    return { images: [] };
  }
}

async function writeDb(data: any) {
  if (USE_GITCODE) {
    try {
      const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
      const branch = process.env.GITCODE_BRANCH || "main";
      const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/data%2Fdb.json`;
      const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
      
      const check = await fetch(`${url}?ref=${branch}`, { headers: { "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! }});
      const method = check.ok ? "PUT" : "POST";
      
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! },
        body: JSON.stringify({
          branch,
          content,
          commit_message: "Update db.json",
          encoding: "base64"
        })
      });
    } catch (e) {
      console.error("GitCode write err:", e);
    }
  } else {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  }
}

const storage = USE_GITCODE 
  ? multer.memoryStorage() 
  : multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
      },
      filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + ext);
      },
    });

const upload = multer({ storage: storage });

// --- API Routes ---

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

// Middleware to check any token
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token === "admin_token_xyz" || token === "guest_token_xyz") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

// Middleware to check admin token
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token === "admin_token_xyz") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Forbidden: Admins only" });
  }
};

// 2. Get Images (Protected)
app.get("/api/images", requireAuth, async (req, res) => {
  const db = await readDb();
  // For waterfall/grid, sort by latest
  const sorted = db.images.sort((a: any, b: any) => b.createdAt - a.createdAt);
  res.json({ success: true, images: sorted });
});

// 3. Upload Image (Admin)
app.post("/api/upload", requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const { md5, originalName, folder = "images" } = req.body;
  const db = await readDb();
  
  // MD5 deduplication check
  const existing = db.images.find((img: any) => img.md5 === md5);
  if (existing) {
    if (!USE_GITCODE) fs.unlinkSync(req.file.path);
    return res.json({ success: true, message: "File already exists", image: existing });
  }

  let finalName = originalName;
  const nameExists = db.images.find((img: any) => img.originalName === originalName);
  if (nameExists) {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext);
    finalName = `${base}_${Date.now()}${ext}`;
  }

  let imagePath = "";

  if (USE_GITCODE) {
    const folderStr = (folder === "All" || !folder) ? "images" : folder;
    const filename = `${Date.now()}-${finalName}`;
    const gitPath = `${folderStr}/${filename}`;
    
    const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
    const branch = process.env.GITCODE_BRANCH || "main";
    const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/${encodeURIComponent(gitPath)}`;
    const content = req.file.buffer.toString("base64");
    
    const gitRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! },
      body: JSON.stringify({ branch, content, commit_message: `Upload ${filename}`, encoding: "base64" })
    });
    
    if (!gitRes.ok) {
       console.error(await gitRes.text());
       return res.status(500).json({ success: false, message: "GitCode upload failed" });
    }
    imagePath = `/api/view?url=${encodeURIComponent(gitPath)}`;
  } else {
    imagePath = `/api/files/${req.file.filename}`;
  }

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

  db.images.push(newImage);
  await writeDb(db);

  res.json({ success: true, image: newImage });
});

// 4. Delete Image (Admin)
app.delete("/api/images/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const imageIndex = db.images.findIndex((img: any) => img.id === id);
  
  if (imageIndex > -1) {
    const image = db.images[imageIndex];
    db.images.splice(imageIndex, 1);
    
    if (USE_GITCODE) {
      if (image.path.includes("url=")) {
        const decodedUrl = decodeURIComponent(image.path.split("url=")[1]);
        const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
        const branch = process.env.GITCODE_BRANCH || "main";
        const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/${encodeURIComponent(decodedUrl)}`;
        await fetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! },
          body: JSON.stringify({ branch, commit_message: `Delete ${decodedUrl}` })
        });
      }
    } else {
      try {
        const filePath = path.join(UPLOAD_DIR, path.basename(image.path));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) { }
    }

    await writeDb(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: "Image not found" });
  }
});

// 5. Proxy View (No attachment, for inline viewing images from GitCode)
app.get("/api/view", async (req, res) => {
  const targetPath = req.query.url as string;
  if (!targetPath) return res.status(400).send("No url provided");
  
  if (USE_GITCODE) {
     const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
     const branch = process.env.GITCODE_BRANCH || "main";
     const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/${encodeURIComponent(targetPath)}/raw?ref=${branch}`;
     
     try {
       const fileRes = await fetch(url, { headers: { "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! }});
       if (!fileRes.ok) return res.status(404).send("File not found on GitCode");
       
       res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'image/jpeg');
       res.setHeader('Cache-Control', 'public, max-age=31536000');
       const arrayBuffer = await fileRes.arrayBuffer();
       res.end(Buffer.from(arrayBuffer));
     } catch (err) {
       res.status(500).send("Error fetching from GitCode");
     }
  } else {
    res.status(404).send("Not applicable");
  }
});

// 6. Proxy Download (CORS support & forced downloaded)
app.get("/api/proxy_download", requireAuth, async (req, res) => {
  let targetPath = req.query.url as string;
  if (!targetPath) return res.status(400).send("No url provided");
  
  if (USE_GITCODE || targetPath.startsWith("/api/view")) {
     if (targetPath.startsWith("/api/view")) {
       const urlObj = new URLSearchParams(targetPath.split("?")[1]);
       targetPath = urlObj.get("url") || targetPath;
     }
     
     const pId = encodeURIComponent(process.env.GITCODE_PROJECT_ID!);
     const branch = process.env.GITCODE_BRANCH || "main";
     const url = `https://gitcode.net/api/v4/projects/${pId}/repository/files/${encodeURIComponent(targetPath)}/raw?ref=${branch}`;
     
     try {
       const fileRes = await fetch(url, { headers: { "PRIVATE-TOKEN": process.env.GITCODE_TOKEN! }});
       if (!fileRes.ok) return res.status(404).send("File not found on GitCode");
       
       const filename = path.basename(targetPath);
       res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
       res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
       
       const arrayBuffer = await fileRes.arrayBuffer();
       res.end(Buffer.from(arrayBuffer));
     } catch (err) {
       res.status(500).send("Error fetching from GitCode");
     }
  } else {
    if (targetPath.startsWith("/api/files/")) {
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
  }
});

// Expose files statics
app.use("/api/files", express.static(UPLOAD_DIR));

// --- Vite Middleware & SPA Fallback ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
