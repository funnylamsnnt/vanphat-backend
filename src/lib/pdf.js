// Sinh PDF phiếu giao hàng từ HTML — thay thế
// Utilities.newBlob(fullHtml,"text/html",...).getAs("application/pdf") của Apps Script.
// Dùng REST API "Browser Rendering" của Cloudflare (nhận thẳng HTML, trả PDF) thay vì thư viện
// @cloudflare/puppeteer — nhẹ hơn nhiều (không kéo theo ~700KB thư viện vào bundle Worker),
// chỉ cần 1 lệnh fetch() thuần.
// Cần 2 secret: CF_ACCOUNT_ID (= account_id trong wrangler.toml, có thể để var thường) và
// CF_BROWSER_RENDERING_TOKEN (API Token phạm vi RIÊNG "Browser Rendering: Edit" — KHÔNG dùng
// chung token deploy để tránh rủi ro nếu lộ).

export async function renderHtmlToPdfBuffer(env, html) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/pdf`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.CF_BROWSER_RENDERING_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html,
      pdfOptions: { printBackground: true, format: "A4", margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } },
    }),
  });

  if (!res.ok) {
    throw new Error("Sinh PDF thất bại: " + res.status + " " + (await res.text()));
  }
  return res.arrayBuffer();
}
