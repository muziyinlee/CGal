import app from "./api/index.js";
import path from "path";

const PORT = 3000;

// --- Vite Middleware & SPA Fallback ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to load Vite. Running without frontend middleware in dev mode.");
    }
  } else {
    // Only used for LOCAL production or self-hosted deployment.
    // Vercel completely skips this because Vercel handles frontend statically via vercel.json.
    const distPath = path.join(process.cwd(), "dist");
    const express = (await import("express")).default;
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT as number, "0.0.0.0", () => {
    console.log(`Server started on http://localhost:${PORT}`);
  });
}

// On Vercel, this file isn't executed as the entry point for API.
// "process.env.VERCEL" will be set, so we skip starting the internal server.
if (!process.env.VERCEL) {
  startServer();
}

export default app;
