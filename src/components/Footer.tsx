import { Github } from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full py-6 mt-auto shrink-0 bg-transparent">
      <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row justify-between items-center gap-4 text-[13px] text-[var(--color-text-muted)]">
        <div>
          &copy; {new Date().getFullYear()} Clover Gallery <span className="font-mono text-[11px] ml-1 bg-gray-100 px-1.5 py-0.5 rounded-full border border-gray-200">v1.2.0</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-brand-500)] transition-colors underline decoration-dotted underline-offset-4">
            MIT License
          </a>
          <span className="w-1 h-1 rounded-full bg-gray-300"></span>
          <span>Open Source</span>
        </div>
        <div className="text-right text-[12px]">
          Disclaimer: This gallery is for showcase purposes.<br className="hidden md:block" /> 
          Data integrity relies on your deployment environment.
        </div>
      </div>
    </footer>
  );
}
