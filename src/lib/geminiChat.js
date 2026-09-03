// ================================================================
// TƯ VẤN AI + ĐIỀU PHỐI HÀNH ĐỘNG — PORT NGUYÊN VẸN TỪ Code.gs GỐC
// (layDanhSachApiKeyDangHoatDong, xaoTronMangKey_, goiSongSong2Module,
//  chuyenDoiThamSoActionAnToan, xuLyChatBoxAI)
// Toàn bộ nghiệp vụ/prompt/quy tắc GIỮ NGUYÊN 100% so với bản Apps Script —
// chỉ thay cơ chế đọc Sheet (SpreadsheetApp -> Sheets API) và gọi mạng
// (UrlFetchApp.fetchAll -> Promise.all + fetch).
// ================================================================

import { getValues } from "./sheetsClient.js";

const TEN_SHEET_CAU_HINH_API = "Cấu Hình API Gemini";
const CACHE_KEY_DS_API_GEMINI = "DS_API_KEY_GEMINI_V1";
const THOI_GIAN_CACHE_KEY_GIAY = 300; // 5 phút — giống bản gốc

const MODULE_1_SALES_MODEL = "gemini-3.1-flash-lite";
const MODULE_2_DATA_MODEL = "gemini-3.7-flash";
const MODELS_PRIORITY = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

export { MODULE_1_SALES_MODEL, MODULE_2_DATA_MODEL };

async function layDanhSachApiKeyDangHoatDong(env) {
  if (env.CACHE) {
    const cached = await env.CACHE.get(CACHE_KEY_DS_API_GEMINI);
    if (cached) {
      try {
        const ds = JSON.parse(cached);
        if (ds && ds.length > 0) return ds;
      } catch (e) {
        /* rơi xuống đọc lại từ sheet */
      }
    }
  }

  const data = await getValues(env, `'${TEN_SHEET_CAU_HINH_API}'!A2:D`);
  if (!data || data.length === 0) {
    throw new Error(`Chưa có sheet "${TEN_SHEET_CAU_HINH_API}" hoặc sheet đang trống. Vào Google Sheet tạo sheet này và dán khoá API Gemini vào trước.`);
  }

  const dsKey = data
    .filter((r) => r[2] && r[3] && r[3].toString().trim().toLowerCase() === "hoạt động")
    .map((r) => ({ ten: (r[1] || "Không tên").toString().trim(), key: r[2].toString().trim() }));

  if (dsKey.length === 0) {
    throw new Error(`Không có khoá API nào ở trạng thái "Hoạt động" trong sheet "${TEN_SHEET_CAU_HINH_API}". Vào sheet kiểm tra lại cột Trạng Thái.`);
  }

  if (env.CACHE) {
    await env.CACHE.put(CACHE_KEY_DS_API_GEMINI, JSON.stringify(dsKey), { expirationTtl: THOI_GIAN_CACHE_KEY_GIAY });
  }
  return dsKey;
}

function xaoTronMangKey_(mang) {
  const arr = mang.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

async function fetchJsonSafe(url, payload) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
  } catch (e) {
    return { ok: false, status: 0, json: null };
  }
}

async function goiSongSong2Module(env, promptSales, promptData, contentsSales, contentsData) {
  const dsKeyGoc = await layDanhSachApiKeyDangHoatDong(env);
  const dsKey = xaoTronMangKey_(dsKeyGoc);

  const keySales = dsKey[0].key;
  const keyData = dsKey.length > 1 ? dsKey[1].key : dsKey[0].key;

  const urlSales = `https://generativelanguage.googleapis.com/v1beta/models/${MODULE_1_SALES_MODEL}:generateContent?key=${keySales}`;
  const urlData = `https://generativelanguage.googleapis.com/v1beta/models/${MODULE_2_DATA_MODEL}:generateContent?key=${keyData}`;

  const payloadSales = {
    contents: contentsSales,
    systemInstruction: { parts: [{ text: promptSales }] },
    tools: [{ google_search: {} }],
  };
  const payloadData = {
    contents: contentsData,
    systemInstruction: { parts: [{ text: promptData }] },
    generationConfig: { responseMimeType: "application/json" },
  };

  const [respSales, respData] = await Promise.all([
    fetchJsonSafe(urlSales, payloadSales),
    fetchJsonSafe(urlData, payloadData),
  ]);

  let salesText = "";
  let dataJson = { tenKhach: "", sdt: "", diaChi: "", isYeuCauChotDon: false, actions: [] };

  if (respSales.ok && respSales.json) {
    try {
      salesText = (respSales.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    } catch (e) {}
  }
  if (respData.ok && respData.json) {
    try {
      const rawJsonText = (respData.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") || "{}";
      dataJson = JSON.parse(rawJsonText);
    } catch (e) {}
  }

  // DỰ PHÒNG: nếu request chính gặp sự cố — thử lần lượt từng khoá x từng model dự phòng.
  if (!salesText) {
    outerLoop: for (const fallbackModel of MODELS_PRIORITY) {
      for (const k of dsKey) {
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${k.key}`;
        const r = await fetchJsonSafe(fallbackUrl, {
          contents: contentsSales,
          systemInstruction: { parts: [{ text: promptSales }] },
          tools: [{ google_search: {} }],
        });
        if (r.ok && r.json) {
          try {
            salesText = (r.json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
            if (salesText) break outerLoop;
          } catch (e) {}
        }
      }
    }
  }

  return { salesText, dataJson };
}

function chuyenDoiThamSoActionAnToan(loaiAction, chuoiTho) {
  if (!chuoiTho) return {};
  const s = chuoiTho.toString().trim();
  if (s.charAt(0) === "{") {
    try {
      return JSON.parse(s);
    } catch (e) {
      /* rơi xuống fallback bên dưới */
    }
  }
  const phan = s
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  if (loaiAction === "ADD_CUSTOM_CART") {
    const ketQua = { ten: phan[0] || "" };
    if (phan[1] && /^\d+$/.test(phan[1])) ketQua.sl = parseInt(phan[1], 10);
    if (phan[2] && phan[2] !== "0") ketQua.giaThamKhao = phan[2];
    return ketQua;
  }
  if (loaiAction === "ADD_CART") {
    const ketQua = { maSP: phan[0] || "" };
    if (phan[1] && /^\d+$/.test(phan[1])) ketQua.sl = parseInt(phan[1], 10);
    return ketQua;
  }
  return {};
}

export async function xuLyChatBoxAI(env, tinNhanKhach, lichSuHoiThoai, gioHangHienTai, thongTinKhachForm, laVaiTroBoSung) {
  try {
    if (!tinNhanKhach || tinNhanKhach.trim() === "") {
      return {
        success: false,
        reply: "Dạ kính thưa Quý khách, em chưa nhận được nội dung tin nhắn. Quý khách vui lòng gửi lại để em kịp thời hỗ trợ chu đáo nhất ạ.",
      };
    }

    const cleanInput = tinNhanKhach
      .toLowerCase()
      .replace(/đ/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,!?;:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    let thongTinGioHangText = "Giỏ hàng hiện đang trống.";
    let tongSLGio = 0;
    let tongTienGio = 0;
    if (gioHangHienTai && Array.isArray(gioHangHienTai) && gioHangHienTai.length > 0) {
      tongSLGio = gioHangHienTai.reduce((sum, item) => sum + (Number(item.sl) || 0), 0);
      tongTienGio = gioHangHienTai.reduce((sum, item) => sum + (Number(item.thanhTien) || Number(item.giaBan) * Number(item.sl) || 0), 0);

      thongTinGioHangText = `Khách hàng hiện có ${gioHangHienTai.length} mặt hàng trong giỏ (${tongSLGio} món). Tổng giá trị niêm yết: ${tongTienGio.toLocaleString("vi-VN")}đ.\nChi tiết giỏ hàng:\n`;
      gioHangHienTai.forEach((item, idx) => {
        thongTinGioHangText += `${idx + 1}. [${item.maSP || "Mới"}] ${item.ten} - SL: ${item.sl} ${item.dvt} - Đơn giá: ${Number(item.giaBan).toLocaleString("vi-VN")}đ\n`;
      });
    }

    let tenKhachForm = thongTinKhachForm && thongTinKhachForm.khachHang ? thongTinKhachForm.khachHang.trim() : "";
    let sdtForm = thongTinKhachForm && thongTinKhachForm.sdt ? thongTinKhachForm.sdt.trim() : "";
    let diaChiForm = thongTinKhachForm && thongTinKhachForm.diaChi ? thongTinKhachForm.diaChi.trim() : "";

    let toanBoKhoText = "";
    let matchedListFallback = [];
    const dataVT = await getValues(env, "'Danh Mục Vật Tư'!A2:F");
    if (dataVT && dataVT.length > 0) {
      let khoItems = [];
      dataVT.forEach((r) => {
        if (r[2]) {
          const tenSP = r[2].toString().trim();
          const maSP = (r[1] || "VP").toString().trim();
          const dvt = (r[3] || "Cái").toString().trim();
          const gia = Number(r[4] || 0);
          const nhom = (r[0] || "VPP").toString().trim();

          khoItems.push(`- [${maSP}] ${tenSP} | ĐVT: ${dvt} | Giá: ${gia.toLocaleString("vi-VN")}đ | Nhóm: ${nhom}`);

          const tenClean = tenSP
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
          const maClean = maSP.toLowerCase();

          if (cleanInput.length >= 2 && (tenClean.includes(cleanInput) || maClean.includes(cleanInput))) {
            matchedListFallback.push({ ma: maSP, ten: tenSP, dvt: dvt, gia: gia, nhom: nhom });
          }
        }
      });
      toanBoKhoText = khoItems.join("\n");
    }

    const promptBackend = `Bạn là Trí tuệ Phân tích Dữ liệu Back-end của Vạn Phát.
Phân tích tin nhắn và trích xuất JSON:
{
  "tenKhach": "Tên khách nếu có",
  "sdt": "SĐT 10 số nếu có",
  "diaChi": "Địa chỉ nhận hàng nếu có",
  "isYeuCauChotDon": true/false,
  "actions": [
    {"type": "ADD_CART", "params": {"maSP": "...", "sl": 1}},
    {"type": "ADD_CUSTOM_CART", "params": {"ten": "Tên mặt hàng đặt riêng", "sl": 1, "dvt": "Cái", "nhom": "Tên nhóm hàng phù hợp hoặc để trống", "giaThamKhao": "Giá tham khảo dạng chữ nếu có, để trống nếu chưa rõ"}}
  ]
}
QUY TẮC BẮT BUỘC:
1. Chỉ đưa "sl" (số lượng) vào action khi khách đã nói RÕ RÀNG con số cụ thể trong tin nhắn. Nếu khách chỉ nhắc tên sản phẩm mà KHÔNG nói số lượng, TUYỆT ĐỐI không tự bịa số lượng (không mặc định là 1, không lấy số lượng của sản phẩm khác trong hội thoại gán sang) — trong trường hợp đó bỏ hẳn action ADD_CART/ADD_CUSTOM_CART cho sản phẩm đó ra khỏi mảng actions, để Module tư vấn hỏi lại số lượng trước.
2. Bất kỳ mặt hàng nào khách đã xác nhận muốn LẤY/MUA/ĐẶT (dùng từ như "lấy", "mua", "đặt", "chốt", "cho anh/chị ... cái/cây/hộp..." hay cách diễn đạt tương đương thể hiện rõ ý định mua) kèm SỐ LƯỢNG rõ ràng, nhưng KHÔNG có trong "DANH SÁCH SẢN PHẨM TRONG KHO" (hàng đặt riêng/ngoài danh mục), PHẢI luôn phát hành action "ADD_CUSTOM_CART" tương ứng trong mảng actions này — đây là kênh dữ liệu chính thức, chính xác nhất để ghi nhận hành động, không được bỏ sót chỉ vì đã nhắc trong câu trả lời văn bản. QUAN TRỌNG: mặt hàng CHƯA CÓ GIÁ niêm yết (giaThamKhao để trống) KHÔNG PHẢI lý do để bỏ qua action này — chỉ cần khách đã xác nhận rõ số lượng là phải ghi nhận vào giỏ hàng ngay, phần giá sẽ được Vạn Phát cập nhật bổ sung sau.
3. Vạn Phát CHỈ kinh doanh Văn phòng phẩm (VPP), vật tư/thiết bị/tiện ích văn phòng và các món trang trí văn phòng nhỏ liên quan. TUYỆT ĐỐI không phát hành action ADD_CART/ADD_CUSTOM_CART cho bất kỳ mặt hàng nào KHÔNG thuộc phạm vi này (ví dụ: máy lạnh, tủ đông, máy quạt, chăn ra nệm, đồ gia dụng, đồ điện lạnh, nội thất lớn, thực phẩm... và các chủng loại khác tương tự) — dù khách có nói "chốt mua" mặt hàng đó, vẫn phải bỏ hẳn khỏi mảng actions.
4. Các câu thoại mang tính XÁC NHẬN/RA LỆNH đặt hàng nói chung — ví dụ: "ok chốt", "chốt", "chốt đơn", "chốt giúp em", "ừm mua", "đặt hàng", "mua luôn", "gửi đơn", "xác nhận", "đồng ý", "gửi kho" và các biến thể tương đương — LÀ HÀNH ĐỘNG xác nhận đặt hàng, TUYỆT ĐỐI KHÔNG được hiểu nhầm là TÊN một sản phẩm cụ thể. Không được đặt "ten" trong ADD_CUSTOM_CART bằng các cụm từ xác nhận này. Chỉ trích xuất "ten" khi tin nhắn nêu rõ TÊN một mặt hàng thực tế (ví dụ: "thước dẻo 20cm", "kẹp bướm 25mm"). Nếu tin nhắn chỉ là lời xác nhận chốt đơn (không kèm tên sản phẩm mới), đặt "isYeuCauChotDon": true và để mảng actions trống (trừ khi có thông tin khách/địa chỉ mới cần trích xuất).`;

    const promptFrontend = `BẠN LÀ: "Chuyên viên Tư vấn Giải pháp Vật tư Doanh nghiệp Vạn Phát" - Công ty TNHH Tư Vấn Đầu Tư Thương Mại Vạn Phát (Hotline: 033 5652 832 | Trụ sở: LK 19-06 Đường số 20 KĐT Mỹ Gia, Vĩnh Thái, Nha Trang).
Xưng "Em", gọi "Quý khách" hoặc "Anh/Chị". Đĩnh đạc, ấm áp, văn minh, sắc bén. Báo đúng giá niêm yết của kho, nếu chưa có trong kho thì tư vấn quy cách và báo giá tham khảo.
Bạn ĐƯỢC TRANG BỊ công cụ tìm kiếm Google (Google Search) — hãy chủ động dùng công cụ này khi cần.

NGUYÊN TẮC BẮT BUỘC VỀ GIÁ & SỐ LƯỢNG (tuyệt đối không vi phạm, đây là quy định nghiệp vụ, không phải gợi ý):
1. Sản phẩm ĐÃ có trong "DANH SÁCH SẢN PHẨM TRONG KHO" bên dưới: báo đúng giá niêm yết, không tự làm tròn hay tự đổi giá.
2. Sản phẩm KHÔNG có trong danh sách kho, hoặc có giá = 0: TUYỆT ĐỐI không tự bịa ra một con số giá cụ thể rồi trình bày như giá chính thức/đã chốt/"tạm tính". Với mặt hàng loại này chỉ được nói đây là hàng đặt riêng/chưa có giá niêm yết, Vạn Phát sẽ khảo sát và liên hệ báo giá sỉ tốt nhất cho Quý khách — không nêu bất kỳ con số cụ thể nào, không cộng nó vào tổng tiền đơn hàng như hàng đã chốt giá. LƯU Ý QUAN TRỌNG (không được vi phạm): việc CHƯA CÓ GIÁ cụ thể KHÔNG đồng nghĩa với việc CHƯA ghi nhận đơn hàng — hễ khách đã xác nhận rõ số lượng muốn lấy/mua/đặt, mặt hàng đó VẪN PHẢI được thêm vào giỏ hàng ngay (ở trạng thái "đặt riêng, đang chờ báo giá" qua action ADD_CUSTOM_CART), chỉ riêng con số giá là chưa nêu cụ thể. TUYỆT ĐỐI KHÔNG được trả lời kiểu "em chưa ghi nhận/chưa thêm vào giỏ hàng cho đến khi có giá cụ thể" — câu nói đó sai quy trình nghiệp vụ và gây hiểu lầm cho khách; hãy xác nhận rõ với khách là mặt hàng ĐÃ được thêm vào giỏ ở dạng đặt riêng, giá sẽ cập nhật bổ sung sau.
3. TUYỆT ĐỐI không tự ý gán số lượng khi khách chưa nói rõ. Nếu khách chỉ nhắc tên sản phẩm mà chưa cho biết cần bao nhiêu, PHẢI hỏi lại số lượng cụ thể trước khi coi như đã chốt — không được suy đoán, không tự đặt mặc định 1, không lấy số lượng của mặt hàng khác trong hội thoại gán sang mặt hàng này.
4. Khi phát hành [ACTION:ADD_CART...] hoặc [ACTION:ADD_CUSTOM_CART...] ngay trong câu trả lời, PHẢI viết đúng định dạng JSON hợp lệ (dùng dấu ngoặc nhọn {}, tên trường trong dấu ngoặc kép "", ví dụ đúng: [ACTION:ADD_CUSTOM_CART:{"ten":"Thước dẻo 20cm","sl":10,"dvt":"Cây"}]) — số lượng "sl" phải khớp đúng số khách đã xác nhận, nếu khách chưa xác nhận số lượng thì KHÔNG phát hành action đó, chỉ hỏi lại. Việc mặt hàng CHƯA có giá KHÔNG phải lý do để bỏ action này (xem lưu ý ở quy tắc số 2). Đây chỉ là kênh ghi nhận phụ trong câu trả lời; Module phân tích dữ liệu phía sau (mảng actions) mới là kênh chính thức, PHẢI đảm bảo hành động cũng được phản ánh đúng ở đó.
5. Vạn Phát CHỈ kinh doanh Văn phòng phẩm (VPP) và các mặt hàng liên quan trực tiếp: vật tư/thiết bị văn phòng, tiện ích văn phòng, đồ trang trí nhỏ gọn cho không gian văn phòng. Khi khách hỏi mua hoặc yêu cầu chốt các mặt hàng KHÔNG thuộc phạm vi này (ví dụ: máy lạnh, tủ đông, máy quạt, chăn ra nệm, đồ gia dụng, điện lạnh, nội thất lớn, thực phẩm... và các chủng loại tương tự), PHẢI từ chối khéo léo, giải thích rõ đây không thuộc lĩnh vực kinh doanh của Vạn Phát, TUYỆT ĐỐI không xác nhận đã chốt, KHÔNG phát hành [ACTION:ADD_CART...] hay [ACTION:ADD_CUSTOM_CART...] cho mặt hàng đó — có thể lịch sự gợi ý khách tìm đơn vị chuyên ngành phù hợp.
6. Khi khách hỏi/nhắc tới một mặt hàng THUỘC phạm vi VPP (theo đúng nguyên tắc số 5) nhưng KHÔNG có trong "DANH SÁCH SẢN PHẨM TRONG KHO" bên dưới: PHẢI chủ động dùng công cụ Google Search để tra cứu thông số kỹ thuật, quy cách, chất liệu, xuất xứ, thương hiệu phổ biến... của mặt hàng đó trên internet, rồi dùng thông tin tra cứu được để tư vấn cụ thể, chuyên nghiệp cho khách (không nói chung chung "em sẽ khảo sát" mà không có thông tin gì), đồng thời khéo léo dẫn dắt khách đồng ý đặt mua qua Vạn Phát. Lưu ý khi tư vấn bằng thông tin tra cứu được:
   a) Chỉ trình bày thông số/mô tả/xuất xứ — TUYỆT ĐỐI không tự suy ra hay báo một mức giá cụ thể từ kết quả tìm kiếm (giá trên mạng có thể không phải giá sỉ Vạn Phát áp dụng); vẫn phải tuân thủ đúng nguyên tắc số 2 ở trên về giá.
   b) Nếu tìm kiếm không ra thông tin đáng tin cậy, thẳng thắn nói chưa tra cứu được thông số chi tiết, không bịa đặc tính sản phẩm.
   c) Không lạm dụng tìm kiếm cho những câu hỏi không liên quan đến đặc tính/thông số sản phẩm (chào hỏi, hỏi giá hàng đã có trong kho, hỏi về đơn hàng...).
7. Được phép dùng Icon/emoji phù hợp để câu trả lời sinh động, gần gũi, thấu hiểu tâm lý khách — nhưng chọn lọc tùy ngữ cảnh, phong thái và mạch câu chuyện, không lạm dụng, không dùng tràn lan gây rối mắt hoặc thiếu chuyên nghiệp.
8. QUY TRÌNH CHỐT ĐƠN GỒM 2 BƯỚC, không được coi bước 1 là đã xong: (1) khi khách xác nhận muốn chốt, hệ thống sẽ MỞ một hộp thoại xác nhận cuối cùng ngay trên màn hình để khách bấm nút "Đồng ý, Gửi đơn"; (2) đơn hàng CHỈ thực sự được gửi vào hệ thống SAU KHI khách bấm nút đó. TUYỆT ĐỐI KHÔNG được khẳng định đơn hàng "đã được tiếp nhận vào hệ thống", "đã gửi kho", "đã hoàn tất", "đã đặt thành công" ngay khi khách vừa nói chốt đơn — chỉ nên nói đã mở hộp thoại xác nhận, mời khách bấm xác nhận lần cuối để hoàn tất. Nếu trong lịch sử hội thoại có tin nhắn trước đó của chính bạn cho biết khách đã chọn "Kiểm tra lại" (nghĩa là đơn CHƯA được gửi), và khách sau đó yêu cầu chốt đơn lần nữa, PHẢI xử lý đây là một yêu cầu chốt đơn HOÀN TOÀN MỚI (mở lại hộp thoại xác nhận) — TUYỆT ĐỐI không được nói kiểu "đơn này đã xử lý rồi" hay bỏ qua yêu cầu.
9. Nếu tin nhắn của khách CHỈ là lời xác nhận/ra lệnh đặt hàng (ví dụ: "ok chốt", "chốt đơn", "ừm mua", "đặt hàng", "gửi đơn", "xác nhận") mà KHÔNG kèm tên một sản phẩm mới nào, TUYỆT ĐỐI không được hiểu nhầm cụm từ xác nhận đó là tên sản phẩm rồi tư vấn/báo giá cho nó — đây thuần túy là hành động xác nhận chốt đơn giỏ hàng hiện tại.
${
  laVaiTroBoSung
    ? `
NHIỆM VỤ BỔ SUNG KHI ĐÓNG VAI "KÊNH 2 - TƯ VẤN CHUYÊN SÂU":
Câu trả lời của bạn lúc này sẽ được hiển thị dưới dạng bong bóng chat THỨ HAI, bổ sung ngay sau câu trả lời nhanh (Kênh 1) mà khách đã thấy. Vì vậy:
- KHÔNG chào hỏi lại từ đầu, KHÔNG lặp lại nguyên văn nội dung đã trả lời trước đó.
- Nếu tra cứu Google Search được thông tin thật sự HỮU ÍCH, MỚI (thông số kỹ thuật, xuất xứ, thương hiệu, mẹo chọn hàng, so sánh, lưu ý sử dụng...) mà câu trả lời trước CHƯA có, hãy trình bày sâu sắc, nhạy bén, tinh tế, đậm chất chuyên gia tư vấn — văn phong ngắn gọn, súc tích, có thể điểm xuyết icon/emoji phù hợp ngữ cảnh, phong thái và mạch chuyện để sinh động, thấu hiểu tâm lý khách (không lạm dụng, không sến sáo).
- Nếu tin nhắn của khách chỉ là câu xã giao, xác nhận đơn giản, hỏi giá hàng đã có sẵn trong kho, hoặc thực sự không có gì để bổ sung thêm giá trị, hãy trả lời DUY NHẤT đúng một chuỗi ký tự: KHONG_CO_BO_SUNG (không kèm bất kỳ ký tự, dấu câu hay khoảng trắng nào khác) để hệ thống tự động ẩn bong bóng này, tránh làm phiền khách.`
    : ""
}

THÔNG TIN FORM HIỆN TẠI:
- Khách: ${tenKhachForm || "Chưa nhập"} | SĐT: ${sdtForm || "Chưa nhập"} | Địa chỉ: ${diaChiForm || "Chưa nhập"}

DỮ LIỆU GIỎ HÀNG HIỆN TẠI:
${thongTinGioHangText}

DANH SÁCH SẢN PHẨM TRONG KHO:
${toanBoKhoText}`;

    let frontendContents = [];
    if (lichSuHoiThoai && Array.isArray(lichSuHoiThoai) && lichSuHoiThoai.length > 0) {
      let filteredHistory = lichSuHoiThoai.slice(-8);
      let lastRole = "model";
      filteredHistory.forEach((item) => {
        let currentRole = item.role === "user" ? "user" : "model";
        if (currentRole !== lastRole && item.text && item.text.trim() !== "") {
          frontendContents.push({ role: currentRole, parts: [{ text: item.text.replace(/<[^>]*>?/gm, "") }] });
          lastRole = currentRole;
        }
      });
    }
    frontendContents.push({ role: "user", parts: [{ text: tinNhanKhach }] });
    let backendContents = [{ role: "user", parts: [{ text: `Tin nhắn: "${tinNhanKhach}"` }] }];

    const { salesText, dataJson } = await goiSongSong2Module(env, promptFrontend, promptBackend, frontendContents, backendContents);

    let phoneMatch = tinNhanKhach.replace(/[\s.\-_]/g, "").match(/(0[3|5|7|8|9][0-9]{8})/);
    let sdtTrichXuat = dataJson.sdt || (phoneMatch ? phoneMatch[1] : "");
    let nameMatch = tinNhanKhach.match(/(?:anh|chị|em|bác|chú|cô|cty|công ty|tên|khách)\s+([a-zA-ZÀ-ỹ0-9\s]{2,30})/i);
    let tenTrichXuat = dataJson.tenKhach || (nameMatch ? nameMatch[0].trim() : "");

    const sdtKetHop = sdtForm || sdtTrichXuat;
    const tenKetHop = tenKhachForm || tenTrichXuat;
    const diaChiKetHop = diaChiForm || dataJson.diaChi || "";

    const tuKhoaChot = ["chot don", "chot tong don", "gui kho", "chot giup", "dat hang ngay", "mua luon", "chot het", "len don", "tong bill", "thanh toan", "xac nhan don", "gui don", "ok chot", "chot luon", "chot nha em", "chot nhe", "chot ho anh", "chot giup chi"];
    const tuKhoaXacNhanNhanh = ["ok", "oke", "okie", "duoc em", "dong y", "chot di", "gui di", "xac nhan", "len don di", "tien hanh di"];

    const isYeuCauChot = dataJson.isYeuCauChotDon || tuKhoaChot.some((kw) => cleanInput.includes(kw));
    const isXacNhanNhanh = tuKhoaXacNhanNhanh.some((kw) => cleanInput === kw || cleanInput.startsWith(kw + " ") || cleanInput.endsWith(" " + kw));

    if (!laVaiTroBoSung && (sdtTrichXuat || isYeuCauChot || (isXacNhanNhanh && sdtKetHop))) {
      if (!gioHangHienTai || gioHangHienTai.length === 0) {
        return {
          success: true,
          reply: "Dạ giỏ hàng hiện tại đang trống nên em chưa thể thực hiện chốt đơn được ạ. Quý khách vui lòng chọn các mặt hàng cần thiết vào giỏ trước nhé! 📦",
          actions: [],
        };
      }

      if (sdtKetHop && tenKetHop) {
        let actionList = [];
        if (sdtTrichXuat || tenTrichXuat) {
          actionList.push({ type: "FILL_CUSTOMER_INFO", params: { khachHang: tenKetHop, sdt: sdtKetHop, diaChi: diaChiKetHop } });
        }
        actionList.push({ type: "CHECKOUT", params: {} });

        return {
          success: true,
          reply: `Dạ em đã ghi nhận thông tin đặt hàng của <b>${tenKetHop}</b> (SĐT: <b class="text-success">${sdtKetHop}</b>).<br><br>📦 <b>Tổng cộng:</b> ${gioHangHienTai.length} mặt hàng (${tongSLGio} món)<br>💰 <b>Tổng giá trị tạm tính:</b> <span style="color:#d9534f; font-weight:bold;">${tongTienGio.toLocaleString("vi-VN")}đ</span><br><br><i>Em vừa mở hộp thoại xác nhận đơn hàng lần cuối — Quý khách vui lòng bấm <b>"Đồng ý, Gửi đơn"</b> trong hộp thoại đó để hoàn tất chuyển đơn đến Kho Vạn Phát nhé! Nếu cần xem/chỉnh sửa lại, Quý khách chọn <b>"Kiểm tra lại"</b> rồi nhắn tiếp cho em ạ ✨</i>`,
          actions: actionList,
        };
      }

      if (sdtKetHop && !tenKetHop) {
        return {
          success: true,
          reply: `Dạ em đã nhận được số điện thoại liên hệ: <b class="text-success">${sdtKetHop}</b>.<br><br>⚠️ <i>Quý khách vui lòng cho em xin thêm <b>Tên Khách Hàng / Tên Đơn Vị</b> (nhắn vào chat hoặc điền trực tiếp ở ô trên) để em hoàn tất phiếu giao hàng chuyển kho ngay nhé ạ! ✨</i>`,
          actions: [
            { type: "FILL_CUSTOMER_INFO", params: { sdt: sdtKetHop } },
            { type: "PROMPT_CUSTOMER_INFO", params: { sdt: sdtKetHop } },
          ],
        };
      }

      if (!sdtKetHop) {
        return {
          success: true,
          reply: `Dạ em đã chuẩn bị sẵn sàng đơn hàng cho Quý khách:<br><br>📦 <b>Tổng cộng:</b> ${gioHangHienTai.length} mặt hàng (${tongSLGio} món)<br>💰 <b>Tạm tính:</b> <span style="color:#d9534f; font-weight:bold;">${tongTienGio.toLocaleString("vi-VN")}đ</span><br><br>⚠️ <i>Để Vạn Phát lập phiếu giao hàng và chuyển kho chuẩn xác, Quý khách vui lòng cung cấp giúp em <b>Họ tên và Số điện thoại liên hệ</b> (hoặc điền trực tiếp vào khung thông tin bên trên) nhé ạ! ✨</i>`,
          actions: [{ type: "PROMPT_CUSTOMER_INFO", params: {} }],
        };
      }
    }

    if (salesText) {
      let actions = dataJson.actions || [];
      const actionRegex = /\[ACTION:(ADD_CART|ADD_CUSTOM_CART|APPLY_CODE|CLEAR_CART|CHECKOUT|PROMPT_CUSTOMER_INFO|FILL_CUSTOMER_INFO)(?::([^\]]*))?\]/g;
      let match;
      while ((match = actionRegex.exec(salesText)) !== null) {
        actions.push({ type: match[1], params: chuyenDoiThamSoActionAnToan(match[1], match[2]) });
      }

      let cleanText = salesText.replace(actionRegex, "").trim();
      let formatted = cleanText
        .replace(/^###\s*(.*$)/gim, '<div style="color:#1F4E78; font-weight:bold; font-size:13.5px; margin-top:8px; margin-bottom:4px; border-bottom:1px dashed #cbd5e1; padding-bottom:2px;"><i class="fas fa-tag me-1 text-warning"></i>$1</div>')
        .replace(/^##\s*(.*$)/gim, '<div style="color:#1F4E78; font-weight:800; font-size:14px; margin-top:10px; margin-bottom:6px;">$1</div>')
        .replace(/(\d{1,3}(?:\.\d{3})*đ)/g, '<span style="color:#d9534f; font-weight:bold;">$1</span>')
        .replace(/^\*\s*(.*$)/gim, '<div style="padding-left:10px; margin-bottom:3px; position:relative;"><span style="color:#1F4E78; font-weight:bold; position:absolute; left:0;">•</span> $1</div>')
        .replace(/\*\*(.*?)\*\*/g, '<b style="color:#0f172a;">$1</b>')
        .replace(/\*(.*?)\*/g, '<i style="color:#475569;">$1</i>')
        .replace(/\n/g, "<br>");

      return { success: true, reply: formatted, actions: actions };
    }

    if (matchedListFallback.length > 0) {
      let fallbackReply = `Dạ kính thưa Quý khách, Vạn Phát có sẵn các mặt hàng phù hợp trong kho:<br>`;
      matchedListFallback.slice(0, 5).forEach((sp) => {
        fallbackReply += `<br>• <b>[${sp.ma}] ${sp.ten}</b>: <span style="color:#d9534f; font-weight:bold;">${sp.gia.toLocaleString("vi-VN")}đ</span>/${sp.dvt}`;
      });
      fallbackReply += `<br><br><i>Quý khách muốn lấy mặt hàng nào với số lượng bao nhiêu, vui lòng báo em để em nạp đơn ngay ạ!</i>`;
      return { success: true, reply: fallbackReply, actions: [] };
    }

    return {
      success: true,
      reply: `Dạ em đã ghi nhận nhu cầu về mặt hàng <b>${tinNhanKhach}</b>. Vạn Phát hoàn toàn sẵn sàng khảo sát đơn vị phân phối để nhập hàng với mức giá sỉ tốt nhất cho Quý khách. Quý khách muốn đặt số lượng bao nhiêu để em hỗ trợ lên đơn ạ? ✨`,
      actions: [],
    };
  } catch (e) {
    return { success: true, reply: `Sự cố nội bộ: ${e.message}`, actions: [] };
  }
}
