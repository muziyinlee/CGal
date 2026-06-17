import { useState, useRef, useEffect } from "react";
import SparkMD5 from "spark-md5";
import imageCompression from "browser-image-compression";

interface FileUploadTask {
  id: string;
  file: File;
  folder: string;
  progress: number;
  status: "pending" | "compressing" | "hashing" | "uploading" | "success" | "error";
  error?: string;
}

export function useUploader(token: string) {
  const [tasks, setTasks] = useState<FileUploadTask[]>([]);
  const isUploading = useRef(false);

  // Compute MD5 chunk by chunk to prevent memory bloat
  const computeMD5 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const blobSlice = File.prototype.slice || (File.prototype as any).mozSlice || (File.prototype as any).webkitSlice;
      const chunkSize = 2097152; // 2MB
      const chunks = Math.ceil(file.size / chunkSize);
      let currentChunk = 0;
      const spark = new SparkMD5.ArrayBuffer();
      const fileReader = new FileReader();

      fileReader.onload = (e) => {
        if (e.target?.result) {
          spark.append(e.target.result as ArrayBuffer);
          currentChunk++;
          if (currentChunk < chunks) {
            loadNext();
          } else {
            resolve(spark.end());
          }
        } else {
          reject(new Error("Failed to read chunk"));
        }
      };

      fileReader.onerror = () => {
        reject(fileReader.error);
      };

      function loadNext() {
        const start = currentChunk * chunkSize;
        const end = start + chunkSize >= file.size ? file.size : start + chunkSize;
        fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
      }

      loadNext();
    });
  };

  const uploadFile = async (task: FileUploadTask) => {
    try {
      let finalFile = task.file;

      if (task.file.type.startsWith("image/") && task.file.size > 500 * 1024) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: "compressing" } : t)));
        try {
          const options = {
            maxSizeMB: 1,
            maxWidthOrHeight: 1920,
            useWebWorker: true
          };
          finalFile = await imageCompression(task.file, options) as File;
        } catch (e) {
          console.warn("Compression failed, using original file", e);
        }
      }

      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: "hashing" } : t))
      );

      const md5 = await computeMD5(finalFile);
      
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: "uploading", progress: 10 } : t))
      );

      const formData = new FormData();
      formData.append("file", finalFile);
      formData.append("md5", md5);
      formData.append("originalName", finalFile.name);
      formData.append("folder", task.folder);

      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Upload failed");

      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: "success", progress: 100 } : t))
      );
      
      return data.image; // Return metadata so we can refresh
    } catch (err: any) {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, status: "error", error: err.message } : t))
      );
      throw err;
    }
  };

  const addFiles = (files: File[], folder: string = "images") => {
    const newTasks: FileUploadTask[] = files.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      folder,
      progress: 0,
      status: "pending",
    }));
    setTasks((prev) => [...prev, ...newTasks]);
  };

  const clearDone = () => {
    setTasks(tasks.filter(t => t.status === "pending" || t.status === "uploading" || t.status === "hashing" || t.status === "compressing"));
  };

  return { tasks, addFiles, uploadFile, clearDone };
}
