use axum::{extract::State, response::IntoResponse};
use crate::state::AppState;
use super::common::random_game_handler;

const DATA_URL: &str = "https://raw.githubusercontent.com/BochilTeam/database/master/games/susunkata.json";

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    random_game_handler(state, DATA_URL).await
}
