// Port của layToanBoDanhMucVaNhom() + _ganNhanBanChayVaGiaTot_() trong Code.gs gốc.
import { getValues, batchGetValues } from "./sheetsClient.js";

async function ganNhanBanChayVaGiaTot(env, sanPhamList) {
  if (!sanPhamList || !sanPhamList.length) return;

  const soLuongBanTheoMa = {};
  try {
    const dataCT = await getValues(env, "'Chi Tiết Đơn Hàng'!B2:E");
    dataCT.forEach((r) => {
      const ma = (r[0] || "").toString().trim().toUpperCase();
      const sl = Number(r[3]) || 0;
      if (ma && sl > 0) soLuongBanTheoMa[ma] = (soLuongBanTheoMa[ma] || 0) + sl;
    });
  } catch (e) {
    console.warn("Lỗi tổng hợp số liệu bán chạy: " + e.toString());
  }

  const dsSoLuong = Object.values(soLuongBanTheoMa).sort((a, b) => b - a);
  let nguongBanChay = Infinity;
  if (dsSoLuong.length) {
    const viTri = Math.max(0, Math.ceil(dsSoLuong.length * 0.2) - 1);
    nguongBanChay = Math.max(dsSoLuong[viTri], 5);
  }

  const tongGiaTheoNhom = {},
    demTheoNhom = {};
  sanPhamList.forEach((sp) => {
    if (sp.gia > 0) {
      tongGiaTheoNhom[sp.nhom] = (tongGiaTheoNhom[sp.nhom] || 0) + sp.gia;
      demTheoNhom[sp.nhom] = (demTheoNhom[sp.nhom] || 0) + 1;
    }
  });
  const giaTBTheoNhom = {};
  Object.keys(tongGiaTheoNhom).forEach((nhom) => {
    giaTBTheoNhom[nhom] = tongGiaTheoNhom[nhom] / demTheoNhom[nhom];
  });

  sanPhamList.forEach((sp) => {
    const maChuan = (sp.maSP || "").toString().trim().toUpperCase();
    const soLuongBan = soLuongBanTheoMa[maChuan] || 0;
    const laBanChay = soLuongBan >= nguongBanChay;

    const giaTB = giaTBTheoNhom[sp.nhom];
    const laGiaTot = sp.gia > 0 && giaTB && (demTheoNhom[sp.nhom] || 0) >= 3 && sp.gia <= giaTB * 0.95;

    if (laBanChay) sp.nhan = "ban_chay";
    else if (laGiaTot) sp.nhan = "gia_tot";
  });
}

export async function layToanBoDanhMucVaNhom(env) {
  let nhomList = [];
  let sanPhamList = [];

  try {
    const [dataNhom, dataVT] = await batchGetValues(env, ["'Quản Lý Nhóm'!B2:B", "'Danh Mục Vật Tư'!A2:F"]);

    nhomList = (dataNhom || []).map((r) => (r[0] ? r[0].toString().trim() : "")).filter(String);

    (dataVT || []).forEach((r) => {
      const nhom = r[0] ? r[0].toString().trim() : "Khác";
      if (nhom && !nhomList.includes(nhom)) nhomList.push(nhom);
      if (r[2]) {
        sanPhamList.push({
          nhom: nhom,
          maSP: r[1] ? r[1].toString().trim() : "",
          ten: r[2] ? r[2].toString().trim() : "",
          dvt: r[3] ? r[3].toString().trim() : "Cái",
          gia: Number(r[4]) || 0,
          hinhAnh: r[5] ? r[5].toString().trim() : "https://via.placeholder.com/150x150?text=Chua+Co+Anh",
        });
      }
    });
  } catch (e) {
    console.warn("Lỗi đọc danh mục: " + e.toString());
  }

  await ganNhanBanChayVaGiaTot(env, sanPhamList);

  return { nhomList, sanPhamList };
}
