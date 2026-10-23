/**
 * Student ID Card Maker (API Endpoint)
 * Engine & design extracted from DummyLabs (dummylabs.live/doc-gen)
 * Automatically renders a high-resolution Student ID Card image,
 * saves it to the static /files/ directory, and returns the image link in a clean JSON response.
 *
 * @route {GET|POST} /api/maker/students
 *
 * @param {string} [name] - Nama lengkap siswa
 * @param {string} [school] - Nama sekolah / institusi
 * @param {string} [studentId] - Nomor ID / NIS siswa
 * @param {string} [class] - Kelas / section / jurusan
 * @param {string} [rollNo] - Nomor absen / urut
 * @param {string} [dob] - Tanggal lahir
 * @param {string} [blood] - Golongan darah (A+, B+, O+, AB+, dll)
 * @param {string} [guardian] - Nama orang tua / wali
 * @param {string} [contact] - Nomor telepon kontak
 * @param {string} [address] - Alamat sekolah / siswa
 * @param {string} [valid] - Masa berlaku kartu (contoh: 2026-2027)
 * @param {string} [photo] - URL foto siswa kustom
 *
 * Category: Maker
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "files");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const PAK_FIRST_NAMES = [
  "Ahmed", "Ali", "Hassan", "Bilal", "Usman", "Omar", "Zain", "Hamza",
  "Saad", "Ibrahim", "Ayesha", "Sara", "Fatima", "Maryam", "Hira", "Zara",
  "Nida", "Aisha", "Iman", "Sana", "Tariq", "Imran", "Khalid", "Junaid"
];

const PAK_LAST_NAMES = [
  "Khan", "Ahmed", "Hassan", "Malik", "Sheikh", "Raza", "Iqbal", "Butt",
  "Chaudhry", "Siddiqui", "Qureshi", "Abbasi", "Rashid", "Tariq", "Hussain",
  "Mehmood", "Akhtar"
];

const SCHOOLS = [
  "Greenfield High School", "Beaconhouse School", "Lahore Grammar School",
  "The City School", "Roots International", "Crescent Public School",
  "Bloomfield Hall", "Headstart Academy"
];

const ROADS = [
  "Park Avenue", "Mall Road", "Jail Road", "Ferozepur Road",
  "Cavalry Ground", "Gulberg Boulevard", "Model Town", "Liberty Market",
  "Garden Town", "Canal Road"
];

const CITIES = [
  "Lahore", "Karachi", "Islamabad", "Rawalpindi", "Faisalabad",
  "Multan", "Peshawar", "Sialkot"
];

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pad(num, len) {
  return String(num).padStart(len, "0");
}

function generateRandomStudentData() {
  const pFirst = pick(PAK_FIRST_NAMES);
  const pLast = pick(PAK_LAST_NAMES);
  const pFather = pick(PAK_FIRST_NAMES);
  const fullName = `${pFirst} ${pLast}`;
  const fatherName = `${pFather} ${pLast}`;
  const school = pick(SCHOOLS);
  const city = pick(CITIES);
  const address = `${randInt(1, 300)} ${pick(ROADS)}, ${city}`;
  const contact = `+92 3${randInt(0, 9)}${randInt(0, 9)} ${randInt(1000000, 9999999)}`;

  const dobDay = randInt(1, 28);
  const dobMonth = pick(MONTHS);
  const dobYear = randInt(2008, 2012);
  const dob = `${dobDay} ${dobMonth} ${dobYear}`;

  const currentYear = new Date().getFullYear();
  const validYear = `${currentYear}-${currentYear + 1}`;

  const grade = randInt(7, 12);
  const section = pick(["A", "B", "C", "D"]);

  return {
    school,
    address,
    name: fullName,
    studentId: `STU-${currentYear}-${pad(randInt(1, 9999), 4)}`,
    class: `Grade ${grade}-${section}`,
    rollNo: String(randInt(1, 60)),
    dob,
    blood: pick(BLOOD_GROUPS),
    guardian: fatherName,
    contact,
    valid: validYear
  };
}

/**
 * Render Student ID Card ke Image Buffer menggunakan Canvas
 */
async function renderStudentCardImage(student, photoUrl) {
  const width = 600;
  const height = 360;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const primary = "#0ea5e9";
  const secondary = "#0369a1";

  // Card boundary dengan rounded corners
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 16);
  ctx.clip();

  // White base background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Left sidebar (width: 210px) dengan linear gradient
  const grad = ctx.createLinearGradient(0, 0, 210, 360);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, secondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 210, height);

  // Year badge (top right of sidebar)
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  ctx.roundRect(140, 12, 55, 20, 4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  const yearText = (student.valid || "2026-2027").split("-")[0];
  ctx.fillText(yearText, 167, 26);

  // Header Title
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("STUDENT ID", 105, 30);

  // Student Photo Container
  const photoX = 35;
  const photoY = 46;
  const photoW = 140;
  const photoH = 175;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(photoX - 4, photoY - 4, photoW + 8, photoH + 8, 8);
  ctx.fill();

  let photoLoaded = false;
  if (photoUrl) {
    try {
      const img = await loadImage(photoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(photoX, photoY, photoW, photoH, 6);
      ctx.clip();
      ctx.drawImage(img, photoX, photoY, photoW, photoH);
      ctx.restore();
      photoLoaded = true;
    } catch (e) {
      photoLoaded = false;
    }
  }

  if (!photoLoaded) {
    // Fallback silhouette
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.roundRect(photoX, photoY, photoW, photoH, 6);
    ctx.fill();
    ctx.fillStyle = "#64748b";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PHOTO", 105, 140);
  }

  // Barcode / QR Box
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.roundRect(80, 238, 50, 50, 4);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 8px monospace";
  ctx.textAlign = "center";
  ctx.fillText("QR CODE", 105, 266);

  // Student ID di bawah foto
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText(student.studentId || "STU-2026-0001", 105, 310);

  // ================= RIGHT SIDE CONTENT =================
  ctx.textAlign = "left";

  // School Name
  ctx.fillStyle = "#64748b";
  ctx.font = "bold 10px sans-serif";
  ctx.fillText((student.school || "School Name").toUpperCase(), 235, 35);

  // Student Name
  ctx.fillStyle = primary;
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(student.name || "Student Name", 235, 62);

  // Class & Roll No
  ctx.fillStyle = "#475569";
  ctx.font = "11px sans-serif";
  ctx.fillText(`${student.class || "Class"}  •  Roll ${student.rollNo || "-"}`, 235, 80);

  // Fields Table
  const fields = [
    ["Student ID", student.studentId],
    ["Date of Birth", student.dob],
    ["Blood Group", student.blood],
    ["Guardian", student.guardian],
    ["Contact", student.contact],
    ["Valid Thru", student.valid]
  ];

  const col1X = 235;
  const col2X = 415;
  let startY = 112;

  for (let i = 0; i < fields.length; i += 2) {
    const [k1, v1] = fields[i];
    const [k2, v2] = fields[i + 1] || [];

    // Col 1
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px sans-serif";
    ctx.fillText(k1.toUpperCase(), col1X, startY);
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(v1 || "—", col1X, startY + 14);

    // Col 2
    if (k2) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px sans-serif";
      ctx.fillText(k2.toUpperCase(), col2X, startY);
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(v2 || "—", col2X, startY + 14);
    }

    startY += 34;
  }

  // Address
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px sans-serif";
  ctx.fillText("ADDRESS", col1X, 230);
  ctx.fillStyle = "#475569";
  ctx.font = "10px sans-serif";
  ctx.fillText(student.address || "—", col1X, 244);

  // Signature line at bottom right
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(430, 310);
  ctx.lineTo(550, 310);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font = "italic 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Principal Signature", 490, 324);

  // Bottom gradient accent bar
  const bottomBar = ctx.createLinearGradient(210, 354, width, 360);
  bottomBar.addColorStop(0, primary);
  bottomBar.addColorStop(1, secondary);
  ctx.fillStyle = bottomBar;
  ctx.fillRect(210, 354, width - 210, 6);

  ctx.restore();

  // Export buffer sebagai JPEG kualitas tinggi (95%)
  return canvas.toBuffer("image/jpeg", 95);
}

export default {
  name: "Student ID Card Maker",
  description: "Generate kartu identitas pelajar / Student ID Card (DummyLabs Engine) dan otomatis menyimpan file gambar ke /files/ serta mengembalikan URL gambar dalam respon JSON.",
  category: "Maker",
  methods: ["GET", "POST"],
  params: [
    "name",
    "school",
    "studentId",
    "class",
    "rollNo",
    "dob",
    "blood",
    "guardian",
    "contact",
    "address",
    "valid",
    "photo"
  ],

  paramsSchema: {
    name: {
      type: "string",
      required: false,
      description: "Nama lengkap siswa",
      example: "Ahmed Hassan"
    },
    school: {
      type: "string",
      required: false,
      description: "Nama institusi / sekolah",
      example: "Greenfield High School"
    },
    studentId: {
      type: "string",
      required: false,
      description: "Nomor ID siswa",
      example: "STU-2026-0142"
    },
    class: {
      type: "string",
      required: false,
      description: "Kelas atau seksi siswa",
      example: "Grade 10-B"
    },
    rollNo: {
      type: "string",
      required: false,
      description: "Nomor urut / absen",
      example: "23"
    },
    dob: {
      type: "string",
      required: false,
      description: "Tanggal lahir siswa",
      example: "15 March 2010"
    },
    blood: {
      type: "string",
      required: false,
      description: "Golongan darah (A+, B+, O+, AB+, dll)",
      example: "O+"
    },
    guardian: {
      type: "string",
      required: false,
      description: "Nama orang tua / wali",
      example: "Muhammad Hassan"
    },
    contact: {
      type: "string",
      required: false,
      description: "Nomor kontak telepon",
      example: "+92 300 1234567"
    },
    address: {
      type: "string",
      required: false,
      description: "Alamat sekolah / tempat tinggal",
      example: "12 Park Avenue, Lahore"
    },
    valid: {
      type: "string",
      required: false,
      description: "Tahun berlaku kartu",
      example: "2026-2027"
    },
    photo: {
      type: "string",
      required: false,
      description: "URL foto profil siswa kustom",
      example: "https://randomuser.me/api/portraits/men/42.jpg"
    }
  },

  async run(req, res) {
    try {
      const inputs = { ...req.query, ...req.body };

      // 1. Generate base random student data
      const baseData = generateRandomStudentData();

      // 2. Override dengan parameter custom jika ada
      const studentData = {
        school: inputs.school?.trim() || baseData.school,
        address: inputs.address?.trim() || baseData.address,
        name: inputs.name?.trim() || baseData.name,
        studentId: inputs.studentId?.trim() || inputs.studentid?.trim() || baseData.studentId,
        class: inputs.class?.trim() || baseData.class,
        rollNo: inputs.rollNo?.trim() || inputs.rollno?.trim() || baseData.rollNo,
        dob: inputs.dob?.trim() || baseData.dob,
        blood: inputs.blood?.trim() || baseData.blood,
        guardian: inputs.guardian?.trim() || baseData.guardian,
        contact: inputs.contact?.trim() || baseData.contact,
        valid: inputs.valid?.trim() || baseData.valid
      };

      // 3. Foto profil (custom URL atau auto random portrait)
      let photoUrl = inputs.photo?.trim() || null;
      if (!photoUrl) {
        const avatarGender = Math.random() > 0.5 ? "men" : "women";
        const avatarId = randInt(1, 99);
        photoUrl = `https://randomuser.me/api/portraits/${avatarGender}/${avatarId}.jpg`;
      }

      // 4. Render kartu ke Image Buffer
      const imageBuffer = await renderStudentCardImage(studentData, photoUrl);

      // 5. Tulis / simpan otomatis file ke folder /files/
      const fileId = crypto.randomBytes(8).toString("hex");
      const filename = `student-card-${fileId}.jpg`;
      const filePath = path.join(UPLOAD_DIR, filename);

      await fs.promises.writeFile(filePath, imageBuffer);

      // 6. Set waktu kedaluwarsa 1 menit (auto-delete)
      const EXPIRY_MS = 60 * 1000; // 1 menit
      const expiresAt = new Date(Date.now() + EXPIRY_MS).toISOString();

      const timer = setTimeout(() => {
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            // ignore
          }
        }
      }, EXPIRY_MS);
      if (typeof timer.unref === "function") timer.unref();

      // 7. Buat URL link gambar sama persis seperti tools uploader
      const host = req.get("x-forwarded-host") || req.get("host") || "";
      const isLocal = !host || host.includes("localhost") || host.includes("127.0.0.1");
      const baseUrl = isLocal ? "https://api.zyvor.my.id" : `${req.get("x-forwarded-proto") || "https"}://${host}`;
      const fileUrl = `${baseUrl}/files/${filename}`;

      // 8. Respon API tetap JSON murni
      return res.json({
        status: true,
        card: "Student ID Card",
        url: fileUrl,
        photo: photoUrl,
        expires_in: "1 menit",
        expires_at: expiresAt,
        data: studentData,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error("Student ID Card Maker Error:", err.message);
      return res.status(500).json({
        status: false,
        message: err.message || "Gagal membuat Student ID Card"
      });
    }
  }
};
