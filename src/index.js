// ================================================================
// VẠN PHÁT BACKEND — Cloudflare Worker
// API JSON độc lập thay thế Google Apps Script Web App, gọi Google Sheets API
// trực tiếp bằng Service Account. Frontend (vanphatcompany.vn) gọi các endpoint
// dưới đây bằng fetch() thay vì google.script.run.
// ================================================================

import { xuLyChatBoxAI } from "./lib/geminiChat.js";
import { layToanBoDanhMucVaNhom } from "./lib/catalog.js";
import { kiemTraMaDoiTac } from "./lib/partnerCode.js";
import { traCuuLichSuMuaHang } from "./lib/orderHistory.js";
import { luuDonHang } from "./lib/checkout.js";

function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN;
  const allowOrigin = origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(env, origin, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env, origin) },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env, origin) });
    }

    // Phục vụ file tĩnh (ảnh sản phẩm / PDF phiếu giao hàng) lưu trong Workers KV — thay cho link
    // Google Drive (và thay R2, vì R2 cần bật gói riêng trên Cloudflare — KV thì miễn phí sẵn).
    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const key = decodeURIComponent(url.pathname.replace("/assets/", ""));
      const { value, metadata } = await env.ASSETS.getWithMetadata(key, { type: "arrayBuffer" });
      if (!value) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      headers.set("Content-Type", (metadata && metadata.contentType) || "application/octet-stream");
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(value, { headers });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json(env, origin, { ok: true, service: "vanphat-backend", time: new Date().toISOString() });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/catalog") {
        const bundle = await layToanBoDanhMucVaNhom(env);
        return json(env, origin, { success: true, ...bundle });
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await request.json();
        const result = await xuLyChatBoxAI(env, body.tinNhanKhach, body.lichSuHoiThoai, body.gioHangHienTai, body.thongTinKhachForm, body.laVaiTroBoSung);
        return json(env, origin, result);
      }

      if (request.method === "POST" && url.pathname === "/api/partner-code") {
        const body = await request.json();
        const result = await kiemTraMaDoiTac(env, body.maNhap);
        return json(env, origin, result);
      }

      if (request.method === "POST" && url.pathname === "/api/order-history") {
        const body = await request.json();
        const result = await traCuuLichSuMuaHang(env, body.sdt);
        return json(env, origin, result);
      }

      if (request.method === "POST" && url.pathname === "/api/checkout") {
        const body = await request.json();
        const result = await luuDonHang(env, body);
        return json(env, origin, result);
      }

      return json(env, origin, { success: false, message: "Không tìm thấy endpoint." }, 404);
    } catch (e) {
      console.error(e);
      return json(env, origin, { success: false, message: "Lỗi máy chủ: " + (e && e.message ? e.message : String(e)) }, 500);
    }
  },
};
