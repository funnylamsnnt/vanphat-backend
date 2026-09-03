// Port của kiemTraMaDoiTac() trong Code.gs gốc.
import { getValues } from "./sheetsClient.js";

export async function kiemTraMaDoiTac(env, maNhap) {
  try {
    const code = (maNhap || "").toString().trim().toLowerCase();
    if (!code) return { hopLe: false, message: "Vui lòng nhập mã đối tác." };

    // Dữ liệu bắt đầu từ hàng 5 trong bản gốc (4 hàng đầu là tiêu đề/ghi chú).
    const data = await getValues(env, "'Chính Sách Đối Tác'!A5:J");
    if (!data || data.length === 0) {
      return { hopLe: false, message: "Chưa có dữ liệu trong sheet Chính Sách Đối Tác." };
    }

    const row = data.find((r) => {
      const maTrongSheet = r[1] ? r[1].toString().trim().toLowerCase() : "";
      const trangThai = r[9] ? r[9].toString().trim().toLowerCase() : "";
      return maTrongSheet === code && trangThai === "hoạt động";
    });

    if (!row) {
      return { hopLe: false, message: "Mã đối tác không tồn tại hoặc đã ngừng áp dụng." };
    }

    const maChuan = row[1].toString().trim();
    const tenDoiTac = row[2] ? row[2].toString().trim() : "";
    const loaiGiam = row[4] ? row[4].toString().trim().toUpperCase() : "%";
    const mucGiam = Number(row[5]) || 0;

    return {
      hopLe: true,
      maDoiTac: maChuan,
      tenDoiTac,
      loaiGiam,
      mucGiam,
      message: `Đã kích hoạt: ${tenDoiTac} (${loaiGiam === "%" ? "Giảm " + mucGiam + "%" : "Giảm " + mucGiam.toLocaleString("vi-VN") + "đ"}/sản phẩm)`,
    };
  } catch (e) {
    return { hopLe: false, message: "Lỗi kiểm tra chính sách: " + e.toString() };
  }
}
