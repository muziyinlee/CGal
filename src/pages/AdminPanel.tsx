import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useUploader } from "../hooks/useUploader";
import type { ImageData } from "../types";
import { LogOut, UploadCloud, Trash2, DownloadCloud, AlertCircle, RefreshCw, Check } from "lucide-react";
import JSZip from "jszip";
import Footer from "../components/Footer";

export default function AdminPanel() {
  const { token, role, logout } = useAuth();
  const navigate = useNavigate();
  const { tasks, addFiles, uploadFile, clearDone } = useUploader(token || "");

  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadFolder, setUploadFolder] = useState("images");
  const [activeFolder, setActiveFolder] = useState("All");

  const folders = ["All", ...Array.from(new Set(images.map((i) => i.folder || "images")))];

  // Password confirmation modal for deletion
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token || role !== "admin") {
      navigate("/login");
      return;
    }
    fetchImages();
  }, [token, role, navigate]);

  const fetchImages = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/images");
      const data = await res.json();
      if (data.success) {
        setImages(data.images);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      addFiles(files, uploadFolder);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      addFiles(files, uploadFolder);
    }
  };

  const handleProcessQueue = async () => {
    const pendingTasks = tasks.filter(t => t.status === "pending");
    for (const task of pendingTasks) {
      try {
        await uploadFile(task);
      } catch (e) {
        // Continue with others
      }
    }
    fetchImages();
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    const displayedImages = images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder);
    if (selectedIds.size === displayedImages.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayedImages.map((i) => i.id)));
  };

  // --- Deletion Logic ---
  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError("");

    // Secondary password verification
    try {
      const loginRes = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const loginData = await loginRes.json();

      if (!loginData.success) {
        setDeleteError("Invalid admin password. Deletion aborted.");
        setDeleting(false);
        return;
      }

      // Proceed to delete
      const idsToDelete = Array.from(selectedIds);
      for (const id of idsToDelete) {
        await fetch(`/api/images/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      setShowDeleteModal(false);
      setDeletePassword("");
      setSelectedIds(new Set());
      fetchImages();
    } catch (err) {
      setDeleteError("Server error during deletion.");
    } finally {
      setDeleting(false);
    }
  };

  // --- Batch Download Logic ---
  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    
    // We must use JSZip to compose the blob and force file download,
    // avoiding URL length limits that happen when doing generic encodeURIComponent lists.
    const zip = new JSZip();
    const imgsToDownload = images.filter((img) => selectedIds.has(img.id));
    
    for (const img of imgsToDownload) {
      try {
        // Proxy fetch the file
        const res = await fetch(`/api/proxy_download?url=${encodeURIComponent(img.path)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Fetch failed");
        const blob = await res.blob();
        zip.file(img.originalName, blob);
      } catch (err) {
        console.error(`Failed to fetch ${img.originalName} for zip`);
      }
    }

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = `CloverBatch_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Failed to generate zip", err);
    }
  };

  return (
    <div className="min-h-screen pb-20 flex flex-col">
      <header className="bg-white border-b border-[var(--color-border-main)] h-[72px] flex items-center px-8 z-30">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-500)] flex items-center justify-center text-white font-bold text-sm">
              <span className="text-[16px] font-sans">A</span>
            </div>
            <h1 className="font-bold text-[20px] tracking-tight text-[var(--color-brand-500)]">Admin Console</h1>
            <span className="bg-[var(--color-accent-blue-light)] text-[var(--color-accent-blue)] px-3 py-1 rounded-full text-[12px] font-bold ml-2">ADMIN</span>
          </div>
          <div className="flex gap-4 items-center">
            <button onClick={() => navigate("/")} className="text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]">
              View Gallery
            </button>
            <button onClick={handleLogout} className="text-sm font-semibold text-[var(--color-danger)] hover:opacity-80 flex items-center gap-1">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8 w-full flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Col: Upload Zone */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="card !p-0">
            <div className="border-b border-[var(--color-border-main)] p-4 flex items-center gap-2">
              <UploadCloud size={18} className="text-[var(--color-text-main)]" />
              <h2 className="font-semibold text-[var(--color-text-main)] text-[14px]">Upload Center</h2>
            </div>
            
            <div className="p-4 border-b border-[var(--color-border-main)]">
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-2 uppercase tracking-[1px]">Target Folder</label>
              <input 
                type="text" 
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-main)] rounded-[8px] px-3 py-2 text-[14px] outline-none focus:border-[var(--color-brand-500)] transition-colors"
                placeholder="e.g. images/aigal"
              />
            </div>
            
            <div 
              className="p-8 flex flex-col items-center justify-center border border-dashed border-[var(--color-border-main)] m-4 rounded-[12px] bg-[#fcfdfd] hover:bg-[var(--color-brand-100)] transition-colors cursor-pointer"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => document.getElementById("file-upload")?.click()}
            >
              <UploadCloud size={32} className="text-[var(--color-primary)] mb-3" />
              <p className="text-[14px] font-semibold text-[var(--color-text-main)] text-center">Click or drag here</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">MD5 deduplication on</p>
              <input 
                type="file" 
                id="file-upload" 
                className="hidden" 
                multiple 
                accept="image/*"
                onChange={handleFileSelect}
              />
            </div>

            {tasks.length > 0 && (
              <div className="p-4 border-t border-[var(--color-border-main)] bg-[var(--color-bg-base)] max-h-64 overflow-y-auto">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-[1px]">Queue ({tasks.length})</span>
                  <div className="flex gap-2">
                    <button onClick={clearDone} className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] font-bold">Clear Done</button>
                    <button onClick={handleProcessQueue} className="text-[11px] font-bold text-[var(--color-brand-500)] hover:text-[var(--color-brand-600)]">Start Upload</button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {tasks.map(task => (
                    <div key={task.id} className="bg-white p-2.5 rounded-[12px] border border-[var(--color-border-main)] flex items-center justify-between">
                      <div className="truncate text-[12px] font-semibold text-[var(--color-text-main)] max-w-[120px]">{task.file.name}</div>
                      <div className="text-[12px] font-semibold">
                        {task.status === "pending" && <span className="text-[var(--color-text-muted)]">Wait</span>}
                        {task.status === "hashing" && <span className="text-[var(--color-accent-blue)] animate-pulse">Hash</span>}
                        {task.status === "uploading" && <span className="text-[var(--color-accent-blue)] animate-pulse">Up</span>}
                        {task.status === "success" && <span className="text-[var(--color-brand-500)]">Done</span>}
                        {task.status === "error" && <span className="text-[var(--color-danger)]" title={task.error}>Fail</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Manage Zone */}
        <div className="lg:col-span-3">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="font-bold text-[24px] text-[var(--color-text-main)] m-0">Library</h2>
                <p className="text-[14px] text-[var(--color-text-muted)] mt-1">{images.length} items preserved</p>
              </div>
              <div className="flex gap-2 flex-wrap flex-1 min-w-[200px]">
                <select 
                  value={activeFolder} 
                  onChange={(e) => setActiveFolder(e.target.value)}
                  className="bg-white border border-[var(--color-border-main)] rounded-[8px] px-3 py-2 text-[14px] font-semibold text-[var(--color-text-main)] outline-none focus:border-[var(--color-brand-500)]"
                >
                  {folders.map(f => (
                    <option key={f} value={f}>{f === "All" ? "All Folders" : f}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={fetchImages} className="btn-secondary !px-4 hover:bg-[var(--color-bg-base)] text-[14px] font-semibold">
                  <RefreshCw size={14} /> Refresh
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button onClick={handleBatchDownload} className="btn-secondary !px-4 hover:bg-[var(--color-bg-base)] text-[14px] font-semibold gap-2 border-[var(--color-accent-blue)] text-[var(--color-text-main)]">
                      <DownloadCloud size={14} />
                      Package Zip
                    </button>
                    <button onClick={() => setShowDeleteModal(true)} className="btn-danger !px-4 gap-2 text-[14px] font-semibold">
                      <Trash2 size={14} />
                      Remove ({selectedIds.size})
                    </button>
                  </>
                )}
              </div>
            </div>

            {loading ? (
              <div className="flex-1 flex justify-center items-center py-20">
                <div className="animate-spin w-8 h-8 border-4 border-[var(--color-brand-500)] border-t-transparent rounded-full"></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5 pb-4">
                <div
                  className="col-span-full mb-1 flex items-center gap-2 cursor-pointer text-[14px] text-[var(--color-text-main)] font-semibold"
                  onClick={toggleSelectAll}
                >
                  <input type="checkbox" checked={selectedIds.size === images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder).length && images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder).length > 0} readOnly className="w-4 h-4 rounded text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] accent-[var(--color-brand-500)]" />
                  Select All
                </div>
                {images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder).map(img => (
                  <div 
                    key={img.id} 
                    className={`card group !p-0 cursor-pointer transition-all ${selectedIds.has(img.id) ? 'border-[var(--color-brand-500)] ring-2 ring-[var(--color-brand-500)]/20' : 'hover:border-[var(--color-brand-500)]'}`}
                    onClick={() => toggleSelect(img.id)}
                  >
                    <div className="relative h-[120px] bg-[#f0f4f3] flex items-center justify-center overflow-hidden shrink-0">
                      <img src={img.path} alt={img.originalName} loading="lazy" className="w-full h-full object-cover" />
                      {selectedIds.has(img.id) && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-[var(--color-brand-500)] text-white rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10">
                           <Check size={12} strokeWidth={4} />
                        </div>
                      )}
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-center">
                      <div className="text-[12px] font-semibold mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis text-[var(--color-text-main)]">
                         {img.originalName}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                         {(img.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-[var(--color-text-main)]/20 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] p-6 w-full max-w-sm shadow-xl border border-[var(--color-border-main)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex text-[var(--color-danger)] mb-4 items-center gap-3">
              <AlertCircle size={28} />
              <h3 className="text-xl font-bold text-[var(--color-text-main)]">Confirm Deletion</h3>
            </div>
            
            <p className="text-[14px] text-[var(--color-text-muted)] mb-6">
              You are about to irreversibly delete <strong className="text-[var(--color-text-main)]">{selectedIds.size}</strong> item(s).
              Please enter the <strong>Admin Password</strong> to proceed.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); confirmDelete(); }}>
              <input
                type="password"
                className="input-capsule w-full mb-2 bg-white"
                placeholder="Enter admin password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoFocus
                required
              />
              {deleteError && <div className="text-xs text-[var(--color-danger)] font-medium mb-4 text-center">{deleteError}</div>}
              
              <div className="flex gap-3 justify-end mt-6">
                <button 
                  type="button" 
                  onClick={() => setShowDeleteModal(false)}
                  className="btn-secondary bg-white text-[14px]"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-danger"
                  disabled={deleting}
                >
                  {deleting ? "Verifying..." : "Verify & Delete"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
