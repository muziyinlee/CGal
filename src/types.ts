export interface ImageData {
  id: string;
  originalName: string;
  md5: string;
  path: string;
  size: number;
  mimetype: string;
  createdAt: number;
  folder?: string;
}
