// CekPlat — native conversion of api/tools/cekplat.js
use axum::{
    extract::Query,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};
use std::collections::HashMap;

fn wilayah(code: &str) -> Option<(&str, &str)> {
    Some(match code {
        "A" => ("BANTEN", "Serang, Cilegon, Tangerang"),
        "B" => (
            "DKI JAKARTA",
            "Jakarta, Bekasi, Depok, Tangerang, Tangerang Selatan",
        ),
        "D" => ("JAWA BARAT", "Bandung, Cimahi, Sumedang"),
        "E" => ("JAWA BARAT", "Cirebon, Indramayu, Majalengka, Kuningan"),
        "F" => ("JAWA BARAT", "Bogor, Sukabumi, Cianjur"),
        "G" => ("JAWA TENGAH", "Pekalongan, Pemalang, Batang"),
        "H" => ("JAWA TENGAH", "Semarang, Kendal, Demak"),
        "K" => ("JAWA TENGAH", "Kudus, Jepara, Pati, Rembang"),
        "L" => ("JAWA TIMUR", "Surabaya, Sidoarjo, Gresik"),
        "M" => (
            "JAWA TIMUR",
            "Madura, Bangkalan, Sampang, Pamekasan, Sumenep",
        ),
        "N" => ("JAWA TIMUR", "Malang, Batu, Pasuruan, Probolinggo"),
        "P" => ("JAWA TIMUR", "Jember, Banyuwangi, Bondowoso, Situbondo"),
        "R" => (
            "JAWA TENGAH",
            "Banyumas, Cilacap, Purbalingga, Banjarnegara",
        ),
        "S" => ("JAWA TIMUR", "Bojonegoro, Tuban, Lamongan"),
        "T" => ("JAWA BARAT", "Purwakarta, Subang, Karawang"),
        "W" => ("JAWA TIMUR", "Madiun, Ngawi, Magetan, Ponorogo, Pacitan"),
        "Y" => (
            "JAWA TENGAH",
            "Yogyakarta, Sleman, Bantul, Gunung Kidul, Kulon Progo",
        ),
        "Z" => ("JAWA BARAT", "Garut, Tasikmalaya, Ciamis, Pangandaran"),
        "AB" => ("SUMATERA BARAT", "Padang, Bukittinggi, Payakumbuh"),
        "AD" => ("SUMATERA BARAT", "Solok, Sawahlunto, Sijunjung"),
        "BA" => ("SUMATERA BARAT", "Padang Pariaman"),
        "BB" => ("SUMATERA UTARA", "Medan, Deli Serdang, Binjai"),
        "BD" => ("SUMATERA UTARA", "Tanjung Balai, Asahan, Labuhanbatu"),
        "BE" => (
            "SUMATERA UTARA",
            "Lubuk Pakam, Pematang Siantar, Simalungun",
        ),
        "BG" => ("SUMATERA UTARA", "Kisaran, Batubara, Tanjung Balai"),
        "BH" => ("SUMATERA UTARA", "Tebing Tinggi, Serdang Bedagai"),
        "BK" => ("SUMATERA UTARA", "Dairi, Karo, Pakpak Bharat"),
        "BL" => ("ACEH", "Banda Aceh, Aceh Besar, Pidie, Bireuen"),
        "BM" => ("SUMATERA UTARA", "Nias, Gunungsitoli"),
        "BN" => ("SUMATERA UTARA", "Tapanuli Tengah, Sibolga"),
        "BP" => ("KEPULAUAN RIAU", "Batam, Tanjungpinang, Bintan"),
        "BT" => ("SUMATERA UTARA", "Tapanuli Utara, Toba, Humbang Hasundutan"),
        "DA" => ("KALIMANTAN SELATAN", "Banjarmasin, Banjarbaru"),
        "DB" => ("SULAWESI UTARA", "Manado, Bitung, Minahasa"),
        "DC" => ("SULAWESI BARAT", "Mamuju, Polewali Mandar"),
        "DD" => ("SULAWESI SELATAN", "Makassar, Gowa, Maros, Pangkep"),
        "DE" => ("MALUKU", "Ambon, Maluku Tengah"),
        "DG" => ("MALUKU UTARA", "Ternate, Tidore, Halmahera"),
        "DH" => ("NUSA TENGGARA TIMUR", "Kupang, Timor Tengah"),
        "DK" => ("BALI", "Denpasar, Badung, Gianyar"),
        "DL" => ("SULAWESI UTARA", "Kotamobagu, Bolaang Mongondow"),
        "DM" => ("GORONTALO", "Gorontalo, Bone Bolango"),
        "DN" => ("SULAWESI TENGAH", "Palu, Donggala, Parigi Moutong"),
        "DP" => ("SULAWESI TENGGARA", "Kendari, Konawe, Kolaka"),
        "DR" => ("NUSA TENGGARA BARAT", "Mataram, Lombok Timur, Lombok Barat"),
        "DS" => ("PAPUA", "Jayapura, Biak, Merauke"),
        "DT" => ("PAPUA BARAT", "Manokwari, Sorong, Fakfak"),
        "DW" => ("SULAWESI TENGGARA", "Buton, Muna, Wakatobi"),
        _ => return None,
    })
}

fn vehicle_type(prefix: &str) -> &'static str {
    match prefix {
        "CD" | "CC" => "Kendaraan Korps Diplomatik",
        "RI" | "RF" => "Kendaraan Dinas Pemerintah",
        "RG" => "Kendaraan Angkutan Umum",
        "IH" => "Kendaraan Dinas Instansi",
        _ => "Kendaraan Pribadi",
    }
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get = |k: &str| {
        query.get(k).cloned().or_else(|| {
            body.as_ref()
                .and_then(|b| b.get(k))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
        })
    };

    let plate_raw = match get("plate") {
        Some(p) if !p.trim().is_empty() => p,
        _ => {
            return Json(json!({
                "status": false,
                "message": "Parameter 'plate' wajib diisi",
                "example": {
                    "GET": "/api/tools/cekplat?plate=B%201234%20XYZ",
                    "POST": { "plate": "B 1234 XYZ" }
                }
            }))
            .into_response()
        }
    };

    let plate: String = plate_raw
        .trim()
        .to_uppercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let parts: Vec<&str> = plate.split(' ').collect();
    if parts.len() < 2 {
        return Json(
            json!({"status": false, "message": "Format plat tidak valid. Contoh: B 1234 XYZ"}),
        )
        .into_response();
    }

    let prefix = parts[0];
    if !(1..=2).contains(&prefix.len()) || !prefix.chars().all(|c| c.is_ascii_uppercase()) {
        return Json(json!({"status": false, "message": format!("Kode daerah \"{}\" tidak valid (harus 1-2 huruf)", prefix)})).into_response();
    }
    let number = parts[1];
    if number.is_empty() || !number.chars().all(|c| c.is_ascii_digit()) {
        return Json(json!({"status": false, "message": "Nomor plat harus berupa angka"}))
            .into_response();
    }
    let mut suffix = if parts.len() > 2 { parts[2] } else { "" };
    if !suffix.is_empty()
        && !(1..=3).contains(&suffix.len())
        && !suffix.chars().all(|c| c.is_ascii_uppercase())
    {
        suffix = "";
    }

    match wilayah(prefix) {
        Some((prov, kab)) => Json(json!({
            "status": true,
            "result": {
                "raw": plate,
                "prefix": prefix,
                "number": number,
                "suffix": suffix,
                "province": prov,
                "region": kab,
                "type": vehicle_type(prefix),
            }
        }))
        .into_response(),
        None => Json(json!({"status": false, "message": format!("Kode daerah \"{}\" tidak dikenali", prefix)})).into_response(),
    }
}
