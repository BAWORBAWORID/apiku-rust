const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BMKG_REALTIME_URL = 'https://www.bmkg.go.id/gempabumi/gempabumi-realtime';
const BMKG_AUTOGEMPA_URL = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const BMKG_DIRASAKAN_URL = 'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json';

function parseCoordinates(coordStr) {
  if (!coordStr) {
    return { latitude: null, longitude: null };
  }

  const match = coordStr.match(/([\d.,]+)\s*(LS|LU)\s*[-,\s]*([\d.,]+)\s*(BT|BB)/i);

  if (match) {
    let latitude = parseFloat(match[1].replace(',', '.'));
    let longitude = parseFloat(match[3].replace(',', '.'));

    if (match[2].toUpperCase() === 'LS') latitude = -latitude;
    if (match[4].toUpperCase() === 'BB') longitude = -longitude;

    return { latitude, longitude };
  }

  const simpleMatch = coordStr.split(',');
  if (simpleMatch.length === 2) {
    const latitude = parseFloat(simpleMatch[0].trim());
    const longitude = parseFloat(simpleMatch[1].trim());
    if (!isNaN(latitude) && !isNaN(longitude)) {
      return { latitude, longitude };
    }
  }

  return { latitude: null, longitude: null };
}

function buildMapUrl(latitude, longitude) {
  if (latitude === null || longitude === null || isNaN(latitude) || isNaN(longitude)) {
    return null;
  }
  return `https://static-maps.yandex.ru/1.x/?l=map&pt=${longitude},${latitude},pm2rdm&z=7&size=600,400`;
}

async function getGempa() {
  try {
    const [realtimeRes, latestRes, dirasakanRes] = await Promise.all([
      fetch(BMKG_REALTIME_URL, { headers: { 'user-agent': USER_AGENT } }),
      fetch(BMKG_AUTOGEMPA_URL, { headers: { 'user-agent': USER_AGENT } }),
      fetch(BMKG_DIRASAKAN_URL, { headers: { 'user-agent': USER_AGENT } })
    ]);

    if (!realtimeRes.ok) throw new Error(`Failed to fetch BMKG Realtime page: ${realtimeRes.statusText}`);
    if (!latestRes.ok) throw new Error(`Failed to fetch BMKG Autogempa: ${latestRes.statusText}`);
    if (!dirasakanRes.ok) throw new Error(`Failed to fetch BMKG Dirasakan: ${dirasakanRes.statusText}`);

    const [html, latestData, dirasakanData] = await Promise.all([
      realtimeRes.text(),
      latestRes.json(),
      dirasakanRes.json()
    ]);

    const realtimeQuakes = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    let isHeader = true;

    while ((trMatch = trRegex.exec(html)) !== null) {
      if (isHeader) {
        isHeader = false;
        continue;
      }

      const trContent = trMatch[1];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const tds = [];
      let tdMatch;

      while ((tdMatch = tdRegex.exec(trContent)) !== null) {
        tds.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
      }

      if (tds.length >= 6) {
        const [noStr, waktu, magnitudo, kedalaman, koordinat, wilayah] = tds;
        const { latitude, longitude } = parseCoordinates(koordinat);

        realtimeQuakes.push({
          no: parseInt(noStr) || null,
          waktu,
          magnitudo,
          kedalaman,
          koordinat,
          latitude,
          longitude,
          wilayah,
          mapUrl: buildMapUrl(latitude, longitude)
        });
      }
    }

    const latestGempa = latestData?.Infogempa?.gempa;
    if (!latestGempa) throw new Error('Invalid autogempa JSON structure.');

    const { latitude: latestLatitude, longitude: latestLongitude } = parseCoordinates(
      latestGempa.Coordinates || `${latestGempa.Lintang},${latestGempa.Bujur}`
    );

    const latestMapUrl = buildMapUrl(latestLatitude, latestLongitude);
    const shakemapUrl = latestGempa.Shakemap
      ? `https://data.bmkg.go.id/DataMKG/TEWS/${latestGempa.Shakemap}`
      : null;

    const latest = {
      tanggal: latestGempa.Tanggal,
      jam: latestGempa.Jam,
      dateTime: latestGempa.DateTime,
      coordinates: latestGempa.Coordinates,
      lintang: latestGempa.Lintang,
      bujur: latestGempa.Bujur,
      latitude: latestLatitude,
      longitude: latestLongitude,
      magnitudo: latestGempa.Magnitude,
      kedalaman: latestGempa.Kedalaman,
      wilayah: latestGempa.Wilayah,
      potensi: latestGempa.Potensi || null,
      dirasakan: latestGempa.Dirasakan || null,
      shakemapUrl,
      mapUrl: latestMapUrl
    };

    const rawDirasakan = dirasakanData?.Infogempa?.gempa || [];
    const dirasakan = rawDirasakan.map((g) => {
      const { latitude, longitude } = parseCoordinates(
        g.Coordinates || `${g.Lintang},${g.Bujur}`
      );

      return {
        tanggal: g.Tanggal,
        jam: g.Jam,
        dateTime: g.DateTime,
        coordinates: g.Coordinates,
        lintang: g.Lintang,
        bujur: g.Bujur,
        latitude,
        longitude,
        magnitudo: g.Magnitude,
        kedalaman: g.Kedalaman,
        wilayah: g.Wilayah,
        dirasakan: g.Dirasakan || null,
        mapUrl: buildMapUrl(latitude, longitude)
      };
    });

    return {
      status: true,
      latest,
      realtime: { totalQuakes: realtimeQuakes.length, quakes: realtimeQuakes },
      dirasakan: { totalQuakes: dirasakan.length, quakes: dirasakan }
    };
  } catch (error) {
    return {
      status: false,
      message: error.message,
      latest: null,
      realtime: { totalQuakes: 0, quakes: [] },
      dirasakan: { totalQuakes: 0, quakes: [] }
    };
  }
}

export default {
  name: "Info Gempa BMKG",
  description: "Informasi gempa bumi terkini — gempa terbaru (autogempa), daftar gempa realtime, dan gempa yang dirasakan (dengan koordinat & peta)",
  category: "Search",
  methods: ["GET", "POST"],
  params: [],
  paramsSchema: {},
  async run(req, res) {
    const result = await getGempa();
    if (!result.status) {
      return res.status(502).json(result);
    }
    return res.json(result);
  }
};