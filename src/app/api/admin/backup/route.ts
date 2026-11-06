import { getSession } from "@/lib/auth";
import { requireAdminPermission } from "@/lib/authorization";
import { ApiError, failure, success } from "@/lib/http";
import { MAX_BACKUP_BYTES } from "@/lib/backup-format";
import { backupHash, exportBackup, previewRestore, readSafetyBackup, restoreBackup, RestoreFailure } from "@/services/admin-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateResponse = (response: Response) => { response.headers.set("Cache-Control", "private, no-store"); return response; };
function formatOf(url: URL) {
  const format = url.searchParams.get("format") || "json";
  if (format !== "json" && format !== "cql") throw new ApiError("Định dạng phải là JSON hoặc CQL.");
  return format;
}
async function uploadText(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > MAX_BACKUP_BYTES) throw new ApiError("File tối đa 20 MB.", 413);
  if (!request.body) throw new ApiError("Vui lòng chọn file khôi phục.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BACKUP_BYTES) { await reader.cancel(); throw new ApiError("File tối đa 20 MB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new ApiError("File khôi phục trống.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new ApiError("File phải sử dụng mã hóa UTF-8."); }
}
export async function GET(request: Request) {
  try {
    requireAdminPermission(await getSession());
    const url = new URL(request.url), saved = url.searchParams.get("safety");
    const format = saved ? "json" : formatOf(url);
    const result = saved ? { text: await readSafetyBackup(saved), filename: saved } : await exportBackup(format);
    return privateResponse(new Response(result.text, { headers: { "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "X-Content-Type-Options": "nosniff" } }));
  } catch (error) { return privateResponse(failure(error)); }
}
export async function POST(request: Request) {
  try {
    requireAdminPermission(await getSession());
    const url = new URL(request.url), origin = request.headers.get("origin");
    // Next can expose localhost in request.url when the browser used 127.0.0.1.
    // Host is the browser's destination; do not trust forwarded-host headers.
    const host = request.headers.get("host");
    const origins = new Set([url.origin, ...(host ? [`${url.protocol}//${host}`] : [])]);
    if (origin && !origins.has(origin)) throw new ApiError("Yêu cầu khôi phục phải xuất phát từ trang quản trị.", 403);
    const format = formatOf(url), action = url.searchParams.get("action");
    if (action !== "preview" && action !== "restore") throw new ApiError("Thao tác không hợp lệ.");
    const text = await uploadText(request);
    if (action === "preview") return privateResponse(success(await previewRestore(text, format)));
    const mode = url.searchParams.get("mode");
    if (mode !== "merge" && mode !== "replace") throw new ApiError("Vui lòng chọn cách khôi phục.");
    if (request.headers.get("x-restore-confirm") !== "RESTORE" || request.headers.get("x-backup-hash") !== backupHash(text)) throw new ApiError("Hãy kiểm tra file và xác nhận trước khi khôi phục.");
    const key = request.headers.get("idempotency-key") || "";
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new ApiError("Thiếu mã yêu cầu khôi phục.");
    return privateResponse(success(await restoreBackup(text, format, mode, key)));
  } catch (error) {
    const response = error instanceof RestoreFailure
      ? Response.json({ success: false, message: error.message, safetyBackup: error.safetyBackup }, { status: error.status })
      : failure(error);
    return privateResponse(response);
  }
}
