// Port của traCuuLichSuMuaHang() trong Code.gs gốc.
import { batchGetValues } from "./sheetsClient.js";

export async function traCuuLichSuMuaHang(env, sdt) {
  try {
    const phone = (sdt || "").toString().replace(/[^0-9]/g, "");
    if (!phone || phone.length < 8) return { success: false, message: "Số điện thoại không hợp lệ." };

    const [masterData, detailData] = await batchGetValues(env, ["'Lịch Sử Xuất Kho'!A2:H", "'Chi Tiết Đơn Hàng'!A2:H"]);

    if (!masterData || masterData.length === 0) {
      return { success: false, message: "Chưa có dữ liệu lịch sử đơn hàng." };
    }

    const matchedOrders = [];
    masterData.forEach((r) => {
      const thongTinKhach = r[3] ? r[3].toString() : "";
      const rawPhoneInText = thongTinKhach.replace(/[^0-9]/g, "");
      if (rawPhoneInText.includes(phone)) {
        matchedOrders.push({
          maDon: r[1],
          ngayLap: r[2],
          thongTinKhach: r[3],
          soKhoanMuc: r[4],
          tongTien: r[5],
          trangThai: r[6],
          pdfUrl: r[7],
        });
      }
    });

    if (matchedOrders.length === 0) {
      return { success: false, message: "Không tìm thấy lịch sử đơn hàng cho SĐT này." };
    }

    const sortedOrders = matchedOrders.reverse();
    const donGanNhatMa = sortedOrders[0].maDon;

    const sanPhamDaMua = [];
    const sanPhamDonGanNhat = [];
    const seenNames = new Set();

    (detailData || []).forEach((r) => {
      const maDon = r[0] ? r[0].toString().trim() : "";
      const tenSP = r[2] ? r[2].toString().trim() : "";

      if (maDon === donGanNhatMa && tenSP) {
        sanPhamDonGanNhat.push({ maSP: r[1] || "", ten: tenSP, dvt: r[3] || "Cái", gia: Number(r[5]) || 0, sl: Number(r[4]) || 1 });
      }

      if (sortedOrders.some((o) => o.maDon === maDon)) {
        if (tenSP && !seenNames.has(tenSP.toLowerCase())) {
          sanPhamDaMua.push({ maSP: r[1] || "", ten: tenSP, dvt: r[3] || "Cái", gia: Number(r[5]) || 0, slMacDinh: Number(r[4]) || 1 });
          seenNames.add(tenSP.toLowerCase());
        }
      }
    });

    return {
      success: true,
      donHangList: sortedOrders.slice(0, 5),
      donGanNhat: { maDon: donGanNhatMa, items: sanPhamDonGanNhat },
      sanPhamDaMua,
    };
  } catch (e) {
    return { success: false, message: "Lỗi tra cứu: " + e.toString() };
  }
}
