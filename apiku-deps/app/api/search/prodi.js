import axios from "axios";

const CORS_PROXY = "https://cors.rifkyshre.biz.id/";
const API_BASE = "https://api-pddikti.kemdiktisaintek.go.id";
const FRONTEND_ORIGIN = "https://pddikti.kemdiktisaintek.go.id";

async function pddiktiGet(path) {
  const res = await axios.get(`${CORS_PROXY}${API_BASE}${path}`, {
    timeout: 30000,
    validateStatus: () => true,
    headers: {
      Accept: "application/json",
      // Spoof Origin ke frontend asli — API mereka lock origin ke
      // pddikti.kemdiktisaintek.go.id. Default Worker spoof =
      // target host (api-pddikti.*), gak diterima server.
      "X-Cors-Spoof-Origin": FRONTEND_ORIGIN,
    },
  });
  if (res.status !== 200) {
    throw new Error(`PDDIKTI HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 150)}`);
  }
  return res.data;
}

async function pddikti(input) {
  const mode = (input?.mode ?? "all").toLowerCase();
  const query = typeof input?.query === "string" ? input.query.trim() : "";

  // ── Detail mahasiswa ──
  if (mode === "detail") {
    const mhsId = typeof input?.mahasiswaId === "string" ? input.mahasiswaId.trim() : "";
    if (!mhsId) {
      throw new Error("Field 'mahasiswaId' wajib untuk mode 'detail'. Ambil dari hasil search mhs (field 'id').");
    }
    const data = await pddiktiGet(`/detail/mhs/${encodeURIComponent(mhsId)}`);
    const message = data?.nama
      ? `🎓 ${data.nama} — ${data.nim} | ${data.prodi} @ ${data.nama_pt}`
      : "🎓 Detail mahasiswa";
    return {
      message,
      nama: data.nama,
      nim: data.nim,
      jenisKelamin: data.jenis_kelamin === "L" ? "Laki-laki" : data.jenis_kelamin === "P" ? "Perempuan" : null,
      jenjang: data.jenjang,
      prodi: data.prodi,
      kodeProdi: data.kode_prodi,
      namaPt: data.nama_pt,
      kodePt: data.kode_pt?.trim(),
      tanggalMasuk: data.tanggal_masuk,
      jenisDaftar: data.jenis_daftar,
      statusSaatIni: data.status_saat_ini,
      idPt: data.id_pt,
      idProdi: data.id_sms,
      raw: data,
    };
  }

  if (!query) {
    throw new Error("Field 'query' wajib (kata kunci pencarian — nama, NIM, NIDN, nama PT, dst).");
  }
  if (query.length < 3) {
    throw new Error("Query terlalu pendek (min 3 karakter).");
  }

  // ── Search modes ──
  let path;
  switch (mode) {
    case "all":   path = `/pencarian/all/${encodeURIComponent(query)}`; break;
    case "mhs":
    case "mahasiswa":
      path = `/pencarian/mhs/${encodeURIComponent(query)}`; break;
    case "dosen": path = `/pencarian/dosen/${encodeURIComponent(query)}`; break;
    case "pt":    path = `/pencarian/pt/${encodeURIComponent(query)}`; break;
    case "prodi": path = `/pencarian/prodi/${encodeURIComponent(query)}`; break;
    default:
      throw new Error(`Unknown mode '${mode}'. Pakai: all | mhs | dosen | pt | prodi | detail`);
  }

  const data = await pddiktiGet(path);

  // Mode "all" returns object dengan keys mahasiswa/dosen/pt/prodi.
  if (mode === "all" && data && typeof data === "object" && !Array.isArray(data)) {
    const mhs = Array.isArray(data.mahasiswa) ? data.mahasiswa : [];
    const dosen = Array.isArray(data.dosen) ? data.dosen : [];
    const pt = Array.isArray(data.pt) ? data.pt : [];
    const prodi = Array.isArray(data.prodi) ? data.prodi : [];
    const total = mhs.length + dosen.length + pt.length + prodi.length;
    return {
      message: `🔍 ${total} hasil untuk "${query}" (${mhs.length} mhs, ${dosen.length} dosen, ${pt.length} pt, ${prodi.length} prodi)`,
      query,
      totalCount: total,
      mahasiswa: mhs,
      dosen,
      pt,
      prodi,
    };
  }

  // Mode single → array langsung
  const items = Array.isArray(data) ? data : [];
  return {
    message: items.length > 0
      ? `🔍 ${items.length} hasil ${mode} untuk "${query}"`
      : `🔍 Gak ada hasil ${mode} untuk "${query}"`,
    query,
    mode,
    count: items.length,
    results: items,
  };
}

export default {
  name: "PDDIKTI Search",
  description: "Cek data Mahasiswa, Dosen, Perguruan Tinggi, dan Program Studi Indonesia resmi",
  category: "Search",
  methods: ["GET", "POST"],
  params: ["query", "mode", "mahasiswaId"],
  paramsSchema: {
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (nama, NIM, NIDN, singkatan PT, prodi). Wajib jika mode bukan 'detail'."
    },
    mode: {
      type: "string",
      required: false,
      default: "all",
      description: "Mode pencarian ('all', 'mhs', 'dosen', 'pt', 'prodi', 'detail')",
      enum: ["all", "mhs", "mahasiswa", "dosen", "pt", "prodi", "detail"]
    },
    mahasiswaId: {
      type: "string",
      required: false,
      description: "ID Mahasiswa (wajib jika mode adalah 'detail')"
    }
  },

  async run(req, res) {
    const params = { ...req.query, ...req.body };
    const { query, mode, mahasiswaId } = params;

    try {
      const result = await pddikti({ query, mode, mahasiswaId });
      return res.json({
        status: true,
        result
      });
    } catch (err) {
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal mendapatkan data PDDIKTI"
      });
    }
  }
};
