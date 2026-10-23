import * as crypto from "node:crypto";
import { Buffer } from "node:buffer";

const SP_DC = process.env.SP_DC || "AQC-oNwaNiWJYiy-dUglqW4orzYTrXXUzpCRZ5KC0dckVOMlERTuDXPqBUSvdY58rjr3sM0ikIXZNEClBsMNliSF4kcxflyyn4NiB-NdFGU2lUp2G5J559Jj269ytQvNI8Mx2WxJFCo5HrEmcHevuIlyunoRHuV45WJmDnE_VlgMUaSSc2mF5wxtd8M3LEF14usdLZKw_VYNbzCipBhZzXcS-XQHZtP5tby6bywU4Gz0nYqT9OFGADZtvyd_WdqGDm3qUQOCsKWSyfI";

class SpotifyPureAPI {
  constructor(spDc) {
    this.spDc = spDc;
    this.accessToken = null;
    this.clientToken = null;
    this.tokenExpiry = 0;
    this.totpSecret = process.env.SPOTIFY_TOTP_SECRET || "";
    this.totpVersion = "61";
  }

  async _fetchLatestTotpFromWeb() {
    try {
      const res = await fetch("https://open.spotify.com/", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      if (res.ok) {
        const html = await res.text();
        const jsMatch = html.match(/src="([^"]*\/cdn\/build\/(?:web-player\/web-player|mobile-web-player\/mobile-web-player)\.[a-f0-9]+\.js)"/);
        if (jsMatch) {
          let jsUrl = jsMatch[1];
          if (!jsUrl.startsWith("http")) jsUrl = "https://open.spotifycdn.com" + jsUrl;
          const jsRes = await fetch(jsUrl);
          if (jsRes.ok) {
            const jsText = await jsRes.text();
            const match = jsText.match(/let\s+[a-zA-Z0-9_$]+\s*=\s*(\[\s*\{secret:.*?\}\s*\])\.map/);
            if (match) {
              const rawArray = match[1];
              const itemMatches = [...rawArray.matchAll(/secret:\s*(['"])(.*?)(?<!\\)\1\s*,\s*version:\s*(\d+)/g)];
              if (itemMatches.length > 0) {
                itemMatches.sort((a, b) => parseInt(b[3]) - parseInt(a[3]));
                this.totpSecret = itemMatches[0][2];
                this.totpVersion = itemMatches[0][3];
                return true;
              }
            }
          }
        }
      }
    } catch (e) {}
    return false;
  }

  _generateTotp(timestampMs = null) {
    if (!timestampMs) timestampMs = Date.now();
    const r = [];
    for (let i = 0; i < this.totpSecret.length; i++) {
      r.push(String(this.totpSecret.charCodeAt(i) ^ ((i % 33) + 9)));
    }
    const rawKey = Buffer.from(r.join(""), "utf-8");
    const counter = Math.floor(timestampMs / 1000 / 30);
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(counter));

    const hmac = crypto.createHmac("sha1", rawKey).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const truncated = hmac.readUInt32BE(offset) & 0x7fffffff;
    return String(truncated % 1000000).padStart(6, "0");
  }

  async getClientToken() {
    const payload = {
      client_data: {
        client_version: "1.2.98.59.g81a1284c-development",
        client_id: "d8a5ed958d274c2e8ee717e6a4b0971d",
        js_sdk_data: {
          device_brand: "Google",
          device_model: "desktop",
          os: "Windows",
          os_version: "NT 10.0",
        },
      },
    };
    const res = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to get client-token: ${res.status}`);
    const data = await res.json();
    return data?.granted_token?.token;
  }

  async getAccessToken() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const totp = this._generateTotp();
      const url = `https://open.spotify.com/api/token?reason=init&productType=web-player&totp=${totp}&totpServer=${totp}&totpVer=${this.totpVersion}`;
      const res = await fetch(url, {
        headers: {
          "Cookie": `sp_dc=${this.spDc}`,
          "Referer": "https://open.spotify.com/",
          "Origin": "https://open.spotify.com",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "application/json",
        },
      });
      if (res.ok) {
        const data = await res.json();
        this.accessToken = data.accessToken;
        this.tokenExpiry = (data.accessTokenExpirationTimestampMs || 0) / 1000;
        return this.accessToken;
      }
      if (res.status === 400 && attempt === 0) {
        const updated = await this._fetchLatestTotpFromWeb();
        if (updated) continue;
      }
      const txt = await res.text();
      throw new Error(`Failed to get access-token (${res.status})`);
    }
  }

  async ensureTokens() {
    if (!this.clientToken) {
      this.clientToken = await this.getClientToken();
    }
    if (!this.accessToken || Date.now() / 1000 > this.tokenExpiry - 60) {
      await this.getAccessToken();
    }
  }

  async queryPathfinder(operationName, sha256Hash, variables) {
    await this.ensureTokens();
    const url = "https://api-partner.spotify.com/pathfinder/v2/query";
    const payload = {
      variables,
      operationName,
      extensions: { persistedQuery: { version: 1, sha256Hash } },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "client-token": this.clientToken,
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://open.spotify.com",
        "Referer": "https://open.spotify.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Pathfinder '${operationName}' failed (${res.status})`);
    }
    return await res.json();
  }

  _extractId(inputStr, expectedType = null) {
    if (!inputStr) throw new Error("ID atau URL Spotify tidak boleh kosong.");
    inputStr = inputStr.trim();

    const urlMatch = inputStr.match(/spotify\.com\/[^#?]*\/(track|artist|album|playlist)\/([a-zA-Z0-9]+)/);
    if (urlMatch) {
      const [, actualType, entityId] = urlMatch;
      if (expectedType && actualType !== expectedType) {
        throw new Error(`Input yang Anda masukkan adalah URL ${actualType}, sedangkan endpoint ini memerlukan ${expectedType}.`);
      }
      return entityId;
    }

    const uriMatch = inputStr.match(/spotify:(track|artist|album|playlist):([a-zA-Z0-9]+)/);
    if (uriMatch) {
      const [, actualType, entityId] = uriMatch;
      if (expectedType && actualType !== expectedType) {
        throw new Error(`Input yang Anda masukkan adalah URI ${actualType}, sedangkan endpoint ini memerlukan ${expectedType}.`);
      }
      return entityId;
    }

    const cleanId = inputStr.split("?")[0].split("/").pop().split(":").pop().trim();
    if (!/^[a-zA-Z0-9]+$/.test(cleanId)) {
      throw new Error(`Format ID/URL Spotify tidak valid: '${inputStr}'`);
    }
    return cleanId;
  }

  async getCanvasUrl(trackIdOrUrl) {
    try {
      const trackId = this._extractId(trackIdOrUrl, "track");
      await this.ensureTokens();
      const trackUri = `spotify:track:${trackId}`;

      const uriBuf = Buffer.from(trackUri, "utf-8");
      const trackMsg = Buffer.concat([Buffer.from([0x0a, uriBuf.length]), uriBuf]);
      const reqMsg = Buffer.concat([Buffer.from([0x0a, trackMsg.length]), trackMsg]);

      const res = await fetch("https://spclient.wg.spotify.com/canvaz-cache/v0/canvases", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.accessToken}`,
          "client-token": this.clientToken,
          "App-Platform": "Android",
          "Content-Type": "application/x-protobuf",
        },
        body: reqMsg,
      });

      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 10) {
          const text = buf.toString("utf-8");
          const match = text.match(/https:\/\/canvaz\.scdn\.co\/[^\s\x00-\x1f\x7f-\xff]+\.cnvs\.mp4/);
          if (match) return match[0];
        }
      }
    } catch (e) {}
    return null;
  }

  async getTrackDetails(trackIdOrUrl) {
    const trackId = this._extractId(trackIdOrUrl, "track");
    const variables = { uri: `spotify:track:${trackId}` };
    const data = await this.queryPathfinder("getTrack", "1a2f0cce77c90a4a5b1730beecc4da7e34290d684324c16663bf09a268ebce48", variables);
    const t = data?.data?.trackUnion;
    if (!t || t.__typename === "NotFound") {
      throw new Error(`Lagu dengan ID '${trackId}' tidak ditemukan di Spotify.`);
    }

    const durMs = t.duration?.totalMilliseconds || 0;
    const albumData = t.albumOfTrack || {};
    const albumId = albumData.uri ? albumData.uri.split(":").pop() : "";
    const covers = albumData.coverArt?.sources || [];

    const firstArt = t.firstArtist?.items || [];
    const otherArt = t.otherArtists?.items || [];
    const allArtists = [...firstArt, ...otherArt];
    const artistsNames = allArtists.map((a) => a.profile?.name).filter(Boolean);
    const artistId = allArtists[0]?.uri?.split(":").pop() || "";

    const playcountRaw = t.playcount;
    const playcountInt = playcountRaw ? parseInt(playcountRaw, 10) : null;
    const isExplicit = t.contentRating?.label === "EXPLICIT";
    const releaseDate = albumData.date?.isoString || "";
    const canvasUrl = await this.getCanvasUrl(trackId);

    return {
      id: trackId,
      title: t.name,
      artists: artistsNames.join(", "),
      artist_id: artistId,
      album: albumData.name,
      album_id: albumId,
      release_date: releaseDate ? releaseDate.slice(0, 10) : "",
      duration: `${Math.floor(durMs / 60000)}:${String(Math.floor((durMs % 60000) / 1000)).padStart(2, "0")}`,
      playcount: playcountInt,
      playcount_formatted: playcountInt ? playcountInt.toLocaleString() : "0",
      is_explicit: isExplicit,
      cover_url: covers.length > 0 ? covers[covers.length - 1].url : "",
      canvas_url: canvasUrl,
      spotify_url: `https://open.spotify.com/track/${trackId}`,
    };
  }

  async searchTracks(query, limit = 10, offset = 0) {
    const variables = {
      searchTerm: query,
      offset,
      limit,
      numberOfTopResults: limit,
      includeAudiobooks: true,
      includeAuthors: false,
      includePreReleases: true,
      includeAlbumPreReleases: false,
      includeEpisodeContentRatingsV2: true,
    };
    const data = await this.queryPathfinder("searchTracks", "59ee4a659c32e9ad894a71308207594a65ba67bb6b632b183abe97303a51fa55", variables);
    const items = data?.data?.searchV2?.tracksV2?.items || [];

    const results = [];
    for (const it of items) {
      const t = it?.item?.data;
      if (!t) continue;
      const uri = t.uri || "";
      const tid = uri.split(":").pop();

      const artistsRaw = t.artists?.items || [];
      const artistsNames = artistsRaw.map((a) => a.profile?.name).filter(Boolean);
      const firstArtistId = artistsRaw[0]?.uri?.split(":").pop() || "";

      const albumData = t.albumOfTrack || {};
      const albumId = albumData.uri ? albumData.uri.split(":").pop() : "";
      const covers = albumData.coverArt?.sources || [];
      const durMs = t.duration?.totalMilliseconds || 0;
      const isExplicit = t.contentRating?.label === "EXPLICIT";

      results.push({
        id: tid,
        title: t.name || "",
        artists: artistsNames.join(", "),
        artist_id: firstArtistId,
        album: albumData.name || "",
        album_id: albumId,
        duration: `${Math.floor(durMs / 60000)}:${String(Math.floor((durMs % 60000) / 1000)).padStart(2, "0")}`,
        is_explicit: isExplicit,
        cover_url: covers.length > 0 ? covers[covers.length - 1].url : "",
        spotify_url: `https://open.spotify.com/track/${tid}`,
      });
    }
    return results;
  }
}

const spotifyClient = new SpotifyPureAPI(SP_DC);

export default {
  name: "Spotify Search V2",
  description: "Cari lagu di Spotify & lihat detail track (search / track) menggunakan sesi sp_dc (Pathfinder API).",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["action", "query", "url", "limit"],
  paramsSchema: {
    action: {
      type: "string",
      required: false,
      description: "Mode: 'search' (cari lagu, default) atau 'track' (detail lagu via url/id)",
      example: "track",
      default: "search",
    },
    query: {
      type: "string",
      required: true,
      description: "Kata kunci lagu/artis yang ingin dicari (wajib untuk action=search)",
      example: "shape of my heart",
    },
    url: {
      type: "string",
      required: false,
      description: "Link track Spotify (wajib untuk action=track)",
      example: "https://open.spotify.com/track/35o9a4iAfLl5jRmqMX9c1D",
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil pencarian (default 5, maksimum 20)",
      default: 5,
    },
  },

  async run(req, res) {
    try {
      const { action = "search", query, url, limit } = { ...req.query, ...req.body };
      const mode = String(action || "search").trim().toLowerCase();

      if (mode === "track") {
        if (!url || typeof url !== "string" || !/spotify\.com\/(?:[^#?]*\/)?(?:track|album|playlist|artist)\//.test(url)) {
          return res.status(400).json({
            status: false,
            message: "Parameter 'url' wajib diisi dengan link Spotify",
          });
        }
        const result = await spotifyClient.getTrackDetails(url.trim());
        return res.json({
          status: true,
          result: result,
          timestamp: Date.now(),
        });
      }

      if (mode !== "search") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'action' harus 'search' atau 'track'",
        });
      }

      if (!query || typeof query !== "string" || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Parameter 'query' wajib diisi",
        });
      }

      const searchLimit = limit ? Math.min(20, Math.max(1, parseInt(limit))) : 5;
      const result = await spotifyClient.searchTracks(query.trim(), searchLimit);

      res.json({
        status: true,
        result: result,
        timestamp: Date.now(),
      });
    } catch (err) {
      res.status(500).json({
        status: false,
        message: err.message || "Gagal memproses permintaan Spotify",
        timestamp: Date.now(),
      });
    }
  },
};