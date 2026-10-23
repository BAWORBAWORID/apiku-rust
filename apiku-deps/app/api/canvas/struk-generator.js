import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'

const STORE_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/>
  <path d="M17.8 9.6a2 2 0 0 1-3.6 0 2 2 0 0 1-3.6 0 2 2 0 0 1-3.6 0"/>
  <path d="M3 21h18"/>
  <path d="M4 21V9"/>
  <path d="M20 21V9"/>
  <path d="M4 9h16"/>
  <path d="M5 9l1.2-5h11.6L19 9"/>
  <path d="M10 13h4"/>
</svg>
`

function rupiah(value) {
  return `Rp ${Number(value || 0).toLocaleString('id-ID')}`
}

function angka(value) {
  return Number(value || 0).toLocaleString('id-ID')
}

function waktuSekarang() {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type) => parts.find((p) => p.type === type)?.value

  return {
    tanggal: `${get('year')}-${get('month')}-${get('day')}`,
    jam: `${get('hour')}.${get('minute')}`,
  }
}

function hitungQty(items) {
  return items.reduce((total, item) => total + Number(item.qtyTotal ?? item.qty ?? 0), 0)
}

function hitungTotal(items) {
  return items.reduce((total, item) => total + Number(item.qty || 0) * Number(item.harga || 0), 0)
}

function generateStruk(res, data) {
  const {
    nama,
    alamat,
    kontak,
    kasir,
    pelanggan,
    alamatPelanggan,
    items,
    bayar,
    metodeBayar,
  } = data

  const now = waktuSekarang()
  const lebarKertas = 280
  const margin = 22
  const contentWidth = lebarKertas - margin * 2
  const finalNomorStruk = `No.${Date.now().toString().slice(-6)}`
  const tinggi = Math.max(520, 385 + items.length * 48)

  const doc = new PDFDocument({
    size: [lebarKertas, tinggi],
    margins: { top: 16, bottom: 16, left: margin, right: margin },
  })

  doc.pipe(res)

  const center = (text, options = {}) => {
    doc.text(String(text ?? ''), margin, doc.y, { width: contentWidth, align: 'center', ...options })
  }

  const dashedLine = () => {
    doc.moveDown(0.55)
    const y = doc.y
    doc.save().lineWidth(0.7).dash(4, { space: 4 }).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke().undash().restore()
    doc.moveDown(0.75)
  }

  const infoRow = (left, right) => {
    const y = doc.y
    doc.text(String(left ?? ''), margin, y, { width: contentWidth * 0.45 })
    doc.text(String(right ?? ''), margin + contentWidth * 0.45, y, { width: contentWidth * 0.55, align: 'right' })
    doc.moveDown(0.5)
  }

  const row = (left, right, opts = {}) => {
    const y = doc.y
    doc.text(String(left ?? ''), margin, y, { width: contentWidth * 0.5 })
    doc.text(String(right ?? ''), margin + contentWidth * 0.5, y, { width: contentWidth * 0.5, align: 'right' })
    doc.moveDown(opts.moveDown ?? 0.42)
  }

  // Store icon
  const iconSize = 48
  const iconX = (lebarKertas - iconSize) / 2
  SVGtoPDF(doc, STORE_ICON_SVG, iconX, doc.y, { width: iconSize, height: iconSize, preserveAspectRatio: 'xMidYMid meet' })
  doc.y += iconSize + 9

  // Store info
  doc.font('Helvetica').fontSize(14)
  center(nama)

  doc.font('Helvetica').fontSize(9.5)
  if (alamat) center(alamat)
  if (kontak) center(`No. Telp ${kontak}`)

  dashedLine()

  // Date, cashier, customer
  doc.font('Helvetica').fontSize(10)
  infoRow(now.tanggal, kasir)
  infoRow(now.jam, pelanggan)

  if (alamatPelanggan) {
    doc.text(alamatPelanggan, margin, doc.y, { width: contentWidth, align: 'right' })
    doc.moveDown(0.65)
  }

  doc.text(finalNomorStruk, margin, doc.y, { width: contentWidth })
  dashedLine()

  // Items
  let total = 0
  items.forEach((item, index) => {
    const nama = item.nama || '-'
    const qty = Number(item.qty || 0)
    const satuan = item.satuan || ''
    const harga = Number(item.harga || 0)
    const subtotal = qty * harga
    total += subtotal

    const detail = satuan ? `  ${qty} ${satuan} x ${angka(harga)}` : `  ${qty} x ${angka(harga)}`

    doc.font('Helvetica-Bold').fontSize(10.5)
    doc.text(`${index + 1}. ${nama}`, margin, doc.y, { width: contentWidth })

    const y = doc.y
    doc.font('Helvetica').fontSize(9.5)
    doc.text(detail, margin, y, { width: contentWidth * 0.58 })

    doc.font('Helvetica').fontSize(10.5)
    doc.text(rupiah(subtotal), margin + contentWidth * 0.58, y, { width: contentWidth * 0.42, align: 'right' })

    doc.moveDown(0.75)
  })

  dashedLine()

  const totalQty = hitungQty(items)
  const subTotal = hitungTotal(items)
  const kembali = Number(bayar || 0) - subTotal

  doc.font('Helvetica').fontSize(10)
  doc.text(`Total QTY : ${totalQty}`, margin, doc.y)
  doc.moveDown(1.05)

  doc.font('Helvetica').fontSize(10)
  row('Sub Total', rupiah(subTotal))

  const yTotal = doc.y
  doc.font('Helvetica-Bold').fontSize(12)
  doc.text('Total', margin, yTotal, { width: contentWidth * 0.45 })
  doc.font('Helvetica-Bold').fontSize(14)
  doc.text(rupiah(total), margin + contentWidth * 0.45, yTotal, { width: contentWidth * 0.55, align: 'right' })
  doc.moveDown(0.68)

  doc.font('Helvetica').fontSize(10)
  row(`Bayar (${metodeBayar})`, rupiah(bayar))
  row('Kembali', rupiah(kembali))

  doc.moveDown(1.1)
  doc.font('Helvetica').fontSize(10.5)
  center('Terimakasih Telah Berbelanja')
  doc.moveDown(0.3)
  doc.font('Helvetica').fontSize(8.5)
  center('Simpan struk ini sebagai bukti pembayaran')

  doc.end()

  return { totalQty, subTotal, total, kembali, now, finalNomorStruk }
}

export default {
  name: 'Struk Generator',
  description: 'Generate struk/receipt PDF dengan custom toko, item belanja, pembayaran, dan kembalian',
  category: 'Canvas',
  methods: ['GET', 'POST'],
  params: ['nama', 'alamat', 'kontak', 'kasir', 'pelanggan', 'alamatPelanggan', 'items', 'bayar', 'metodeBayar'],

  paramsSchema: {
    nama: { type: 'string', required: true, description: 'Nama toko', default: 'Toko Saya' },
    alamat: { type: 'string', required: true, description: 'Alamat toko', default: 'Jl. Contoh No. 1, Jakarta' },
    kontak: { type: 'string', required: true, description: 'Nomor telepon/kontak toko', default: '081234567890' },
    kasir: { type: 'string', required: true, description: 'Nama kasir', default: 'Admin' },
    pelanggan: { type: 'string', required: true, description: 'Nama pelanggan', default: 'Budi Santoso' },
    alamatPelanggan: { type: 'string', required: true, description: 'Alamat pelanggan', default: 'Jl. Customer No. 5' },
    items: { type: 'string', required: true, description: 'Item belanja, format: nama,qty,satuan,harga | dipisah pakai "|". Contoh: Indomie,2,pcs,3500|Aqua,1,btl,4000', default: 'Indomie Goreng,2,pcs,3500|Aqua 600ml,1,btl,4000' },
    bayar: { type: 'number', required: true, description: 'Jumlah uang bayar', default: '20000' },
    metodeBayar: { type: 'string', required: true, description: 'Metode pembayaran (contoh: Cash, QRIS, Transfer)', default: 'Cash' },
  },

  async run(req, res) {
    try {
      const input = { ...req.query, ...req.body }

      const nama = input.nama || 'Toko Saya'
      const alamat = input.alamat || 'Jl. Contoh No. 1, Jakarta'
      const kontak = input.kontak || '081234567890'
      const kasir = input.kasir || 'Admin'
      const pelanggan = input.pelanggan || 'Budi Santoso'
      const alamatPelanggan = input.alamatPelanggan || 'Jl. Customer No. 5'
      const bayar = Number(input.bayar || 20000)
      const metodeBayar = input.metodeBayar || 'Cash'

      // Parse items: format "nama,qty,satuan,harga|nama,qty,satuan,harga"
      const rawItems = input.items || 'Indomie Goreng,2,pcs,3500|Aqua 600ml,1,btl,4000'
      const parsedItems = String(rawItems).split('|').map((part, i) => {
        const [n, qty, satuan, harga] = part.split(',').map(s => s?.trim())
        if (!n) return null
        return { nama: n, qty: Number(qty || 1), satuan: satuan || '', harga: Number(harga || 0) }
      }).filter(Boolean)

      if (parsedItems.length === 0) {
        return res.status(400).json({ status: false, message: '"items" tidak boleh kosong. Format: nama,qty,satuan,harga|...' })
      }

      const result = generateStruk(res, {
        nama, alamat, kontak, kasir, pelanggan, alamatPelanggan,
        items: parsedItems,
        bayar: Number(bayar),
        metodeBayar,
      })

      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${result.finalNomorStruk}.pdf"`)
      res.setHeader('X-Struk-Total', String(result.total))
      res.setHeader('X-Struk-Date', result.now.tanggal)
    } catch (error) {
      return res.status(500).json({ status: false, message: error.message })
    }
  },
}
