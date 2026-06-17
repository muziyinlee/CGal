import { useState, useEffect } from "react";
import ImageCard from "../components/ImageCard";
import type { ImageData } from "../types";
import { Link, useNavigate } from "react-router-dom";
import { Settings, LogOut, Check, DownloadCloud } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import JSZip from "jszip";
import Footer from "../components/Footer";

export default function GuestGallery() {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { token, role, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }

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
    if (selectedIds.size === 0) return;
    
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[var(--color-border-main)] h-[72px] flex items-center px-8 shrink-0">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[var(--color-brand-500)] flex items-center justify-center text-white font-bold text-sm">
              <span className="text-[16px] font-sans">C</span>
            </div>
            <h1 className="font-bold text-[20px] tracking-tight text-[var(--color-brand-500)]">Clover Gallery</h1>
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
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-[24px] text-[var(--color-text-main)]">Gallery</h2>
          <div className="flex items-center gap-4">
            <span className="text-[14px] text-[var(--color-text-muted)] font-semibold">
              {displayedImages.length} items
            </span>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBatchDownload}
                className="btn-primary flex items-center gap-2 px-3 py-1.5 !text-[13px] !h-auto"
              >
                <DownloadCloud size={16} />
                Download ({selectedIds.size})
              </button>
            )}
            <select 
              value={activeFolder} 
              onChange={(e) => {
                setActiveFolder(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-white border border-[var(--color-border-main)] rounded-[8px] px-3 py-2 text-[14px] font-semibold text-[var(--color-text-main)] outline-none focus:border-[var(--color-brand-500)]"
            >
              {folders.map(f => (
                <option key={f} value={f}>{f === "All" ? "All Folders" : f}</option>
              ))}
            </select>
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
              {currentImages.map((img) => (
                <div key={img.id} className="relative group/wrapper">
                  <div className="absolute top-2 left-2 z-10 opacity-0 group-hover/wrapper:opacity-100 transition-opacity">
                    <input 
                      type="checkbox" 
                      checked={selectedIds.has(img.id)}
                      onChange={() => toggleSelect(img.id)}
                      className="w-5 h-5 rounded cursor-pointer accent-[var(--color-brand-500)] shadow-sm"
                    />
                  </div>
                  {selectedIds.has(img.id) && (
                    <div className="absolute inset-0 bg-[var(--color-brand-500)]/10 rounded-[20px] pointer-events-none z-20 border-2 border-[var(--color-brand-500)]"></div>
                  )}
                  <ImageCard image={img} />
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
            <div className="text-[var(--color-text-muted)] mb-2">No images in the gallery yet.</div>
            <div className="text-sm text-[var(--color-text-muted)]">Admins can log in to upload.</div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
