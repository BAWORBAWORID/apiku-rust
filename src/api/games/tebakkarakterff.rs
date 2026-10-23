use axum::{extract::State, response::IntoResponse};
use crate::state::AppState;
use super::common::random_game_handler;

const DATA_URL: &str = "https://raw.githubusercontent.com/siputzx/karakter-freefire/refs/heads/main/data.json";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    random_game_handler(state, DATA_URL).await
}
