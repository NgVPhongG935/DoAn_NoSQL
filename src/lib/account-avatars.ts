import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { Role } from "@/lib/demo-users";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
function avatarPath(role: Role, id: string) {
  z.enum(["CUSTOMER", "DRIVER", "ADMIN"]).parse(role);
  if (role === "ADMIN") z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).parse(id);
  else z.uuid().parse(id);
  // Local demo storage persists across web-server restarts; Cassandra is untouched.
  return path.join(process.env.RIDEFLOW_AVATAR_DIR || path.join(process.cwd(), ".data", "avatars"), `${role.toLowerCase()}-${id}.json`);
}

export async function readAvatar(role: Role, id: string): Promise<{ type: string; bytes: Buffer } | null> {
  try {
    const stored = JSON.parse(await readFile(avatarPath(role, id), "utf8"));
    if (!["image/png", "image/jpeg", "image/webp"].includes(stored.type)) throw new Error("Invalid avatar format");
    return { type: stored.type, bytes: Buffer.from(stored.data, "base64") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveAvatar(role: Role, id: string, file: File) {
  if (!file.size || file.size > MAX_AVATAR_BYTES) throw new ApiError("Ảnh đại diện cần có dung lượng tối đa 2 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  const webp = bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const type = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : "";
  if (!type || file.type !== type) throw new ApiError("Vui lòng chọn ảnh PNG, JPG hoặc WebP hợp lệ.");
  const destination = avatarPath(role, id), temp = `${destination}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(temp, JSON.stringify({ type, data: bytes.toString("base64") }), { flag: "wx" });
    await rename(temp, destination);
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function removeAvatar(role: Role, id: string) {
  await unlink(avatarPath(role, id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}
