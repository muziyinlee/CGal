import { useState } from "react";
import { Download, Link2, Copy, Check } from "lucide-react";
import type { ImageData } from "../types";

interface ImageCardProps {
  image: ImageData;
}

export default function ImageCard({ image }: ImageCardProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const getAppUrl = () => {
    // Determine the base url
    let url = (import.meta as any).env.VITE_APP_URL || window.location.origin;
    if (url.includes("APP_URL")) url = window.location.origin; // fallback if unresolved
    return url.replace(/\/$/, ""); 
  };

  const getFullImageUrl = () => {
    const token = localStorage.getItem('app_token');
    let path = image.path;
    if (path.includes("/api/proxy_download") && token) {
      path += `&t=${token}`;
    }
    return `${getAppUrl()}${path}`;
  };

  const copyToClipboard = async (type: "url" | "html" | "md") => {
    const url = getFullImageUrl();
    let text = url;
    if (type === "html") {
      text = `<img src="${url}" alt="${image.originalName}" />`;
    } else if (type === "md") {
      text = `![${image.originalName}](${url})`;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleDownload = async () => {
    try {
      const token = localStorage.getItem('app_token');
      // If path is already a proxy download, use it. Otherwise construct it for local files.
      let targetUrl = image.path;
      if (!targetUrl.includes("/api/proxy_download")) {
         targetUrl = `/api/proxy_download?url=${encodeURIComponent(image.path)}`;
      }
      const res = await fetch(targetUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = image.originalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error(err);
    }
  };

  const imgPathWithToken = () => {
     const token = localStorage.getItem('app_token');
     const path = image.path;
     if (path.includes("/api/proxy_download") && token) return `${path}&t=${token}`;
     return path;
  };

  return (
    <div 
      className="card group relative flex flex-col h-full cursor-pointer transition-all hover:shadow-sm !overflow-visible rounded-[20px] hover:z-50"
      onMouseLeave={() => setShowOptions(false)}
    >
      <div className="relative h-[140px] bg-[#f0f4f3] flex items-center justify-center shrink-0 rounded-t-[20px]">
        <img
          src={imgPathWithToken()}
          alt={image.originalName}
          loading="lazy"
          className="w-full h-full object-cover rounded-t-[19px]"
        />
        
        {/* Overlay */}
        <div className="absolute inset-0 bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center gap-2.5 rounded-t-[19px] z-10">
          <div className="relative w-full flex justify-center">
            <button 
              onClick={() => setShowOptions(!showOptions)}
              className="hover-btn primary"
              title="Copy Link"
            >
              <Link2 size={14} /> Copy Link
            </button>
            
            {showOptions && (
              <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-[140px] bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-[var(--color-border-main)] py-1 flex flex-col z-[100]">
                <button 
                  onClick={() => copyToClipboard("url")}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--color-brand-100)] flex items-center gap-2 text-[var(--color-text-main)]"
                >
                  {copied === "url" ? <Check size={12} className="text-[var(--color-brand-500)]" /> : <Copy size={12} className="text-[var(--color-text-muted)]" />}
                  URL
                </button>
                <button 
                  onClick={() => copyToClipboard("html")}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--color-brand-100)] flex items-center gap-2 text-[var(--color-text-main)]"
                >
                  {copied === "html" ? <Check size={12} className="text-[var(--color-brand-500)]" /> : <Copy size={12} className="text-[var(--color-text-muted)]" />}
                  HTML
                </button>
                <button 
                  onClick={() => copyToClipboard("md")}
                  className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--color-brand-100)] flex items-center gap-2 text-[var(--color-text-main)]"
                >
                  {copied === "md" ? <Check size={12} className="text-[var(--color-brand-500)]" /> : <Copy size={12} className="text-[var(--color-text-muted)]" />}
                  Markdown
                </button>
              </div>
            )}
          </div>
          <button 
            onClick={handleDownload}
            className="hover-btn"
            title="Download Original"
          >
            <Download size={14} /> Download Raw
          </button>
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col justify-center">
        <div className="text-[14px] font-semibold mb-1 whitespace-nowrap overflow-hidden text-ellipsis text-[var(--color-text-main)]">
          {image.originalName}
        </div>
        <div className="text-[12px] text-[var(--color-text-muted)]">
           {(image.size / 1024 / 1024).toFixed(1)} MB • {new Date(image.createdAt).toISOString().split('T')[0]}
        </div>
      </div>
    </div>
  );
}
