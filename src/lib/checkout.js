// Port của: taoMaSanPhamMoi, luuAnhVaoDrive (nay -> R2), kiemTraVaBoSungSanPhamMoi,
// luuDonHang, taoPhieuGiaoHangPDF, guiEmailThongBao trong Code.gs gốc.
import { getValues, appendValues } from "./sheetsClient.js";
import { renderHtmlToPdfBuffer } from "./pdf.js";
import { sendOrderEmail } from "./email.js";
import { LOGO_VANPHAT_BASE64 } from "../assets/logo.js";

function formatDateVN(d, withTime) {
  // GMT+7, giống Utilities.formatDate(d, "GMT+7", ...) của Apps Script.
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const dd = String(vn.getUTCDate()).padStart(2, "0");
  const mm = String(vn.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = vn.getUTCFullYear();
  if (!withTime) return { dd, mm, yyyy, display: `${dd}/${mm}/${yyyy}` };
  const HH = String(vn.getUTCHours()).padStart(2, "0");
  const MI = String(vn.getUTCMinutes()).padStart(2, "0");
  const SS = String(vn.getUTCSeconds()).padStart(2, "0");
  return {
    dd, mm, yyyy, HH, MI, SS,
    isoLike: `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS}`,
    display: `${dd}/${mm}/${yyyy} ${HH}:${MI}`,
    compact: `${yyyy}${mm}${dd}-${HH}${MI}${SS}`,
  };
}

function taoMaSanPhamMoi(existingCodes) {
  let maxNum = 0;
  existingCodes.forEach((code) => {
    if (typeof code === "string" && code.toUpperCase().startsWith("VP")) {
      const numPart = parseInt(code.replace(/[^0-9]/g, ""), 10);
      if (!isNaN(numPart) && numPart > maxNum) maxNum = numPart;
    }
  });
  return "VP" + (maxNum + 1).toString().padStart(3, "0");
}

/** Lưu ảnh base64 (data:...;base64,...) vào Workers KV (thay R2 — không cần bật gói trả phí),
 *  trả về URL công khai phục vụ qua chính Worker này. Giới hạn KV: mỗi value tối đa 25MB, quá đủ
 *  cho ảnh sản phẩm. */
async function luuAnhVaoKV(env, base64Data, fileName) {
  try {
    if (!base64Data || !base64Data.includes("base64,")) {
      return base64Data || "https://via.placeholder.com/150x150?text=Cho+Cap+Nhat";
    }
    const contentType = base64Data.substring(base64Data.indexOf(":") + 1, base64Data.indexOf(";"));
    const raw = atob(base64Data.split("base64,")[1]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const key = "san-pham/" + Date.now() + "_" + (fileName || "anh.jpg").replace(/[^a-zA-Z0-9._-]/g, "_");
    await env.ASSETS.put(key, bytes, { metadata: { contentType: contentType || "image/jpeg" } });
    return `${env.API_BASE_URL}/assets/${key}`;
  } catch (e) {
    return "https://via.placeholder.com/150x150?text=Loi+Anh";
  }
}

async function kiemTraVaBoSungSanPhamMoi(env, items) {
  const dataVT = await getValues(env, "'Danh Mục Vật Tư'!B2:C");
  const existingNames = new Set((dataVT || []).map((p) => (p[1] || "").toString().trim().toLowerCase()));
  const existingCodes = (dataVT || []).map((p) => (p[0] || "").toString().trim());

  const newRowsVT = [];
  const newRowsStock = [];

  for (const item of items) {
    const cleanName = item.ten.toString().trim();
    if (!item.maSP || item.maSP === "" || item.maSP.includes("Mới") || !existingNames.has(cleanName.toLowerCase())) {
      const newMaSP = taoMaSanPhamMoi(existingCodes);
      existingCodes.push(newMaSP);
      item.maSP = newMaSP;

      let driveImgUrl = item.hinhAnh;
      if (item.hinhAnh && item.hinhAnh.startsWith("data:image")) {
        driveImgUrl = await luuAnhVaoKV(env, item.hinhAnh, newMaSP + "_" + cleanName + ".jpg");
        item.hinhAnh = driveImgUrl;
      }

      newRowsVT.push([item.nhom || "Hàng Đặt Riêng", newMaSP, cleanName, item.dvt || "Cái", 0, driveImgUrl || "https://via.placeholder.com/150x150?text=Cho+Cap+Nhat"]);
      existingNames.add(cleanName.toLowerCase());
    }
  }

  if (newRowsVT.length > 0) {
    await appendValues(env, "'Danh Mục Vật Tư'!A:F", newRowsVT);

    // Xác định hàng bắt đầu thật sự trong "Sổ Kho..." để công thức trỏ đúng dòng (giống bản gốc
    // dùng sheetStock.getLastRow()+1 cho từng dòng mới thêm).
    const stockMeta = await getValues(env, "'Sổ Kho - Nhập Xuất Tồn'!A2:A");
    let nextIdx = (stockMeta ? stockMeta.length : 0) + 1;

    newRowsVT.forEach((r) => {
      const r_idx = nextIdx + 1; // hàng thật trên sheet (có 1 hàng tiêu đề ở trên)
      newRowsStock.push([
        nextIdx,
        r[1], r[2], r[3], r[0],
        0,
        `=SUMIF('Hóa Đơn Đầu Vào'!$G$2:$G$8001, B${r_idx}, 'Hóa Đơn Đầu Vào'!$J$2:$J$8001)`,
        `=SUMIF('Chi Tiết Đơn Hàng'!$B$2:$B$50000, B${r_idx}, 'Chi Tiết Đơn Hàng'!$E$2:$E$50000)`,
        `=F${r_idx}+G${r_idx}-H${r_idx}`,
        `=IF(G${r_idx}=0, IFERROR(VLOOKUP(B${r_idx}, 'Danh Mục Vật Tư'!$B$2:$E$9997, 4, FALSE), 0), SUMIF('Hóa Đơn Đầu Vào'!$G$2:$G$8001, B${r_idx}, 'Hóa Đơn Đầu Vào'!$O$2:$O$8001)/G${r_idx})`,
        `=MAX(0, I${r_idx})*J${r_idx}`,
        5,
        `=IF(I${r_idx}<=0, "🔴 HẾT HÀNG", IF(I${r_idx}<=L${r_idx}, "🟡 CẦN NHẬP THÊM", "🟢 AN TOÀN"))`,
      ]);
      nextIdx++;
    });

    if (newRowsStock.length > 0) {
      await appendValues(env, "'Sổ Kho - Nhập Xuất Tồn'!A:M", newRowsStock);
    }
  }
}

function buildPhieuGiaoHangHtml(data, maDon, ngayHienThiObj, hangCoGia, hangChoBaoGia, tongTien, maDoiTac) {
  const danhSachSP = data.gioHang && data.gioHang.length > 0 ? data.gioHang : hangCoGia.concat(hangChoBaoGia);

  let rowsHTML = "";
  danhSachSP.forEach((sp, idx) => {
    const coGia = Number(sp.giaGoc) > 0;
    const coGiam = coGia && Number(sp.giaBan) < Number(sp.giaGoc);
    const donGiaTxt = coGia
      ? coGiam
        ? `<span style="color:#888; text-decoration:line-through; font-size:11px;">${Number(sp.giaGoc).toLocaleString("vi-VN")}</span><br><b>${Number(sp.giaBan).toLocaleString("vi-VN")}</b>`
        : `${Number(sp.giaBan).toLocaleString("vi-VN")}`
      : `<i style="color:#d9534f;">Chờ báo giá</i>`;
    const thanhTienTxt = coGia ? `${(Number(sp.giaBan) * Number(sp.sl)).toLocaleString("vi-VN")}` : `<i style="color:#d9534f;">-</i>`;

    rowsHTML += `
      <tr>
        <td style="text-align:center; border-bottom: 1px dashed #adb5bd;">${idx + 1}</td>
        <td style="border-bottom: 1px dashed #adb5bd;">${sp.nhom || ""}</td>
        <td style="border-bottom: 1px dashed #adb5bd;">${sp.ten}</td>
        <td style="text-align:center; border-bottom: 1px dashed #adb5bd;">${sp.dvt}</td>
        <td style="text-align:center; border-bottom: 1px dashed #adb5bd; font-weight:bold;">${sp.sl}</td>
        <td style="text-align:right; border-bottom: 1px dashed #adb5bd;">${donGiaTxt}</td>
        <td style="text-align:right; border-bottom: 1px dashed #adb5bd; font-weight:bold;">${thanhTienTxt}</td>
      </tr>
    `;
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'DejaVu Sans', Arial, sans-serif; padding: 30px; color: #222; font-size: 13px; }
        .title { text-align: center; color: #1F4E78; margin: 8px 0 2px 0; text-transform: uppercase; letter-spacing: 1px; }
        .subtitle { text-align: center; font-style: italic; margin-bottom: 18px; text-decoration: underline; }
        table.main-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        table.main-table th { background-color: #1F4E78; color: #fff; padding: 8px 6px; font-size: 12.5px; }
        table.main-table td { padding: 7px 6px; font-size: 12.5px; }
        .footer-signs { width: 100%; margin-top: 45px; text-align: center; font-size: 13px; }
      </style>
    </head>
    <body>
      <table style="width: 100%; margin-bottom: 4px;">
        <tr>
          <td style="width: 90px; vertical-align: top;">
            <img src="data:image/png;base64,${LOGO_VANPHAT_BASE64}" style="width: 80px; height: auto;">
          </td>
          <td style="vertical-align: top; text-align: right;">
            <b style="font-size: 14px;">CÔNG TY TNHH TƯ VẤN ĐẦU TƯ THƯƠNG MẠI VẠN PHÁT</b><br>
            <span style="font-style: italic; font-size: 12px;">Địa chỉ: LK 19-06 Đường số 20 KĐT Mỹ Gia</span><br>
            <span style="font-style: italic; font-size: 12px;">Điện Thoại: 033 5652 832</span>
          </td>
        </tr>
      </table>

      <h2 class="title">Phiếu Giao Hàng</h2>
      <div class="subtitle">Ngày ${ngayHienThiObj.dd} tháng ${ngayHienThiObj.mm} năm ${ngayHienThiObj.yyyy}</div>

      <div style="margin-bottom: 14px; font-size: 13.5px;">
        <div><b>Khách hàng:</b> <span style="color:#c0392b; font-weight:bold;">${data.khachHang}</span></div>
        ${data.diaChi ? `<div style="font-style: italic; margin-left: 14px;">(${data.diaChi})</div>` : ""}
        <div style="margin-top:4px;"><b>Điện thoại:</b> ${data.sdt ? data.sdt : '<span style="display:inline-block; width: 320px; border-bottom: 1px dotted #999;">&nbsp;</span>'}</div>
        ${data.ghiChu ? `<div style="margin-top:4px;"><b>Ghi chú:</b> ${data.ghiChu}</div>` : ""}
        ${maDoiTac ? `<div style="margin-top:4px; font-size:12px; color:#555;"><i>Áp dụng mã ưu đãi: <b>${maDoiTac}</b></i></div>` : ""}
      </div>

      <table class="main-table" border="1" cellpadding="6" cellspacing="0" style="border-color:#1F4E78;">
        <thead>
          <tr>
            <th style="width: 34px;">STT</th>
            <th style="width: 110px;">Nhóm Hàng</th>
            <th>Tên Sản Phẩm</th>
            <th style="width: 55px;">ĐVT</th>
            <th style="width: 55px;">Số Lượng</th>
            <th style="width: 90px;">Đơn Giá</th>
            <th style="width: 100px;">Thành Tiền</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML}
          <tr>
            <td colspan="6" style="background-color:#1F4E78; color:#fff; text-align:right; font-weight:bold; font-size: 13.5px;">TỔNG CỘNG</td>
            <td style="background-color:#1F4E78; color:#fff; text-align:right; font-weight:bold; font-size: 13.5px;">${tongTien.toLocaleString("vi-VN")}</td>
          </tr>
        </tbody>
      </table>

      <table class="footer-signs">
        <tr>
          <td style="width: 33%;"><b>Người nhận</b><br><br><br><br></td>
          <td style="width: 33%;"><b>Người giao</b><br><br><br><br></td>
          <td style="width: 33%;"><b>Thủ kho</b><br><br><br><br></td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

async function taoPhieuGiaoHangPDF(env, data, maDon, ngayHienThiObj, hangCoGia, hangChoBaoGia, tongTien, maDoiTac) {
  const html = buildPhieuGiaoHangHtml(data, maDon, ngayHienThiObj, hangCoGia, hangChoBaoGia, tongTien, maDoiTac);
  const pdfBuffer = await renderHtmlToPdfBuffer(env, html);

  const safeName = data.khachHang.replace(/[^a-zA-Z0-9]/g, "_");
  const key = `phieu-giao-hang/${maDon}_${safeName}.pdf`;
  await env.ASSETS.put(key, pdfBuffer, { metadata: { contentType: "application/pdf" } });

  return { url: `${env.API_BASE_URL}/assets/${key}`, buffer: pdfBuffer, fileName: `${maDon}_${safeName}.pdf` };
}

function buildEmailHtml(data, maDon, ngayHienThi, hangCoGia, hangChoBaoGia, tongTien, maDoiTac, pdfUrl) {
  let bodyHTML = `
    <div style="max-width: 850px; margin: auto; font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <div style="background-color: #1F4E78; color: white; padding: 15px 20px; border-radius: 6px 6px 0 0;">
        <h3 style="margin: 0;">HỆ THỐNG XÁC NHẬN ĐƠN HÀNG VẠN PHÁT PRO</h3>
      </div>
      <div style="border: 1px solid #1F4E78; border-top: none; padding: 20px; border-radius: 0 0 6px 6px;">
        <p>Kính gửi <b>${data.khachHang}</b> và <b>Bộ phận Kho Vạn Phát</b>,</p>
        <p>Hệ thống vừa ghi nhận đơn hàng mới với thông tin chi tiết như sau:</p>
        <ul style="background-color: #f8f9fa; padding: 15px 30px; border-radius: 5px; list-style-type: square;">
          <li><b>Mã đơn hàng:</b> <span style="color: #1F4E78; font-weight: bold; font-size: 15px;">${maDon}</span></li>
          <li><b>Thời gian đặt:</b> ${ngayHienThi}</li>
          <li><b>Số điện thoại liên hệ:</b> <span style="color: #28a745; font-weight: bold;">${data.sdt}</span></li>
          <li><b>Địa chỉ nhận hàng:</b> ${data.diaChi || "Nhận tại địa chỉ khách hàng"}</li>
          ${data.ghiChu ? `<li><b>Ghi chú đơn:</b> ${data.ghiChu}</li>` : ""}
          ${maDoiTac ? `<li><b>Chính sách ưu đãi:</b> <span style="color: #0d6efd; font-weight: bold;">Mã ${maDoiTac}</span></li>` : ""}
        </ul>
  `;

  if (hangCoGia.length > 0) {
    bodyHTML += `
      <h4 style="color: #1F4E78; margin-top: 20px;">DANH MỤC HÀNG HÓA TIÊU CHUẨN:</h4>
      <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; text-align: center; font-size: 13px;">
        <tr style="background-color: #1F4E78; color: white;">
          <th>Mã SP</th><th>Tên Sản Phẩm / Quy Cách</th><th>ĐVT</th><th>SL</th><th>Đơn Giá Gốc</th><th>Đơn Giá Bán</th><th>Thành Tiền</th>
        </tr>
    `;
    hangCoGia.forEach((i) => {
      bodyHTML += `
        <tr>
          <td><b>${i.maSP || "-"}</b></td>
          <td style="text-align: left;">${i.ten}</td>
          <td>${i.dvt}</td>
          <td><b>${i.sl}</b></td>
          <td style="text-align: right; color: #888;">${Number(i.giaGoc).toLocaleString("vi-VN")}đ</td>
          <td style="text-align: right; font-weight: bold; color: #1F4E78;">${Number(i.giaBan).toLocaleString("vi-VN")}đ</td>
          <td style="text-align: right; font-weight: bold; color: #d9534f;">${(Number(i.giaBan) * Number(i.sl)).toLocaleString("vi-VN")}đ</td>
        </tr>
      `;
    });
    bodyHTML += `
        <tr style="background-color: #f8f9fa;">
          <td colspan="6" style="text-align: right; font-weight: bold; font-size: 14px;">TỔNG TIỀN THANH TOÁN:</td>
          <td style="text-align: right; font-weight: bold; color: red; font-size: 15px;">${tongTien.toLocaleString("vi-VN")}đ</td>
        </tr>
      </table>
    `;
  }

  if (hangChoBaoGia.length > 0) {
    bodyHTML += `
      <h4 style="color: #d9534f; margin-top: 20px;">MẶT HÀNG ĐẶT RIÊNG / CHỜ BÁO GIÁ:</h4>
      <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; text-align: center; font-size: 13px;">
        <tr style="background-color: #6c757d; color: white;">
          <th>Mã SP</th><th>Tên Mặt Hàng</th><th>ĐVT</th><th>SL</th><th>Tình Trạng</th>
        </tr>
    `;
    hangChoBaoGia.forEach((i) => {
      bodyHTML += `
        <tr>
          <td><b>${i.maSP || "-"}</b></td>
          <td style="text-align: left;">${i.ten}</td>
          <td>${i.dvt}</td>
          <td><b>${i.sl}</b></td>
          <td style="color: #d9534f; font-style: italic;">Vạn Phát sẽ liên hệ báo giá sỉ tốt nhất</td>
        </tr>
      `;
    });
    bodyHTML += `</table>`;
  }

  bodyHTML += `
        <div style="margin-top: 25px; text-align: center;">
          <a href="${pdfUrl}" target="_blank" style="background-color: #1F4E78; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
            📄 XEM HOẶC TẢI VỀ PHIẾU GIAO HÀNG (PDF)
          </a>
        </div>
      </div>
    </div>
  `;
  return bodyHTML;
}

async function guiEmailThongBao(env, data, maDon, ngayHienThi, hangCoGia, hangChoBaoGia, tongTien, maDoiTac, pdfUrl, pdfBuffer, pdfFileName) {
  let emailTo = [env.EMAIL_KHO];
  if (data.emailKhach && data.emailKhach.includes("@")) emailTo.push(data.emailKhach);

  const subject = `[VẠN PHÁT] Đơn Hàng Mới - ${maDon} - ${data.khachHang}`;
  const html = buildEmailHtml(data, maDon, ngayHienThi, hangCoGia, hangChoBaoGia, tongTien, maDoiTac, pdfUrl);

  await sendOrderEmail(env, { to: emailTo, subject, html, attachmentPdfBuffer: pdfBuffer, attachmentFileName: pdfFileName });
}

export async function luuDonHang(env, data) {
  if (!data.khachHang || !data.sdt || !data.gioHang || data.gioHang.length === 0) {
    throw new Error("Thông tin đơn hàng chưa đầy đủ (Thiếu Tên, SĐT hoặc giỏ hàng trống).");
  }

  // LƯU Ý: bản Apps Script gốc dùng LockService.getScriptLock() để khoá trong lúc lưu đơn.
  // Ở đây mỗi lượt appendValues() vào Google Sheets đã atomic per-call (Sheets API tự tìm đúng
  // hàng trống kế tiếp), nên rủi ro tranh chấp ghi khi 2 đơn chốt cùng lúc là rất thấp với quy mô
  // hiện tại. Nếu về sau lưu lượng đơn tăng cao, có thể bổ sung khoá bằng Durable Object.

  await kiemTraVaBoSungSanPhamMoi(env, data.gioHang);

  const now = new Date();
  const maDon = "PX-" + formatDateVN(now, true).compact;
  const ngayLap = formatDateVN(now, true).isoLike;
  const ngayHienThiObj = formatDateVN(now, true);
  const ngayHienThi = ngayHienThiObj.display;

  const hangCoGia = data.gioHang.filter((item) => Number(item.giaGoc) > 0);
  const hangChoBaoGia = data.gioHang.filter((item) => Number(item.giaGoc) === 0);
  const tongTien = hangCoGia.reduce((sum, item) => sum + Number(item.giaBan) * Number(item.sl), 0);

  const maDoiTac = data.maDoiTac || "";
  let thongTinKhach = data.khachHang + " (SĐT: " + data.sdt + ")";
  if (data.emailKhach) thongTinKhach += " - Email: " + data.emailKhach;
  if (data.diaChi) thongTinKhach += " - Đ/C: " + data.diaChi;
  if (maDoiTac) thongTinKhach += " [Mã CK: " + maDoiTac + "]";

  const { url: pdfUrl, buffer: pdfBuffer, fileName: pdfFileName } = await taoPhieuGiaoHangPDF(env, data, maDon, ngayHienThiObj, hangCoGia, hangChoBaoGia, tongTien, maDoiTac);

  // "Lịch Sử Xuất Kho": STT sẽ do người xem tự đối chiếu hàng, giữ nguyên format cột B..H như bản gốc.
  const masterMeta = await getValues(env, "'Lịch Sử Xuất Kho'!A2:A");
  const sttMoi = (masterMeta ? masterMeta.length : 0) + 1;
  await appendValues(env, "'Lịch Sử Xuất Kho'!A:H", [[sttMoi, maDon, ngayLap, thongTinKhach, data.gioHang.length, tongTien, "Chờ duyệt", pdfUrl]]);

  const detailMeta = await getValues(env, "'Chi Tiết Đơn Hàng'!A2:A");
  let startRowDetail = (detailMeta ? detailMeta.length : 0) + 2; // +1 header, +1 vì hàng kế tiếp

  const chiTietArray = data.gioHang.map((item, idx) => {
    const r = startRowDetail + idx;
    const isCoGia = Number(item.giaGoc) > 0;
    return [
      maDon,
      item.maSP || "-",
      item.ten,
      item.dvt,
      item.sl,
      item.giaGoc || 0,
      item.giaBan || 0,
      isCoGia ? Number(item.giaBan) * Number(item.sl) : 0,
      `=IFERROR(VLOOKUP(B${r}, 'Sổ Kho - Nhập Xuất Tồn'!$B$2:$J$9997, 9, FALSE), 0)`,
      `=E${r}*I${r}`,
      `=H${r}-J${r}`,
      `=IF(H${r}=0, 0, K${r}/H${r})`,
    ];
  });
  await appendValues(env, "'Chi Tiết Đơn Hàng'!A:L", chiTietArray);

  await guiEmailThongBao(env, data, maDon, ngayHienThi, hangCoGia, hangChoBaoGia, tongTien, maDoiTac, pdfUrl, pdfBuffer, pdfFileName);

  return { status: "success", maDon, pdfUrl };
}
