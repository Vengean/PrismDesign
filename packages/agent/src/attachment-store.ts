import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

interface Attachment extends AttachmentMeta {
  clientId: string;
  filePath: string;
  createdAt: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;
const TTL_MS = 30 * 60 * 1000;
const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".csv", ".html", ".css", ".js", ".jsx", ".ts", ".tsx",
  ".yaml", ".yml", ".xml", ".sql", ".log", ".sh", ".py", ".java", ".go", ".rs",
]);

export class AttachmentStore {
  private readonly records = new Map<string, Attachment>();
  private readonly root = fs.mkdtempSync(path.join(os.tmpdir(), "prism-attachments-"));
  private readonly cleanupTimer = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);

  constructor() { this.cleanupTimer.unref?.(); }

  create(clientId: string, name: string, mimeType: string, content: Buffer): AttachmentMeta {
    const safeName = path.basename(name || "attachment.txt");
    if (!ALLOWED_EXTENSIONS.has(path.extname(safeName).toLowerCase())) throw new Error("Unsupported attachment type");
    if (!content.length) throw new Error("Attachment is empty");
    if (content.length > MAX_FILE_SIZE) throw new Error("Attachment exceeds the 5 MB limit");
    const id = `attachment-${randomBytes(12).toString("hex")}`;
    const filePath = path.join(this.root, id);
    fs.writeFileSync(filePath, content, { flag: "wx", mode: 0o600 });
    const record = { id, clientId, name: safeName, mimeType: mimeType || "text/plain", size: content.length, filePath, createdAt: Date.now() };
    this.records.set(id, record);
    return this.meta(record);
  }

  resolveText(clientId: string, ids: string[]): Array<AttachmentMeta & { text: string; truncated: boolean }> {
    if (ids.length > 5) throw new Error("A message can include at most 5 attachments");
    return ids.map((id) => {
      const record = this.getOwned(id, clientId);
      const content = fs.readFileSync(record.filePath, "utf8");
      return { ...this.meta(record), text: content.slice(0, MAX_TEXT_LENGTH), truncated: content.length > MAX_TEXT_LENGTH };
    });
  }

  remove(clientId: string, id: string) {
    const record = this.getOwned(id, clientId);
    this.records.delete(id);
    try { fs.unlinkSync(record.filePath); } catch {}
  }

  close() {
    clearInterval(this.cleanupTimer);
    try { fs.rmSync(this.root, { recursive: true, force: true }); } catch {}
    this.records.clear();
  }

  private getOwned(id: string, clientId: string) {
    const record = this.records.get(id);
    if (!record || record.clientId !== clientId) throw new Error("Attachment not found or expired");
    if (Date.now() - record.createdAt > TTL_MS) { this.remove(clientId, id); throw new Error("Attachment expired"); }
    return record;
  }

  private meta(record: Attachment): AttachmentMeta {
    return { id: record.id, name: record.name, mimeType: record.mimeType, size: record.size };
  }

  private cleanupExpired() {
    for (const record of this.records.values()) if (Date.now() - record.createdAt > TTL_MS) this.remove(record.clientId, record.id);
  }
}
