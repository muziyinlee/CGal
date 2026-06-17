import os
import json
import uuid
import time
import shutil
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

app = FastAPI()

# Configuration
DATA_DIR = "data"
UPLOAD_DIR = "uploads"
DB_FILE = os.path.join(DATA_DIR, "db.json")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

if not os.path.exists(DB_FILE):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump({"images": []}, f)

def read_db():
    with open(DB_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def write_db(data):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

class LoginRequest(BaseModel):
    password: str

@app.post("/api/login")
def login(req: LoginRequest):
    if req.password == ADMIN_PASSWORD:
        return {"success": True, "token": "admin_token_xyz"}
    return JSONResponse(status_code=401, content={"success": False, "message": "Invalid password"})

def require_admin(authorization: str = Header(None)):
    if authorization != "Bearer admin_token_xyz":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@app.get("/api/images")
def get_images():
    db = read_db()
    sorted_images = sorted(db["images"], key=lambda x: x["createdAt"], reverse=True)
    return {"success": True, "images": sorted_images}

@app.post("/api/upload")
def upload_image(file: UploadFile = File(...), md5: str = Form(...), originalName: str = Form(...), folder: str = Form("images"), admin: bool = Depends(require_admin)):
    db = read_db()
    # MD5 Deduplication
    for img in db["images"]:
        if img["md5"] == md5:
            return {"success": True, "message": "File already exists", "image": img}
            
    # Resolve name conflict with timestamp
    final_name = originalName
    if any(img["originalName"] == originalName for img in db["images"]):
        base, ext = os.path.splitext(originalName)
        final_name = f"{base}_{int(time.time() * 1000)}{ext}"
        
    # Save physical file
    filename = f"{int(time.time() * 1000)}-{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    new_image = {
        "id": str(uuid.uuid4()),
        "originalName": final_name,
        "md5": md5,
        "path": f"/api/files/{filename}",
        "size": os.path.getsize(file_path),
        "mimetype": file.content_type,
        "createdAt": int(time.time() * 1000),
        "folder": folder,
    }
    
    db["images"].append(new_image)
    write_db(db)
    return {"success": True, "image": new_image}

@app.delete("/api/images/{image_id}")
def delete_image(image_id: str, admin: bool = Depends(require_admin)):
    db = read_db()
    img_idx = next((i for i, img in enumerate(db["images"]) if img["id"] == image_id), None)
    if img_idx is not None:
        img = db["images"].pop(img_idx)
        file_path = os.path.join(UPLOAD_DIR, os.path.basename(img["path"]))
        if os.path.exists(file_path):
            os.remove(file_path)
        write_db(db)
        return {"success": True}
    return JSONResponse(status_code=404, content={"success": False, "message": "Image not found"})

@app.get("/api/proxy_download")
def proxy_download(url: str):
    if not url.startswith("/api/files/"):
        raise HTTPException(status_code=403, detail="Forbidden url")
    
    filename = os.path.basename(url)
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(file_path, filename=filename, media_type="application/octet-stream")

app.mount("/api/files", StaticFiles(directory=UPLOAD_DIR), name="files")

# Fallback to serving the built frontend dist folder
if os.path.exists("dist"):
    app.mount("/", StaticFiles(directory="dist", html=True), name="dist")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
