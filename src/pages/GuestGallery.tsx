import { useState, useEffect } from "react";
import ImageCard from "../components/ImageCard";
import type { ImageData } from "../types";
import { Link, useNavigate } from "react-router-dom";
import { Settings, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function GuestGallery() {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState("All");
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
            {role !== "admin" && (
              <Link to="/login" className="btn-secondary !bg-transparent hover:!bg-gray-50 !border-transparent">
                <Settings size={16} /> Admin Login
              </Link>
            )}
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
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin w-8 h-8 border-4 border-[var(--color-brand-500)] border-t-transparent rounded-full"></div>
          </div>
        ) : displayedImages.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {displayedImages.map((img) => (
              <div key={img.id}>
                <ImageCard image={img} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-white rounded-[20px] border border-[var(--color-border-main)]">
            <div className="text-[var(--color-text-muted)] mb-2">No images in the gallery yet.</div>
            <div className="text-sm text-[var(--color-text-muted)]">Admins can log in to upload.</div>
          </div>
        )}
      </main>
    </div>
  );
}
