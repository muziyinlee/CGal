import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";
import crypto from "crypto";

const PORT = 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const GUEST_PASSWORD = process.env.GUEST_PASSWORD || "guest";

// Create a simple local database (JSON file) since this is a prototype/demo
// If GitCode integration is configured, we'd sync it there.
const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const DB_FILE = path.join(DATA_DIR, "db.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ images: [] }, null, 2));
}

// Ensure the local uploads dir can also serve static files directly in dev mode
// if needed, though we will proxy them via an API.

function readDb() {
  const data = fs.readFileSync(DB_FILE, "utf-8");
  return JSON.parse(data);
}

function writeDb(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // Generate a secure, unique filename to prevent collisions.
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({ storage: storage });

async function startServer() {
  const app = express();
  
  app.use(cors());
  app.use(express.json());

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
  app.get("/api/images", requireAuth, (req, res) => {
    const db = readDb();
    // For waterfall/grid, sort by latest
    const sorted = db.images.sort((a: any, b: any) => b.createdAt - a.createdAt);
    res.json({ success: true, images: sorted });
  });

  // 3. Upload Image (Admin/Proxy to GitCode logic)
  app.post("/api/upload", requireAdmin, upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const { md5, originalName, folder = "images" } = req.body;
    const db = readDb();
    
    // MD5 deduplication check
    const existing = db.images.find((img: any) => img.md5 === md5);
    if (existing) {
      // Remove the uploaded file since we already have it
      fs.unlinkSync(req.file.path);
      return res.json({ success: true, message: "File already exists", image: existing });
    }

    // Name conflict resolution (append timestamp if name exists)
    let finalName = originalName;
    const nameExists = db.images.find((img: any) => img.originalName === originalName);
    if (nameExists) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      finalName = `${base}_${Date.now()}${ext}`;
    }

    // Create record
    // In a real GitCode integration, we would push the file to the GitCode repo here via REST API.
    // We mock the GitCode URL with a local server path for the demo.
    const newImage = {
      id: crypto.randomUUID(),
      originalName: finalName,
      md5: md5,
      path: `/api/files/${req.file.filename}`, // Proxy path
      size: req.file.size,
      mimetype: req.file.mimetype,
      createdAt: Date.now(),
      folder: folder,
    };

    db.images.push(newImage);
    writeDb(db);

    res.json({ success: true, image: newImage });
  });

  // 4. Delete Image (Admin)
  app.delete("/api/images/:id", requireAdmin, (req, res) => {
    const { id } = req.params;
    const db = readDb();
    const imageIndex = db.images.findIndex((img: any) => img.id === id);
    
    if (imageIndex > -1) {
      const image = db.images[imageIndex];
      // Try to remove file
      try {
        const filePath = path.join(UPLOAD_DIR, path.basename(image.path));
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error("Failed to delete file:", err);
      }

      db.images.splice(imageIndex, 1);
      writeDb(db);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "Image not found" });
    }
  });

  // 5. Proxy Download (CORS support & forced downloaded)
  app.get("/api/proxy_download", requireAuth, (req, res) => {
    const targetPath = req.query.url as string;
    if (!targetPath) return res.status(400).send("No url provided");
    
    // For security, only allow local files
    if (targetPath.startsWith("/api/files/")) {
       const filename = path.basename(targetPath);
       const filePath = path.join(UPLOAD_DIR, filename);
       if (fs.existsSync(filePath)) {
         // To avoid 418/WAF issues, set explicit attachment header
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


  // --- Vite Middleware & SPA Fallback ---

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

startServer();
