// PDDIKTI Search (Prodi) — native conversion of api/search/prodi.js
// Query langsung ke api-pddikti.kemdiktisaintek.go.id dengan header Origin
// frontend (Node versi pakai CORS proxy; Origin spoof cukup via header).
use axum::{extract::Query, http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::{json, Value};
use std::collections::HashMap;

const API_BASE: &str = "https://api-pddikti.kemdiktisaintek.go.id";
const FRONTEND_ORIGIN: &str = "https://pddikti.kemdiktisaintek.go.id";

fn err(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({"status": false, "message": msg}))).into_response()
}

pub async fn handler(
    Query(query): Query<HashMap<String, String>>,
    body: Option<Json<Value>>,
) -> Response {
    let get_param = |k: &str| -> Option<String> {
        query
            .get(k)
            .cloned()
            .or_else(|| body.as_ref().and_then(|Json(v)| v.get(k).and_then(Value::as_str).map(str::to_string)))
    };

    let mode = get_param("mode").unwrap_or_else(|| "all".to_string()).to_lowercase();
    let mahasiswa_id = get_param("mahasiswaId");
    let search_query = get_param("query").unwrap_or_default().trim().to_string();

    let client = match reqwest::Client::builder()
        
        .build()
    {
        Ok(c) => c,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan data PDDIKTI: {e}")),
    };

    let pddikti_get = |path: String| {
        let client = &client;
        async move {
            client
                .get(format!("{}{}", API_BASE, path))
                            .header("Accept", "application/json")
                .header("Origin", FRONTEND_ORIGIN)
                .header("Referer", FRONTEND_ORIGIN)
                            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .send()
                .await
        }
    };

    if mode == "detail" {
        let mhs_id = match mahasiswa_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(id) => id,
            None => return err(StatusCode::INTERNAL_SERVER_ERROR, "Field 'mahasiswaId' wajib untuk mode 'detail'. Ambil dari hasil search mhs (field 'id')."),
        };
        let res = pddikti_get(format!("/detail/mhs/{}", urlencoding::encode(mhs_id))).await;
        let data: Value = match res {
            Ok(r) if r.status().is_success() => match r.json::<Value>().await {
                Ok(v) => v,
                Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan data PDDIKTI: {e}")),
            },
            Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("PDDIKTI HTTP {}", r.status().as_u16())),
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan data PDDIKTI: {e}")),
        };
        let nama = data.get("nama").and_then(Value::as_str).unwrap_or("");
        let message = if !nama.is_empty() {
            format!(
                "🎓 {} — {} | {} @ {}",
                nama,
                data.get("nim").and_then(Value::as_str).unwrap_or(""),
                data.get("prodi").and_then(Value::as_str).unwrap_or(""),
                data.get("nama_pt").and_then(Value::as_str).unwrap_or("")
            )
        } else {
            "🎓 Detail mahasiswa".to_string()
        };
        let jk = data.get("jenis_kelamin").and_then(Value::as_str);
        let result = json!({
            "message": message,
            "nama": data.get("nama"),
            "nim": data.get("nim"),
            "jenisKelamin": match jk { Some("L") => json!("Laki-laki"), Some("P") => json!("Perempuan"), _ => Value::Null },
            "jenjang": data.get("jenjang"),
            "prodi": data.get("prodi"),
            "kodeProdi": data.get("kode_prodi"),
            "namaPt": data.get("nama_pt"),
            "kodePt": data.get("kode_pt").and_then(Value::as_str).map(|s| s.trim().to_string()),
            "tanggalMasuk": data.get("tanggal_masuk"),
            "jenisDaftar": data.get("jenis_daftar"),
            "statusSaatIni": data.get("status_saat_ini"),
            "idPt": data.get("id_pt"),
            "idProdi": data.get("id_sms"),
            "raw": data,
        });
        return Json(json!({"status": true, "result": result})).into_response();
    }

    if search_query.is_empty() {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Field 'query' wajib (kata kunci pencarian — nama, NIM, NIDN, nama PT, dst).");
    }
    if search_query.len() < 3 {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "Query terlalu pendek (min 3 karakter).");
    }

    let path = match mode.as_str() {
        "all" => format!("/pencarian/all/{}", urlencoding::encode(&search_query)),
        "mhs" | "mahasiswa" => format!("/pencarian/mhs/{}", urlencoding::encode(&search_query)),
        "dosen" => format!("/pencarian/dosen/{}", urlencoding::encode(&search_query)),
        "pt" => format!("/pencarian/pt/{}", urlencoding::encode(&search_query)),
        "prodi" => format!("/pencarian/prodi/{}", urlencoding::encode(&search_query)),
        _ => return err(StatusCode::INTERNAL_SERVER_ERROR, "Unknown mode. Pakai: all | mhs | dosen | pt | prodi | detail"),
    };

    let res = pddikti_get(path).await;
    let data: Value = match res {
        Ok(r) if r.status().is_success() => match r.json::<Value>().await {
            Ok(v) => v,
            Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan data PDDIKTI: {e}")),
        },
        Ok(r) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("PDDIKTI HTTP {}", r.status().as_u16())),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, &format!("Gagal mendapatkan data PDDIKTI: {e}")),
    };

    if mode == "all" && data.is_object() {
        let mhs = data.get("mahasiswa").and_then(Value::as_array).cloned().unwrap_or_default();
        let dosen = data.get("dosen").and_then(Value::as_array).cloned().unwrap_or_default();
        let pt = data.get("pt").and_then(Value::as_array).cloned().unwrap_or_default();
        let prodi = data.get("prodi").and_then(Value::as_array).cloned().unwrap_or_default();
        let total = mhs.len() + dosen.len() + pt.len() + prodi.len();
        let result = json!({
            "message": format!("🔍 {} hasil untuk \"{}\" ({} mhs, {} dosen, {} pt, {} prodi)", total, search_query, mhs.len(), dosen.len(), pt.len(), prodi.len()),
            "query": search_query,
            "totalCount": total,
            "mahasiswa": mhs,
            "dosen": dosen,
            "pt": pt,
            "prodi": prodi,
        });
        return Json(json!({"status": true, "result": result})).into_response();
    }

    let items = data.as_array().cloned().unwrap_or_default();
    let message = if !items.is_empty() {
        format!("🔍 {} hasil {} untuk \"{}\"", items.len(), mode, search_query)
    } else {
        format!("🔍 Gak ada hasil {} untuk \"{}\"", mode, search_query)
    };
    let result = json!({
        "message": message,
        "query": search_query,
        "mode": mode,
        "count": items.len(),
        "results": items,
    });
    Json(json!({"status": true, "result": result})).into_response()
}
