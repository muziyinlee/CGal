import { useState, useEffect } from "react";
import ImageCard from "../components/ImageCard";
import type { ImageData } from "../types";
import { Link, useNavigate } from "react-router-dom";
import { Settings, LogOut, Check, DownloadCloud, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import JSZip from "jszip";
import Footer from "../components/Footer";
import { AnimatePresence, motion } from "framer-motion";

export default function GuestGallery() {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDownloading, setIsDownloading] = useState(false);
  const [siteTitle, setSiteTitle] = useState("CGal");
  const [lightboxImage, setLightboxImage] = useState<ImageData | null>(null);
  const { token, role, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    
    if (role === "admin") {
      navigate("/admin");
      return;
    }

    fetch("/api/config")
      .then(res => res.json())
      .then(data => {
        if (data.success && data.siteConfig?.title) {
          setSiteTitle(data.siteConfig.title);
          document.title = data.siteConfig.title;
        }
      })
      .catch(() => {});

    fetch("/api/images", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (!res.ok) {
           if (res.status === 401) { logout(); navigate("/login"); }
           throw new Error("Unauthorized");
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.success) {
          setImages(data.images);
        }
      })
      .catch((err) => console.error("Failed to fetch images", err))
      .finally(() => setLoading(false));
  }, [token, navigate, logout]);

  if (!token) return null;

  const folders = ["All", ...Array.from(new Set(images.map((i) => i.folder || "images")))];
  const displayedImages = images.filter(img => activeFolder === "All" || (img.folder || "images") === activeFolder);
  
  const totalPages = Math.ceil(displayedImages.length / itemsPerPage);
  const currentImages = displayedImages.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedImages.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(displayedImages.map((i) => i.id)));
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0 || isDownloading) return;
    setIsDownloading(true);
    
    const zip = new JSZip();
    const imgsToDownload = images.filter((img) => selectedIds.has(img.id));
    
    for (const img of imgsToDownload) {
      try {
        let targetUrl = img.path;
        if (!targetUrl.includes("/api/proxy_download")) {
           targetUrl = `/api/proxy_download?url=${encodeURIComponent(img.path)}`;
        }
        const res = await fetch(targetUrl, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Fetch failed");
        const blob = await res.blob();
        zip.file(img.originalName || "image.png", blob);
      } catch (err) {
        console.error(`Failed to fetch ${img.originalName} for zip`);
      }
    }

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = `${siteTitle}_Batch_${Date.now()}.zip`;
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[var(--color-border-main)] h-[72px] flex items-center px-8 shrink-0">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-500)] flex items-center justify-center text-white font-bold text-sm">
              <span className="text-[16px] font-sans">{siteTitle ? siteTitle[0].toUpperCase() : 'C'}</span>
            </div>
            <h1 className="font-bold text-[20px] tracking-tight text-[var(--color-brand-500)]">{siteTitle || "CGal"}</h1>
            <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-[12px] font-bold ml-2 uppercase">{role}</span>
          </div>
          <div className="flex items-center gap-2">
            {role === "admin" && (
              <Link to="/admin" className="btn-secondary !bg-transparent hover:!bg-gray-50 !border-transparent">
                <Settings size={16} /> Admin Panel
              </Link>
            )}
            <button onClick={() => { logout(); navigate("/login"); }} className="btn-secondary !bg-transparent hover:!bg-gray-50 !border-transparent !text-[var(--color-danger)]">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-8 py-8 w-full flex-1">
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[24px] text-[var(--color-text-main)]">CGal</h2>
              <div className="flex items-center gap-4">
                <span className="text-[14px] text-[var(--color-text-muted)] font-semibold">
                  {displayedImages.length} items
                </span>
                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBatchDownload}
                    disabled={isDownloading}
                    className={`btn-primary flex items-center gap-2 px-3 py-1.5 !text-[13px] !h-auto ${isDownloading ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isDownloading ? (
                      <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Preparing...</>
                    ) : (
                      <><DownloadCloud size={16} /> Download ({selectedIds.size})</>
                    )}
                  </button>
                )}
              </div>
            </div>
            
            {/* Folder Pills / Masonry Tags */}
            <div className="flex flex-wrap gap-2">
              {folders.map(f => (
                <button
                  key={f}
                  onClick={() => {
                    setActiveFolder(f);
                    setCurrentPage(1);
                  }}
                  className={`px-4 py-1.5 rounded-full text-[13px] font-bold transition-colors ${
                    activeFolder === f 
                    ? "bg-[var(--color-brand-500)] text-white shadow-md shadow-[var(--color-brand-500)]/20" 
                    : "bg-white border border-[var(--color-border-main)] text-[var(--color-text-main)] hover:border-[var(--color-brand-500)]"
                  }`}
                >
                  {f === "All" ? "All Categories" : f}
                </button>
              ))}
            </div>
          </div>
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-[var(--color-brand-500)] border-t-transparent rounded-full"></div>
          </div>
        ) : displayedImages.length > 0 ? (
          <>
            <div className="mb-4 flex items-center gap-2 cursor-pointer text-[14px] text-[var(--color-text-main)] font-semibold" onClick={toggleSelectAll}>
              <input type="checkbox" checked={selectedIds.size === displayedImages.length && displayedImages.length > 0} readOnly className="w-4 h-4 rounded text-[var(--color-brand-500)] focus:ring-[var(--color-brand-500)] accent-[var(--color-brand-500)]" />
              Select All
            </div>
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-5">
              {currentImages.map((img) => (
                <div key={img.id} className="break-inside-avoid relative group/wrapper mb-5 rounded-[20px]">
                  {selectedIds.has(img.id) && (
                    <div className="absolute inset-0 bg-[var(--color-brand-500)]/10 rounded-[20px] pointer-events-none z-[40] border-2 border-[var(--color-brand-500)]"></div>
                  )}
                  <ImageCard 
                    image={img} 
                    onClick={() => setLightboxImage(img)}
                    actionLeft={
                      <div className={`transition-opacity ${selectedIds.has(img.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/wrapper:opacity-100'}`}>
                        <div 
                          className="cursor-pointer p-1"
                          onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}
                        >
                          <input 
                            type="checkbox" 
                            checked={selectedIds.has(img.id)}
                            readOnly
                            className="w-5 h-5 rounded cursor-pointer accent-[var(--color-brand-500)] shadow-sm pointer-events-none"
                          />
                        </div>
                      </div>
                    }
                  />
                </div>
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-8">
                <button 
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-[8px] border border-[var(--color-border-main)] disabled:opacity-50 font-semibold text-[14px] hover:bg-gray-50"
                >
                  Prev
                </button>
                <div className="flex gap-1">
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
        ) : (
          <div className="text-center py-20 bg-white rounded-[20px] border border-[var(--color-border-main)]">
            <div className="text-[var(--color-text-muted)] mb-2">No images in CGal yet.</div>
            <div className="text-sm text-[var(--color-text-muted)]">Admins can log in to upload.</div>
          </div>
        )}
      </main>

      <Footer />

      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[var(--color-bg-base)]/90 backdrop-blur-md"
            onClick={() => setLightboxImage(null)}
          >
            <button 
              className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-[var(--color-text-main)] transition-colors"
              onClick={() => setLightboxImage(null)}
            >
              <X size={24} />
            </button>
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative max-w-5xl max-h-[90vh] w-full flex flex-col items-center justify-center shadow-2xl rounded-[20px] overflow-hidden bg-white/50 border border-[var(--color-border-main)]"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={(() => {
                  const token = localStorage.getItem('app_token');
                  const path = lightboxImage.path;
                  if (path.includes("/api/proxy_download") && token) return `${path}&t=${token}`;
                  return path;
                })()} 
                alt={lightboxImage.originalName}
                loading="lazy"
                className="max-w-full max-h-[85vh] object-contain rounded-[20px]"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
