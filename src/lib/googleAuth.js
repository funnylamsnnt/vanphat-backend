// ================================================================
// XÁC THỰC GOOGLE SERVICE ACCOUNT (JWT Bearer -> Access Token)
// Thay thế cơ chế xác thực ngầm định của SpreadsheetApp/DriveApp trong
// Apps Script — ở đây ta phải TỰ KÝ JWT bằng private key của service
// account rồi đổi lấy access_token qua OAuth2 token endpoint của Google.
// Dùng Web Crypto API (chuẩn, có sẵn trong Cloudflare Workers, không cần
// thư viện ngoài).
// ================================================================

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const KV_KEY_ACCESS_TOKEN = "google_access_token_v1";

function base64UrlEncode(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.byteLength; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlEncodeString(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

// Chuyển private key dạng PEM (có \n literal trong JSON) thành CryptoKey để ký RS256.
async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/**
 * Lấy access_token còn hiệu lực cho service account, với các scope yêu cầu.
 * Cache trong Workers KV ~55 phút (token Google cấp sống 1 giờ) để đỡ phải
 * ký JWT + gọi token endpoint ở mỗi request — tương tự tinh thần cache 5 phút
 * của layDanhSachApiKeyDangHoatDong() bên Code.gs gốc, nhưng áp dụng cho token.
 *
 * @param {object} env - Worker env (cần env.GOOGLE_SERVICE_ACCOUNT_KEY, env.CACHE)
 * @param {string[]} scopes - ví dụ ["https://www.googleapis.com/auth/spreadsheets"]
 */
export async function getGoogleAccessToken(env, scopes) {
  const cacheKey = KV_KEY_ACCESS_TOKEN + ":" + scopes.join(",");
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return cached;
  }

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const nowSec = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const unsigned = base64UrlEncodeString(JSON.stringify(header)) + "." + base64UrlEncodeString(JSON.stringify(claims));
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + base64UrlEncode(signature);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Không lấy được access token Google: " + res.status + " " + errText);
  }

  const json = await res.json();
  const accessToken = json.access_token;

  if (env.CACHE) {
    // Đặt hết hạn cache sớm hơn thời hạn thật (3600s) một chút cho an toàn.
    await env.CACHE.put(cacheKey, accessToken, { expirationTtl: 3300 });
  }

  return accessToken;
}
