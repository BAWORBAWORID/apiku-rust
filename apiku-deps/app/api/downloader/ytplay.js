import yts from 'yt-search';

// URL default pencarian YouTube
const DEFAULT_QUERY = "Pilihan hatiku";

async function ytPlay(query) {
  try {
    if (!query || query.trim() === "") {
      throw new Error("Query pencarian tidak boleh kosong");
    }

    const search = await yts(query);
    const video = search.videos[0];
    
    if (!video) {
      throw new Error(`Video dengan query "${query}" tidak ditemukan`);
    }

    const { title, thumbnail, timestamp, views, ago, url, author } = video;
    const { name } = author;

    return {
      status: true,
      data: {
        title: title,
        author: name,
        author_url: author.url,
        thumbnail: thumbnail,
        duration: timestamp,
        views: formatNumber(views),
        uploaded: ago,
        url: url,
        raw_views: views
      },
      query: query
    };

  } catch (e) {
    throw new Error(`YT Play: ${e.message}`);
  }
}

function formatNumber(num) {
  const suffixes = ['', 'Rb', 'Jt', 'M', 'T'];
  const numString = Math.abs(num).toString();
  const numDigits = numString.length;
  
  if (numDigits <= 3) return numString;

  const suffixIndex = Math.floor((numDigits - 1) / 3);
  let formattedNum = (num / Math.pow(1000, suffixIndex)).toFixed(1);
  if (formattedNum.endsWith('.0')) formattedNum = formattedNum.slice(0, -2);
  
  return formattedNum + suffixes[suffixIndex];
}

export default {
  name: "YouTube Play",
  description: "Mencari video YouTube berdasarkan judul",
  category: "Downloader",
  methods: ["GET", "POST"],
  params: ["query"],
  paramsSchema: {
    query: { 
      type: "string", 
      required: true,
      default: DEFAULT_QUERY,
      description: "Judul video atau kata kunci yang ingin dicari di YouTube"
    }
  },
    
  async run(req, res) {
    try {
      let { query } = req.method === "POST" ? req.body : req.query
      
      // Gunakan default dari paramsSchema jika tidak ada input
      if (!query) {
        query = this.paramsSchema.query.default
      }
      
      if (!query || query.trim() === "") {
        return res.status(400).json({
          status: false,
          message: "Query pencarian wajib diisi",
          default_example: this.paramsSchema.query.default
        })
      }

      const result = await ytPlay(query.trim())
      
      return res.status(200).json({
        status: true,
        ...result,
        download_options: {
          audio: `Gunakan endpoint /ytmp3 dengan parameter url=${result.data.url}`,
          video: `Gunakan endpoint /ytmp4 dengan parameter url=${result.data.url}`
        },
        timestamp: new Date().toISOString()
      })
      
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
        timestamp: new Date().toISOString()
      })
    }
  }
}