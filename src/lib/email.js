// Gửi email xác nhận đơn hàng — thay thế MailApp.sendEmail() của Apps Script.
// Dùng Resend (https://resend.com) qua REST API thuần (không cần SDK).
// Cần: env.RESEND_API_KEY (secret), env.EMAIL_FROM (vd: "Vạn Phát Pro <donhang@vanphatcompany.vn>").

export async function sendOrderEmail(env, { to, subject, html, attachmentPdfBuffer, attachmentFileName }) {
  const payload = {
    from: env.EMAIL_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  if (attachmentPdfBuffer) {
    // Resend yêu cầu nội dung file đính kèm dạng base64.
    const base64 = arrayBufferToBase64(attachmentPdfBuffer);
    payload.attachments = [{ filename: attachmentFileName || "PhieuGiaoHang.pdf", content: base64 }];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    // Không throw để 1 lỗi gửi mail không làm hỏng cả luồng lưu đơn hàng (giống MailApp im lặng
    // nếu lỗi trong Apps Script cũng chỉ log, không chặn việc appendRow đã xảy ra trước đó).
    console.warn("Gửi email thất bại: " + res.status + " " + (await res.text()));
    return { ok: false };
  }
  return { ok: true, json: await res.json() };
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
