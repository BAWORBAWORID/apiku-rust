import { performance } from "perf_hooks";
import logger from "../../src/utils/logger.js";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export default {
  name: "ModJall Bypass",
  description: "Bypass ModJall / Khaddavi safelinks",
  category: "Bypass",
  methods: ["GET", "POST"],
  params: ["url"],
  paramsSchema: {
    url: {
      type: "string",
      required: true,
      description: "URL ModJall yang ingin di-bypass",
    },
  },
  async run(req, res) {
    const rawUrl = req.method === "POST" ? req.body.url : req.query.url;
    if (!rawUrl) {
      return res.status(400).json({ success: false, message: "Parameter url tidak ditemukan." });
    }

    const startTime = performance.now();
    const cookies = {};

    function updateCookies(resFetch) {
      const raw =
        resFetch.headers && typeof resFetch.headers.getSetCookie === "function"
          ? resFetch.headers.getSetCookie()
          : [];
      for (const c of raw) {
        const [pair] = c.split(";");
        const [k, ...v] = pair.split("=");
        if (k) {
          cookies[k.trim()] = v.join("=").trim();
        }
      }
    }

    function getCookies() {
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    try {
      const res1 = await fetch(rawUrl, {
        headers: { "User-Agent": userAgent },
      });
      updateCookies(res1);
      const html1 = await res1.text();

      // Cek jika token langsung ada di halaman pertama
      const directToken = (
        html1.match(/var\s+token\s*=\s*["\x27]([a-f0-9]{32})["\x27]/i) ||
        html1.match(/value=["\x27]([a-f0-9]{32})["\x27]/i)
      )?.[1];

      if (directToken) {
        return res.json({
          success: true,
          result: {
            token: directToken,
            original_url: rawUrl,
          },
          execution_time_ms: Math.round(performance.now() - startTime),
        });
      }

      const rayId = html1.match(/name="ray_id"\s+value="([^"]+)"/i)?.[1];
      const alias = html1.match(/name="alias"\s+value="([^"]+)"/i)?.[1];
      const formAction = html1.match(/action="([^"]+)"/i)?.[1] || "https://app.khaddavi.net/redirect.php";

      if (!rayId || !alias) {
        throw new Error("Gagal mengekstrak ray_id atau alias dari halaman.");
      }

      const gatewayOrigin = new URL(formAction).origin;

      const res2 = await fetch(`${formAction}?ray_id=${encodeURIComponent(rayId)}&alias=${encodeURIComponent(alias)}`, {
        headers: {
          "User-Agent": userAgent,
          Referer: rawUrl,
          Cookie: getCookies(),
        },
        redirect: "manual",
      });
      updateCookies(res2);

      let loc1 = res2.headers.get("location") || "";
      if (!loc1) throw new Error("Gagal mendapatkan lokasi artikel step 1.");
      if (loc1.startsWith("/")) loc1 = gatewayOrigin + loc1;

      const res3 = await fetch(loc1, {
        method: "HEAD",
        headers: {
          "User-Agent": userAgent,
          Referer: `${formAction}?ray_id=${encodeURIComponent(rayId)}&alias=${encodeURIComponent(alias)}`,
          Cookie: getCookies(),
        },
      });
      updateCookies(res3);

      const xsrfToken = decodeURIComponent(cookies["XSRF-TOKEN"] || "");

      const resVerify = await fetch(`${gatewayOrigin}/api/verify`, {
        method: "POST",
        headers: {
          "User-Agent": userAgent,
          Referer: loc1,
          Origin: gatewayOrigin,
          "Content-Type": "application/json",
          "X-XSRF-TOKEN": xsrfToken,
          Cookie: getCookies(),
        },
        body: JSON.stringify({ _a: 0, captcha: null, passcode: undefined }),
      });
      updateCookies(resVerify);

      const verifyData = await resVerify.json();
      const step2Target = verifyData?.target;
      if (!step2Target) {
        throw new Error(`API Verify gagal: ${JSON.stringify(verifyData)}`);
      }

      const resStep2Redirect = await fetch(step2Target, {
        headers: {
          "User-Agent": userAgent,
          Referer: loc1,
          Cookie: getCookies(),
        },
        redirect: "manual",
      });
      updateCookies(resStep2Redirect);

      let loc2 = resStep2Redirect.headers.get("location") || "";
      if (!loc2) throw new Error("Gagal mendapatkan lokasi artikel step 2.");
      if (loc2.startsWith("/")) loc2 = gatewayOrigin + loc2;

      const resArticle2 = await fetch(loc2, {
        method: "HEAD",
        headers: {
          "User-Agent": userAgent,
          Referer: step2Target,
          Cookie: getCookies(),
        },
      });
      updateCookies(resArticle2);

      const key = Math.floor(Math.random() * 1000);
      const size = `${(1366 + key) * 2}.${(768 + key) * 2}`;

      const resGo = await fetch(`${gatewayOrigin}/api/go`, {
        method: "POST",
        headers: {
          "User-Agent": userAgent,
          Referer: loc2,
          Origin: gatewayOrigin,
          "Content-Type": "application/json",
          "X-XSRF-TOKEN": decodeURIComponent(cookies["XSRF-TOKEN"] || ""),
          Cookie: getCookies(),
        },
        body: JSON.stringify({ key, size }),
      });
      updateCookies(resGo);

      const goData = await resGo.json();
      const shortlinkUrl = goData?.url;
      if (!shortlinkUrl) {
        throw new Error(`API Go gagal: ${JSON.stringify(goData)}`);
      }

      const resShortlink = await fetch(shortlinkUrl, {
        headers: {
          "User-Agent": userAgent,
          Referer: loc2,
          Cookie: getCookies(),
        },
      });
      const htmlShortlink = await resShortlink.text();

      let destinationUrl = "";
      const matchHref = htmlShortlink.match(/window\.location\.href\s*=\s*"([^"]+)"/i);
      if (matchHref) {
        destinationUrl = matchHref[1].replace(/\\([\/"])/g, "$1").replace(/\\u0026/g, "&");
      } else {
        destinationUrl = resShortlink.headers.get("location") || shortlinkUrl;
      }

      const resFinal = await fetch(destinationUrl, {
        headers: { "User-Agent": userAgent },
      });
      const htmlFinal = await resFinal.text();

      const finalToken = (
        htmlFinal.match(/var\s+token\s*=\s*["\x27]([a-f0-9]{32})["\x27]/i) ||
        htmlFinal.match(/value=["\x27]([a-f0-9]{32})["\x27]/i)
      )?.[1];

      const endTime = performance.now();
      
      logger.info(`[ModJall] Success Bypass: ${rawUrl}`);
      
      return res.json({
        success: Boolean(finalToken),
        result: {
          token: finalToken || undefined,
          original_url: rawUrl,
        },
        execution_time_ms: Math.round(endTime - startTime),
      });
    } catch (err) {
      const endTime = performance.now();
      logger.error(`[ModJall] Error Bypass: ${err.message}`);
      return res.status(500).json({
        success: false,
        message: err.message || "Terjadi kesalahan saat memproses bypass.",
        execution_time_ms: Math.round(endTime - startTime),
      });
    }
  },
};
