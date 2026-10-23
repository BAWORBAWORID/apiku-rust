use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use rand::seq::SliceRandom;
use serde::Deserialize;
use serde_json::json;
use crate::state::AppState;

const SUBJECTS: &[(&str, &str)] = &[
    ("bindo", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/bindo.json"),
    ("tik", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/tik.json"),
    ("pkn", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/pkn.json"),
    ("bing", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/bing.json"),
    ("penjas", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/penjas.json"),
    ("pai", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/pai.json"),
    ("matematika", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/matematika.json"),
    ("jawa", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/jawa.json"),
    ("ips", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/ips.json"),
    ("ipa", "https://gist.githubusercontent.com/siputzx/298d2d3bd5901494537b9848e35dab9f/raw/25f5dcfef0d97141c555c2bbb94fe1f3d1f76cb3/ipa.json"),
];

#[derive(Debug, Deserialize)]
pub struct CcSdParams {
    pub matapelajaran: Option<String>,
    pub jumlahsoal: Option<usize>,
}

pub async fn handler(
    State(state): State<AppState>,
    Query(query): Query<CcSdParams>,
    body: Option<Json<CcSdParams>>,
) -> impl IntoResponse {
    let subject_opt = query.matapelajaran
        .or_else(|| body.as_ref().and_then(|b| b.matapelajaran.clone()));

    let subject = match subject_opt {
        Some(s) if !s.trim().is_empty() => s.trim().to_lowercase(),
        _ => {
            let available: Vec<&str> = SUBJECTS.iter().map(|(k, _)| *k).collect();
            return Json(json!({
                "status": false,
                "message": "Parameter 'matapelajaran' wajib diisi",
                "available_subjects": available
            }));
        }
    };

    let subject_url = match SUBJECTS.iter().find(|(k, _)| *k == subject) {
        Some((_, url)) => *url,
        None => {
            let available: Vec<&str> = SUBJECTS.iter().map(|(k, _)| *k).collect();
            return Json(json!({
                "status": false,
                "message": "Mata pelajaran tidak valid",
                "available_subjects": available
            }));
        }
    };

    let num_questions = query.jumlahsoal
        .or_else(|| body.as_ref().and_then(|b| b.jumlahsoal))
        .unwrap_or(5)
        .clamp(5, 10);

    let client = &state.client;
    match client.get(subject_url).send().await {
        Ok(res) => {
            if let Ok(mut questions) = res.json::<Vec<serde_json::Value>>().await {
                if questions.is_empty() {
                    return Json(json!({
                        "status": false,
                        "message": "Tidak ada soal tersedia untuk mata pelajaran ini"
                    }));
                }

                let selected: Vec<serde_json::Value> = {
                    let mut rng = rand::thread_rng();
                    questions.shuffle(&mut rng);
                    questions.into_iter().take(num_questions).collect()
                };

                Json(json!({
                    "status": true,
                    "result": {
                        "matapelajaran": subject,
                        "jumlah_soal": selected.len(),
                        "soal": selected
                    }
                }))
            } else {
                Json(json!({
                    "status": false,
                    "message": "Gagal mem-parsing bank soal"
                }))
            }
        }
        Err(e) => Json(json!({
            "status": false,
            "message": format!("Gagal mengunduh bank soal: {}", e)
        })),
    }
}
