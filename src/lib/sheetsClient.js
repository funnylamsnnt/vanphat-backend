// ================================================================
// GOOGLE SHEETS API v4 CLIENT
// Thay thế các lệnh SpreadsheetApp.getActiveSpreadsheet().getSheetByName(...)
// .getRange(...).getValues() / .setValues() / .appendRow() của Apps Script gốc.
// Mọi hàm ở đây thao tác trên ĐÚNG spreadsheet sống (SPREADSHEET_ID trong wrangler.toml)
// mà service account đã được cấp quyền Editor.
// ================================================================

import { getGoogleAccessToken } from "./googleAuth.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function authHeaders(env) {
  const token = await getGoogleAccessToken(env, SCOPES);
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

function encodeRange(range) {
  // Tên sheet tiếng Việt có dấu/khoảng trắng -> phải bọc trong dấu nháy đơn theo cú pháp A1,
  // ví dụ: 'Danh Mục Vật Tư'!A2:F999
  return encodeURIComponent(range);
}

/** Đọc 1 vùng, trả về mảng 2 chiều (như getRange().getValues()). */
export async function getValues(env, range) {
  const headers = await authHeaders(env);
  const url = `${API_BASE}/${env.SPREADSHEET_ID}/values/${encodeRange(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sheets getValues lỗi (${range}): ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.values || [];
}

/** Đọc nhiều vùng cùng lúc (1 lượt gọi mạng) — trả về mảng các mảng 2 chiều theo đúng thứ tự ranges. */
export async function batchGetValues(env, ranges) {
  const headers = await authHeaders(env);
  const qs = ranges.map((r) => "ranges=" + encodeRange(r)).join("&");
  const url = `${API_BASE}/${env.SPREADSHEET_ID}/values:batchGet?${qs}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sheets batchGetValues lỗi: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.valueRanges || []).map((vr) => vr.values || []);
}

/**
 * Ghi đè giá trị vào 1 vùng cố định (như getRange().setValues()).
 * valueInputOption "USER_ENTERED" để chuỗi bắt đầu bằng "=" được Sheets hiểu là công thức,
 * giống hệt hành vi khi Apps Script hoặc người dùng gõ trực tiếp trên Sheet.
 */
export async function updateValues(env, range, values) {
  const headers = await authHeaders(env);
  const url = `${API_BASE}/${env.SPREADSHEET_ID}/values/${encodeRange(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ values }) });
  if (!res.ok) throw new Error(`Sheets updateValues lỗi (${range}): ${res.status} ${await res.text()}`);
  return res.json();
}

/** Nối thêm hàng vào cuối 1 sheet (như sheet.appendRow() / getRange(lastRow+1,...).setValues()). */
export async function appendValues(env, sheetName, values) {
  const headers = await authHeaders(env);
  const url = `${API_BASE}/${env.SPREADSHEET_ID}/values/${encodeRange(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ values }) });
  if (!res.ok) throw new Error(`Sheets appendValues lỗi (${sheetName}): ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Lấy metadata các sheet (tên + sheetId + số hàng đã dùng) — hữu ích để biết "lastRow"
 * mà không cần đọc hết dữ liệu, tương đương sheet.getLastRow().
 */
export async function getSpreadsheetMeta(env) {
  const headers = await authHeaders(env);
  const url = `${API_BASE}/${env.SPREADSHEET_ID}?fields=sheets.properties`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Sheets getSpreadsheetMeta lỗi: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.sheets || []).map((s) => s.properties);
}
