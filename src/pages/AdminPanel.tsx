import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useUploader } from "../hooks/useUploader";
import type { ImageData } from "../types";
import { LogOut, UploadCloud, Trash2, DownloadCloud, AlertCircle, RefreshCw, Check, Settings } from "lucide-react";
import JSZip from "jszip";
import Footer from "../components/Footer";
import ImageCard from "../components/ImageCard";

export default function AdminPanel() {
  const { token, role, logout } = useAuth();
  const navigate = useNavigate();
  const { tasks, addFiles, uploadFile, clearDone } = useUploader(token || "");

  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [uploadFolder, setUploadFolder] = useState("images");
  const [activeFolder, setActiveFolder] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(12);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [siteTitle, setSiteTitle] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newGuestPassword, setNewGuestPassword] = useState("");

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
    fetchConfig();
  }, [token, role, navigate]);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (data.success && data.siteConfig) {
        setSiteTitle(data.siteConfig.title === "CGal" ? "" : (data.siteConfig.title || ""));
        if (data.siteConfig.title) {
          document.title = data.siteConfig.title + " - Admin Panel";
        }
      }
    } catch {}
  };

  const handleSaveTitle = async () => {
    const finalTitle = siteTitle.trim() || "CGal";
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: finalTitle })
      });
      alert("Site title updated successfully.");
      if (finalTitle === "CGal") setSiteTitle("");
      document.title = finalTitle + " - Admin Panel";
    } catch {
      alert("Failed to update site title.");
    }
  };

  const handleChangePassword = async (targetRole: 'admin' | 'guest') => {
    const pw = targetRole === 'admin' ? newAdminPassword : newGuestPassword;
    if (!pw) return;
    try {
      const res = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: targetRole, newPassword: pw })
      });
      const data = await res.json();
      if (data.success) {
        alert(`${targetRole} password updated successfully.`);
        if (targetRole === 'admin') setNewAdminPassword("");
        if (targetRole === 'guest') setNewGuestPassword("");
        if (targetRole === role) logout(); // force re-login if changing own password
      } else {
        alert("Failed to update password");
      }
    } catch {
      alert("Failed to update password");
    }
  };

  const fetchImages = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/images", {
        headers: { Authorization: `Bearer ${token}` }
      });
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
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we are leaving the main container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      addFiles(files, uploadFolder);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      addFiles(files, uploadFolder);
    }
  };

  const handleProcessQueue = async () => {
    const pendingTasks = tasks.filter(t => t.status === "pending");
    const CONCURRENCY_LIMIT = 3;
    let i = 0;
    
    const workers = Array(CONCURRENCY_LIMIT).fill(null).map(async () => {
      while (i < pendingTasks.length) {
        const task = pendingTasks[i++];
        if (task) {
          try {
            await uploadFile(task);
          } catch (e) {
            // Continue with others
          }
        }
      }
    });

    await Promise.all(workers);
    fetchImages();
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const displayedImages = images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder);
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(displayedImages.length / (itemsPerPage as number));
  const currentImages = itemsPerPage === 'all' ? displayedImages : displayedImages.slice((currentPage - 1) * (itemsPerPage as number), currentPage * (itemsPerPage as number));

  const toggleSelectAll = () => {
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
      let anyErrors = false;
      for (const id of idsToDelete) {
        const dRes = await fetch(`/api/images/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await dRes.json();
        if (!data.success) anyErrors = true;
      }

      if (anyErrors) {
        setDeleteError("Some images failed to delete from GitCode. You may need to check branch permissions.");
        setDeleting(false);
        fetchImages(); // Still refresh what might have succeeded
        return;
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
    if (selectedIds.size === 0 || isDownloading) return;
    setIsDownloading(true);
    
    // We must use JSZip to compose the blob and force file download,
    // avoiding URL length limits that happen when doing generic encodeURIComponent lists.
    const zip = new JSZip();
    const imgsToDownload = images.filter((img) => selectedIds.has(img.id));
    
    for (const img of imgsToDownload) {
      try {
        let targetUrl = img.path;
        if (!targetUrl.includes("/api/proxy_download")) {
           targetUrl = `/api/proxy_download?url=${encodeURIComponent(img.path)}`;
        }
        // Proxy fetch the file
        const res = await fetch(targetUrl, {
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
      a.download = `${siteTitle || 'Admin'}_Batch_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Failed to generate zip", err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen pb-20 flex flex-col">
      <header className="bg-white border-b border-[var(--color-border-main)] h-[72px] flex items-center px-8 z-30">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-500)] flex items-center justify-center text-white font-bold text-sm">
              <span className="text-[16px] font-sans">{siteTitle ? siteTitle[0].toUpperCase() : 'C'}</span>
            </div>
            <h1 className="font-bold text-[20px] tracking-tight text-[var(--color-brand-500)]">{siteTitle ? `${siteTitle} Admin` : "CGal Admin"}</h1>
            <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-[12px] font-bold ml-2">ADMIN</span>
          </div>
          <div className="flex gap-4 items-center">
            <button onClick={handleLogout} className="text-sm font-semibold text-[var(--color-danger)] hover:opacity-80 flex items-center gap-1">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8 w-full flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Col: Upload Zone */}
        <div className="lg:col-span-1 lg:max-w-xs w-full flex flex-col gap-6">
          <div className="card !p-0">
            <div className="border-b border-[var(--color-border-main)] p-4 flex items-center gap-2">
              <UploadCloud size={18} className="text-[var(--color-text-main)]" />
              <h2 className="font-semibold text-[var(--color-text-main)] text-[14px]">Upload Center</h2>
            </div>
            
            <div className="p-4 border-b border-[var(--color-border-main)] relative">
              <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-2 uppercase tracking-[1px]">Target Category</label>
              <input 
                type="text" 
                value={uploadFolder}
                onChange={(e) => setUploadFolder(e.target.value)}
                className="w-full bg-[var(--color-bg-base)] border border-[var(--color-border-main)] rounded-[8px] px-3 py-2 text-[14px] outline-none focus:border-[var(--color-brand-500)] transition-colors mb-3"
                placeholder="e.g. images/cgal"
              />
              <div className="flex flex-wrap gap-1.5">
                {folders.filter(f => f !== "All").map(f => (
                  <button 
                    key={f}
                    onClick={() => setUploadFolder(f)}
                    className="text-[11px] px-2 py-1 bg-gray-100 hover:bg-[var(--color-brand-100)] hover:text-[var(--color-brand-500)] rounded-full text-gray-600 transition-colors"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            
            <div 
              className={`p-8 flex flex-col items-center justify-center border border-dashed m-4 rounded-[12px] bg-[#fcfdfd] transition-colors cursor-pointer ${isDragging ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-100)]' : 'border-[var(--color-border-main)] hover:bg-[var(--color-brand-100)]'}`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
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
                        {task.status === "compressing" && <span className="text-[var(--color-accent-blue)] animate-pulse">Comp</span>}
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
          
          <div className="card !p-0">
             <div 
               className="border-b border-[var(--color-border-main)] p-4 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-50"
               onClick={() => setShowSettings(!showSettings)}
             >
               <div className="flex items-center gap-2">
                 <Settings size={18} className="text-[var(--color-text-main)]" />
                 <h2 className="font-semibold text-[var(--color-text-main)] text-[14px]">Site Settings</h2>
               </div>
               {showSettings ? <span className="text-[var(--color-text-muted)] text-[12px]">Collapse</span> : <span className="text-[var(--color-text-muted)] text-[12px]">Expand</span>}
             </div>
             
             {showSettings && (
               <div className="p-4 flex flex-col gap-5">
               <div>
                 <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-2 uppercase tracking-[1px]">Site Title</label>
                 <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={siteTitle} 
                     onChange={e => setSiteTitle(e.target.value)} 
                     placeholder="CGal" 
                     className="input-capsule flex-1 h-9 min-w-0" 
                   />
                   <button onClick={handleSaveTitle} className="btn-primary h-9 flex-none !px-4 font-semibold text-[13px] flex items-center justify-center">Save</button>
                 </div>
               </div>
               
               <div className="pt-4 border-t border-[var(--color-border-main)]">
                 <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-2 uppercase tracking-[1px]">Change Admin Pass</label>
                 <div className="flex gap-2 mb-4">
                   <input type="password" value={newAdminPassword} onChange={e => setNewAdminPassword(e.target.value)} placeholder="New password" className="input-capsule flex-1 h-9 min-w-0" />
                   <button onClick={() => handleChangePassword('admin')} className="btn-secondary h-9 flex-none !px-4 font-semibold text-[13px] flex items-center justify-center">Update</button>
                 </div>
                 
                 <label className="text-[12px] font-semibold text-[var(--color-text-muted)] block mb-2 uppercase tracking-[1px]">Change Guest Pass</label>
                 <div className="flex gap-2">
                   <input type="password" value={newGuestPassword} onChange={e => setNewGuestPassword(e.target.value)} placeholder="New password" className="input-capsule flex-1 h-9 min-w-0" />
                   <button onClick={() => handleChangePassword('guest')} className="btn-secondary h-9 flex-none !px-4 font-semibold text-[13px] flex items-center justify-center">Update</button>
                 </div>
               </div>
             </div>
             )}
          </div>
        </div>

        {/* Right Col: Manage Zone */}
        <div className="lg:col-span-3 min-w-0">
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h2 className="font-bold text-[24px] text-[var(--color-text-main)] m-0">Library</h2>
                <p className="text-[14px] text-[var(--color-text-muted)] mt-1">{images.length} items preserved</p>
              </div>
              <div className="flex flex-wrap gap-2 flex-1">
                {folders.map(f => (
                  <button
                    key={f}
                    onClick={() => {
                      setActiveFolder(f);
                      setCurrentPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-bold transition-colors ${
                      activeFolder === f 
                      ? "bg-[var(--color-brand-500)] text-white shadow-sm shadow-[var(--color-brand-500)]/20" 
                      : "bg-white border border-[var(--color-border-main)] text-[var(--color-text-main)] hover:border-[var(--color-brand-500)]"
                    }`}
                  >
                    {f === "All" ? "All Categories" : f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={fetchImages} className="btn-secondary !px-4 hover:bg-[var(--color-bg-base)] text-[14px] font-semibold">
                  <RefreshCw size={14} /> Refresh
                </button>
                {selectedIds.size > 0 && (
                  <>
                    <button 
                      onClick={handleBatchDownload} 
                      disabled={isDownloading}
                      className={`btn-secondary !px-4 hover:bg-[var(--color-bg-base)] text-[14px] font-semibold gap-2 border-[var(--color-accent-blue)] text-[var(--color-text-main)] ${isDownloading ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {isDownloading ? (
                        <><span className="w-3 h-3 border-2 border-[var(--color-text-main)] border-t-transparent rounded-full animate-spin"></span> Packing...</>
                      ) : (
                        <><DownloadCloud size={14} /> Package Zip</>
                      )}
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
              <>
                <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                  <div className="flex items-center gap-2 cursor-pointer text-[14px] text-[var(--color-text-main)] font-semibold" onClick={toggleSelectAll}>
                    <input type="checkbox" checked={selectedIds.size === displayedImages.length && displayedImages.length > 0} readOnly className="w-4 h-4 rounded text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] accent-[var(--color-brand-500)]" />
                    Select All
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-[var(--color-text-muted)] font-semibold">Items per page:</span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-white border border-[var(--color-border-main)] rounded-[8px] px-2 py-1 text-[13px] font-semibold text-[var(--color-text-main)] outline-none focus:border-[var(--color-brand-500)]"
                    >
                      <option value={12}>12</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-5 pb-4">
                  {currentImages.map((img) => (
                    <div key={img.id} className="relative group/wrapper cursor-pointer" onClick={(e) => { e.preventDefault(); toggleSelect(img.id); }}>
                      {selectedIds.has(img.id) && (
                        <div className="absolute inset-0 bg-[var(--color-brand-500)]/10 rounded-[20px] pointer-events-none z-[40] border-2 border-[var(--color-brand-500)]"></div>
                      )}
                      <ImageCard 
                        image={img} 
                        actionLeft={
                          <div className={`transition-opacity ${selectedIds.has(img.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/wrapper:opacity-100'}`}>
                            <input 
                              type="checkbox" 
                              checked={selectedIds.has(img.id)}
                              readOnly
                              className="w-5 h-5 rounded cursor-pointer accent-[var(--color-brand-500)] shadow-sm pointer-events-none"
                            />
                          </div>
                        }
                        actionRight={
                          <button 
                            onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set([img.id])); setShowDeleteModal(true); }}
                            className="p-1.5 bg-red-500/90 text-white rounded-[8px] opacity-100 md:opacity-0 group-hover/wrapper:opacity-100 transition-opacity hover:bg-red-600 shadow-sm"
                          >
                            <Trash2 size={14} />
                          </button>
                        }
                      />
                    </div>
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="flex justify-center items-center gap-2 mt-4">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border-main)] disabled:opacity-50 font-semibold text-[14px] hover:bg-gray-50"
                    >
                      Prev
                    </button>
                    <div className="flex gap-1 flex-wrap">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`w-8 h-8 rounded-[8px] font-bold text-[14px] flex items-center justify-center transition-colors ${currentPage === pageNum ? 'bg-[var(--color-brand-500)] text-white' : 'hover:bg-gray-50 text-[var(--color-text-main)] border border-transparent hover:border-[var(--color-border-main)]'}`}
                        >
                          {pageNum}
                        </button>
                      ))}
                    </div>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border-main)] disabled:opacity-50 font-semibold text-[14px] hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-[var(--color-text-main)]/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
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
