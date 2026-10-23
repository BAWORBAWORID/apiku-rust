pub mod ai;
pub mod downloader;
pub mod fun;
pub mod games;
pub mod kalender;
pub mod primbon;
pub mod random;
pub mod search;
pub mod shortlink;
pub mod stalker;
pub mod tools;
pub mod am;
pub mod anime;
pub mod bypass;
pub mod canvas;
pub mod checknumber;
pub mod ephoto;
pub mod hdvidio;
pub mod image;
pub mod imageai;
pub mod imagehd;
pub mod maker;
pub mod movie;
pub mod nsfw;
pub mod payment;
pub mod solve;
pub mod tempmail;
pub mod topup;
pub mod vtuberspace;
pub mod v3;
pub mod v2;
pub mod v1;

use axum::{
    routing::get,
    Router,
};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        // Fun
        .route(
            "/fun/reach-ch-vip",
            get(fun::reach_ch_vip::handler).post(fun::reach_ch_vip::handler),
        )
        .route(
            "/fun/reach-ch",
            get(fun::reach_ch::handler).post(fun::reach_ch::handler),
        )
        .route(
            "/fun/anime-quotes",
            get(fun::anime_quotes::handler).post(fun::anime_quotes::handler),
        )
        .route(
            "/fun/netflix",
            get(fun::netflix::handler).post(fun::netflix::handler),
        )
        .route(
            "/fun/tiktokviewstatus",
            get(fun::tiktokviewstatus::handler).post(fun::tiktokviewstatus::handler),
        )
        .route(
            "/fun/capcut",
            get(fun::capcut::handler).post(fun::capcut::handler),
        )
        .route(
            "/fun/kahoot",
            get(fun::kahoot::handler).post(fun::kahoot::handler),
        )
        .route(
            "/fun/philosopher-quotes",
            get(fun::philosopher_quotes::handler).post(fun::philosopher_quotes::handler),
        )

        // Downloader
        .route(
            "/downloader/capcut",
            get(downloader::capcut::handler).post(downloader::capcut::handler),
        )
        .route(
            "/downloader/tiktok",
            get(downloader::tiktok::handler).post(downloader::tiktok::handler),
        )

        // Stalker
        .route(
            "/stalker/github",
            get(stalker::github::handler).post(stalker::github::handler),
        )
        .route(
            "/stalker/telegram",
            get(stalker::telegram::handler).post(stalker::telegram::handler),
        )
        .route(
            "/stalker/ml",
            get(stalker::ml::handler).post(stalker::ml::handler),
        )
        .route(
            "/stalker/ml-id",
            get(stalker::ml_id::handler).post(stalker::ml_id::handler),
        )
        .route(
            "/stalker/roblox",
            get(stalker::roblox::handler).post(stalker::roblox::handler),
        )
        .route(
            "/stalker/whatsapp",
            get(stalker::whatsapp::handler).post(stalker::whatsapp::handler),
        )

        // Search
        .route(
            "/search/wikipedia",
            get(search::wikipedia::handler).post(search::wikipedia::handler),
        )

        // Primbon
        .route(
            "/primbon/zodiac",
            get(primbon::zodiac::handler).post(primbon::zodiac::handler),
        )
        .route(
            "/primbon/artinama",
            get(primbon::artinama::handler).post(primbon::artinama::handler),
        )
        .route(
            "/primbon/tafsirmimpi",
            get(primbon::tafsirmimpi::handler).post(primbon::tafsirmimpi::handler),
        )
        .route(
            "/primbon/cocokpasangan",
            get(primbon::cocokpasangan::handler).post(primbon::cocokpasangan::handler),
        )
        .route(
            "/primbon/nomorhoki",
            get(primbon::nomorhoki::handler).post(primbon::nomorhoki::handler),
        )
        .route(
            "/primbon/penyakit",
            get(primbon::penyakit::handler).post(primbon::penyakit::handler),
        )
        .route(
            "/primbon/ramalanjodohbali",
            get(primbon::ramalanjodohbali::handler).post(primbon::ramalanjodohbali::handler),
        )
        .route(
            "/primbon/ramaljodoh",
            get(primbon::ramaljodoh::handler).post(primbon::ramaljodoh::handler),
        )
        .route(
            "/primbon/rezekihokiweton",
            get(primbon::rezekihokiweton::handler).post(primbon::rezekihokiweton::handler),
        )
        .route(
            "/primbon/sifatusaha",
            get(primbon::sifatusaha::handler).post(primbon::sifatusaha::handler),
        )

        // Tools
        .route(
            "/tools/whois",
            get(tools::whois::handler),
        )
        .route(
            "/tools/hash",
            get(tools::hash::handler).post(tools::hash::handler),
        )
        .route(
            "/tools/uuid",
            get(tools::uuid::handler).post(tools::uuid::handler),
        )
        .route(
            "/tools/timestamp",
            get(tools::timestamp::handler).post(tools::timestamp::handler),
        )
        .route(
            "/tools/useragent",
            get(tools::useragent::handler).post(tools::useragent::handler),
        )
        .route(
            "/tools/binner2text",
            get(tools::binner2text::handler).post(tools::binner2text::handler),
        )
        .route(
            "/tools/teks2binner",
            get(tools::teks2binner::handler).post(tools::teks2binner::handler),
        )
        .route(
            "/tools/crypto-price",
            get(tools::crypto_price::handler).post(tools::crypto_price::handler),
        )
        .route(
            "/tools/cuaca-bmkg",
            get(tools::cuaca_bmkg::handler).post(tools::cuaca_bmkg::handler),
        )

        // Games
        .route(
            "/games/tebakan",
            get(games::tebakan::handler).post(games::tebakan::handler),
        )
        .route(
            "/games/caklontong",
            get(games::caklontong::handler).post(games::caklontong::handler),
        )
        .route(
            "/games/asahotak",
            get(games::asahotak::handler).post(games::asahotak::handler),
        )
        .route(
            "/games/susunkata",
            get(games::susunkata::handler).post(games::susunkata::handler),
        )
        .route(
            "/games/family100",
            get(games::family100::handler).post(games::family100::handler),
        )
        .route(
            "/games/tekateki",
            get(games::tekateki::handler).post(games::tekateki::handler),
        )
        .route(
            "/games/tebakgambar",
            get(games::tebakgambar::handler).post(games::tebakgambar::handler),
        )
        .route(
            "/games/tebakbendera",
            get(games::tebakbendera::handler).post(games::tebakbendera::handler),
        )
        .route(
            "/games/tebaksiapa",
            get(games::tebaksiapa::handler).post(games::tebaksiapa::handler),
        )
        .route(
            "/games/math",
            get(games::math::handler).post(games::math::handler),
        )
        .route(
            "/games/lengkapikalimat",
            get(games::lengkapikalimat::handler).post(games::lengkapikalimat::handler),
        )
        .route(
            "/games/tebakbendera2",
            get(games::tebakbendera2::handler).post(games::tebakbendera2::handler),
        )
        .route(
            "/games/tebakgame",
            get(games::tebakgame::handler).post(games::tebakgame::handler),
        )
        .route(
            "/games/tebakjkt48",
            get(games::tebakjkt48::handler).post(games::tebakjkt48::handler),
        )
        .route(
            "/games/tebakkabupaten",
            get(games::tebakkabupaten::handler).post(games::tebakkabupaten::handler),
        )
        .route(
            "/games/tebakkalimat",
            get(games::tebakkalimat::handler).post(games::tebakkalimat::handler),
        )
        .route(
            "/games/tebakkarakterff",
            get(games::tebakkarakterff::handler).post(games::tebakkarakterff::handler),
        )
        .route(
            "/games/tebakkartun",
            get(games::tebakkartun::handler).post(games::tebakkartun::handler),
        )
        .route(
            "/games/tebakkata",
            get(games::tebakkata::handler).post(games::tebakkata::handler),
        )
        .route(
            "/games/tebakkimia",
            get(games::tebakkimia::handler).post(games::tebakkimia::handler),
        )
        .route(
            "/games/tebaklagu",
            get(games::tebaklagu::handler).post(games::tebaklagu::handler),
        )
        .route(
            "/games/tebaklirik",
            get(games::tebaklirik::handler).post(games::tebaklirik::handler),
        )
        .route(
            "/games/tebaklogo",
            get(games::tebaklogo::handler).post(games::tebaklogo::handler),
        )
        .route(
            "/games/tebaksurah",
            get(games::tebaksurah::handler).post(games::tebaksurah::handler),
        )
        .route(
            "/games/tebakwarna",
            get(games::tebakwarna::handler).post(games::tebakwarna::handler),
        )
        .route(
            "/games/cc-sd",
            get(games::cc_sd::handler).post(games::cc_sd::handler),
        )

        // Kalender
        .route(
            "/kalender/hari-ini",
            get(kalender::hari_ini::handler).post(kalender::hari_ini::handler),
        )
        .route(
            "/kalender/hari-libur",
            get(kalender::hari_libur::handler).post(kalender::hari_libur::handler),
        )

        // Random
        .route(
            "/random/waifu",
            get(random::waifu::handler),
        )
        .route(
            "/random/quotesanime",
            get(random::quotesanime::handler),
        )
        .route(
            "/random/blue-archive",
            get(random::blue_archive::handler),
        )
        .route(
            "/random/lahelu",
            get(random::lahelu::handler),
        )
        .route(
            "/random/seegore",
            get(random::seegore::handler),
        )

        // Shortlink
        .route(
            "/shortlink/tinyurl",
            get(shortlink::tinyurl::handler).post(shortlink::tinyurl::handler),
        )
        .route(
            "/shortlink/tinyurlwithalias",
            get(shortlink::tinyurlwithalias::handler).post(shortlink::tinyurlwithalias::handler),
        )
        .route(
            "/shortlink/bitly",
            get(shortlink::bitly::handler).post(shortlink::bitly::handler),
        )
        .route(
            "/shortlink/cuttly",
            get(shortlink::cuttly::handler).post(shortlink::cuttly::handler),
        )
        .route(
            "/shortlink/xmz",
            get(shortlink::xmz::handler).post(shortlink::xmz::handler),
        )

        // AI (35 Endpoints)
        .route("/ai/aichatting", get(ai::aichatting::handler).post(ai::aichatting::handler))
        .route("/ai/aiseek", get(ai::aiseek::handler).post(ai::aiseek::handler))
        .route("/ai/askme", get(ai::askme::handler).post(ai::askme::handler))
        .route("/ai/chatai", get(ai::chatai::handler).post(ai::chatai::handler))
        .route("/ai/chatgpt", get(ai::chatgpt::handler).post(ai::chatgpt::handler))
        .route("/ai/chatgptis", get(ai::chatgptis::handler).post(ai::chatgptis::handler))
        .route("/ai/cloudai", get(ai::cloudai::handler).post(ai::cloudai::handler))
        .route("/ai/deepseek-v3", get(ai::deepseek_v3::handler).post(ai::deepseek_v3::handler))
        .route("/ai/edubrain", get(ai::edubrain::handler).post(ai::edubrain::handler))
        .route("/ai/feelbetter", get(ai::feelbetter::handler).post(ai::feelbetter::handler))
        .route("/ai/freetochat", get(ai::freetochat::handler).post(ai::freetochat::handler))
        .route("/ai/gitreverse", get(ai::gitreverse::handler).post(ai::gitreverse::handler))
        .route("/ai/gpt4o-mini", get(ai::gpt4o_mini::handler).post(ai::gpt4o_mini::handler))
        .route("/ai/gpt4v2", get(ai::gpt4v2::handler).post(ai::gpt4v2::handler))
        .route("/ai/gpt5", get(ai::gpt5::handler).post(ai::gpt5::handler))
        .route("/ai/halodoc", get(ai::halodoc::handler).post(ai::halodoc::handler))
        .route("/ai/heck-ai", get(ai::heck_ai::handler).post(ai::heck_ai::handler))
        .route("/ai/humanizer", get(ai::humanizer::handler).post(ai::humanizer::handler))
        .route("/ai/islamiai", get(ai::islamiai::handler).post(ai::islamiai::handler))
        .route("/ai/luna", get(ai::luna::handler).post(ai::luna::handler))
        .route("/ai/motif", get(ai::motif::handler).post(ai::motif::handler))
        .route("/ai/muslimai", get(ai::muslimai::handler).post(ai::muslimai::handler))
        .route("/ai/notegptv2", get(ai::notegptv2::handler).post(ai::notegptv2::handler))
        .route("/ai/notrack", get(ai::notrack::handler).post(ai::notrack::handler))
        .route("/ai/nova-ai", get(ai::nova_ai::handler).post(ai::nova_ai::handler))
        .route("/ai/olabiba", get(ai::olabiba::handler).post(ai::olabiba::handler))
        .route("/ai/qwen", get(ai::qwen::handler).post(ai::qwen::handler))
        .route("/ai/qwen-coder-v2", get(ai::qwen_coder_v2::handler).post(ai::qwen_coder_v2::handler))
        .route("/ai/strom-ai", get(ai::strom_ai::handler).post(ai::strom_ai::handler))
        .route("/ai/turboseek", get(ai::turboseek::handler).post(ai::turboseek::handler))
        .route("/ai/tutorgpt", get(ai::tutorgpt::handler).post(ai::tutorgpt::handler))
        .route("/ai/unlimited", get(ai::unlimited::handler).post(ai::unlimited::handler))
        .route("/ai/voidchat", get(ai::voidchat::handler).post(ai::voidchat::handler))
        .route("/ai/wormgpt", get(ai::wormgpt::handler).post(ai::wormgpt::handler))
        .route("/ai/zerogpt", get(ai::zerogpt::handler).post(ai::zerogpt::handler))
        // AM
        .route("/am/bulk", get(am::bulk::handler).post(am::bulk::handler))
        .route("/am/bulkv3", get(am::bulkv3::handler).post(am::bulkv3::handler))
        .route("/am/bulkv4", get(am::bulkv4::handler).post(am::bulkv4::handler))
        .route("/am/bulkv5", get(am::bulkv5::handler).post(am::bulkv5::handler))
        .route("/am/preset", get(am::preset::handler).post(am::preset::handler))
        .route("/am/presetv2", get(am::presetv2::handler).post(am::presetv2::handler))
        .route("/am/send", get(am::send::handler).post(am::send::handler))
        .route("/am/sendv2", get(am::sendv2::handler).post(am::sendv2::handler))
        .route("/am/sendv3", get(am::sendv3::handler).post(am::sendv3::handler))
        .route("/am/verifv2", get(am::verifv2::handler).post(am::verifv2::handler))
        .route("/am/verify", get(am::verify::handler).post(am::verify::handler))
        // ANIME
        .route("/anime/anichi", get(anime::anichi::handler).post(anime::anichi::handler))
        .route("/anime/anichin", get(anime::anichin::handler).post(anime::anichin::handler))
        .route("/anime/anichin-help", get(anime::anichin_help::handler).post(anime::anichin_help::handler))
        .route("/anime/animeav1", get(anime::animeav1::handler).post(anime::animeav1::handler))
        .route("/anime/animein", get(anime::animein::handler).post(anime::animein::handler))
        .route("/anime/animexin", get(anime::animexin::handler).post(anime::animexin::handler))
        .route("/anime/animotv", get(anime::animotv::handler).post(anime::animotv::handler))
        .route("/anime/crunchyroll", get(anime::crunchyroll::handler).post(anime::crunchyroll::handler))
        .route("/anime/donghive", get(anime::donghive::handler).post(anime::donghive::handler))
        .route("/anime/drakorid", get(anime::drakorid::handler).post(anime::drakorid::handler))
        .route("/anime/dubbindo", get(anime::dubbindo::handler).post(anime::dubbindo::handler))
        .route("/anime/livechart", get(anime::livechart::handler).post(anime::livechart::handler))
        .route("/anime/samehadaku", get(anime::samehadaku::handler).post(anime::samehadaku::handler))
        .route("/anime/winbu", get(anime::winbu::handler).post(anime::winbu::handler))
        // BYPASS
        .route("/bypass/bypasslink", get(bypass::bypasslink::handler).post(bypass::bypasslink::handler))
        .route("/bypass/bypasslinkv2", get(bypass::bypasslinkv2::handler).post(bypass::bypasslinkv2::handler))
        .route("/bypass/bypasslinkv3", get(bypass::bypasslinkv3::handler).post(bypass::bypasslinkv3::handler))
        .route("/bypass/modjall", get(bypass::modjall::handler).post(bypass::modjall::handler))
        .route("/bypass/move2link", get(bypass::move2link::handler).post(bypass::move2link::handler))
        .route("/bypass/ouo-bypass", get(bypass::ouo_bypass::handler).post(bypass::ouo_bypass::handler))
        .route("/bypass/safelink", get(bypass::safelink::handler).post(bypass::safelink::handler))
        .route("/bypass/shrinkme", get(bypass::shrinkme::handler).post(bypass::shrinkme::handler))
        .route("/bypass/wellbypass", get(bypass::wellbypass::handler).post(bypass::wellbypass::handler))
        .route("/bypass/xmz", get(bypass::xmz::handler).post(bypass::xmz::handler))
        // CANVAS
        .route("/canvas/applemusic", get(canvas::applemusic::handler).post(canvas::applemusic::handler))
        .route("/canvas/boarding-nasa", get(canvas::boarding_nasa::handler).post(canvas::boarding_nasa::handler))
        .route("/canvas/brat", get(canvas::brat::handler).post(canvas::brat::handler))
        .route("/canvas/brat-anime", get(canvas::brat_anime::handler).post(canvas::brat_anime::handler))
        .route("/canvas/brat-gojo", get(canvas::brat_gojo::handler).post(canvas::brat_gojo::handler))
        .route("/canvas/brat-vermeil", get(canvas::brat_vermeil::handler).post(canvas::brat_vermeil::handler))
        .route("/canvas/bratvid-gojo", get(canvas::bratvid_gojo::handler).post(canvas::bratvid_gojo::handler))
        .route("/canvas/bratvid-vermeil", get(canvas::bratvid_vermeil::handler).post(canvas::bratvid_vermeil::handler))
        .route("/canvas/carbon", get(canvas::carbon::handler).post(canvas::carbon::handler))
        .route("/canvas/createlogo", get(canvas::createlogo::handler).post(canvas::createlogo::handler))
        .route("/canvas/drake", get(canvas::drake::handler).post(canvas::drake::handler))
        .route("/canvas/reminder", get(canvas::reminder::handler).post(canvas::reminder::handler))
        .route("/canvas/roblox", get(canvas::roblox::handler).post(canvas::roblox::handler))
        .route("/canvas/sertifikat-tolol", get(canvas::sertifikat_tolol::handler).post(canvas::sertifikat_tolol::handler))
        .route("/canvas/struk-generator", get(canvas::struk_generator::handler).post(canvas::struk_generator::handler))
        .route("/canvas/welcomev1", get(canvas::welcomev1::handler).post(canvas::welcomev1::handler))
        .route("/canvas/welcomev2", get(canvas::welcomev2::handler).post(canvas::welcomev2::handler))
        .route("/canvas/welcomev3", get(canvas::welcomev3::handler).post(canvas::welcomev3::handler))
        .route("/canvas/welcomev4", get(canvas::welcomev4::handler).post(canvas::welcomev4::handler))
        .route("/canvas/wmp", get(canvas::wmp::handler).post(canvas::wmp::handler))
        // CHECKNUMBER
        .route("/checknumber/checkban", get(checknumber::checkban::handler).post(checknumber::checkban::handler))
        .route("/checknumber/checknumber", get(checknumber::checknumber::handler).post(checknumber::checknumber::handler))
        .route("/checknumber/simdopul", get(checknumber::simdopul::handler).post(checknumber::simdopul::handler))
        .route("/checknumber/tricheck", get(checknumber::tricheck::handler).post(checknumber::tricheck::handler))
        .route("/checknumber/xlcheck", get(checknumber::xlcheck::handler).post(checknumber::xlcheck::handler))
        // EPHOTO
        .route("/ephoto/ephoto", get(ephoto::ephoto::handler).post(ephoto::ephoto::handler))
        .route("/ephoto/photooxy", get(ephoto::photooxy::handler).post(ephoto::photooxy::handler))
        .route("/ephoto/textpro", get(ephoto::textpro::handler).post(ephoto::textpro::handler))
        // HDVIDIO
        .route("/hdvidio/ai-upscale-vidio", get(hdvidio::ai_upscale_vidio::handler).post(hdvidio::ai_upscale_vidio::handler))
        .route("/hdvidio/tohd", get(hdvidio::tohd::handler).post(hdvidio::tohd::handler))
        .route("/hdvidio/wink-hd-video", get(hdvidio::wink_hd_video::handler).post(hdvidio::wink_hd_video::handler))
        // IMAGE
        .route("/image/blur", get(image::blur::handler).post(image::blur::handler))
        .route("/image/faceswap", get(image::faceswap::handler).post(image::faceswap::handler))
        .route("/image/gibli", get(image::gibli::handler).post(image::gibli::handler))
        .route("/image/lego", get(image::lego::handler).post(image::lego::handler))
        .route("/image/nanobanana", get(image::nanobanana::handler).post(image::nanobanana::handler))
        .route("/image/nanobanana-lite", get(image::nanobanana_lite::handler).post(image::nanobanana_lite::handler))
        .route("/image/nanobananav2", get(image::nanobananav2::handler).post(image::nanobananav2::handler))
        .route("/image/nanobananav3", get(image::nanobananav3::handler).post(image::nanobananav3::handler))
        .route("/image/nanobananav4", get(image::nanobananav4::handler).post(image::nanobananav4::handler))
        .route("/image/nsfw-check", get(image::nsfw_check::handler).post(image::nsfw_check::handler))
        .route("/image/qwen-edit", get(image::qwen_edit::handler).post(image::qwen_edit::handler))
        .route("/image/removebg", get(image::removebg::handler).post(image::removebg::handler))
        .route("/image/removebgbgv2", get(image::removebgbgv2::handler).post(image::removebgbgv2::handler))
        .route("/image/removewm", get(image::removewm::handler).post(image::removewm::handler))
        .route("/image/removewm-v2", get(image::removewm_v2::handler).post(image::removewm_v2::handler))
        .route("/image/toanimev2", get(image::toanimev2::handler).post(image::toanimev2::handler))
        .route("/image/unblur", get(image::unblur::handler).post(image::unblur::handler))
        .route("/image/unblurv2", get(image::unblurv2::handler).post(image::unblurv2::handler))
        .route("/image/unwatermark", get(image::unwatermark::handler).post(image::unwatermark::handler))
        // IMAGEAI
        .route("/imageai/aiseek", get(imageai::aiseek::handler).post(imageai::aiseek::handler))
        .route("/imageai/bingimg", get(imageai::bingimg::handler).post(imageai::bingimg::handler))
        .route("/imageai/dezgo", get(imageai::dezgo::handler).post(imageai::dezgo::handler))
        .route("/imageai/freeforai", get(imageai::freeforai::handler).post(imageai::freeforai::handler))
        .route("/imageai/gstory", get(imageai::gstory::handler).post(imageai::gstory::handler))
        .route("/imageai/nanobanana", get(imageai::nanobanana::handler).post(imageai::nanobanana::handler))
        .route("/imageai/pollinations", get(imageai::pollinations::handler).post(imageai::pollinations::handler))
        .route("/imageai/quil-image", get(imageai::quil_image::handler).post(imageai::quil_image::handler))
        .route("/imageai/strom-img", get(imageai::strom_img::handler).post(imageai::strom_img::handler))
        .route("/imageai/text2image", get(imageai::text2image::handler).post(imageai::text2image::handler))
        .route("/imageai/text2imgv2", get(imageai::text2imgv2::handler).post(imageai::text2imgv2::handler))
        .route("/imageai/text2imgv3", get(imageai::text2imgv3::handler).post(imageai::text2imgv3::handler))
        // IMAGEHD
        .route("/imagehd/ai-enhance", get(imagehd::ai_enhance::handler).post(imagehd::ai_enhance::handler))
        .route("/imagehd/ai-enhancev2", get(imagehd::ai_enhancev2::handler).post(imagehd::ai_enhancev2::handler))
        .route("/imagehd/ai-enhancev3", get(imagehd::ai_enhancev3::handler).post(imagehd::ai_enhancev3::handler))
        .route("/imagehd/ai-enhancev4", get(imagehd::ai_enhancev4::handler).post(imagehd::ai_enhancev4::handler))
        .route("/imagehd/ai-enhancev5", get(imagehd::ai_enhancev5::handler).post(imagehd::ai_enhancev5::handler))
        .route("/imagehd/ai-enhancev6", get(imagehd::ai_enhancev6::handler).post(imagehd::ai_enhancev6::handler))
        .route("/imagehd/ai-enhancev7", get(imagehd::ai_enhancev7::handler).post(imagehd::ai_enhancev7::handler))
        .route("/imagehd/ai-enhancev8", get(imagehd::ai_enhancev8::handler).post(imagehd::ai_enhancev8::handler))
        .route("/imagehd/clearpng", get(imagehd::clearpng::handler).post(imagehd::clearpng::handler))
        .route("/imagehd/imageupscaler", get(imagehd::imageupscaler::handler).post(imagehd::imageupscaler::handler))
        .route("/imagehd/imgenhance", get(imagehd::imgenhance::handler).post(imagehd::imgenhance::handler))
        .route("/imagehd/nexupscale", get(imagehd::nexupscale::handler).post(imagehd::nexupscale::handler))
        .route("/imagehd/optimole", get(imagehd::optimole::handler).post(imagehd::optimole::handler))
        .route("/imagehd/photoihancer", get(imagehd::photoihancer::handler).post(imagehd::photoihancer::handler))
        .route("/imagehd/remini", get(imagehd::remini::handler).post(imagehd::remini::handler))
        .route("/imagehd/sparkpix", get(imagehd::sparkpix::handler).post(imagehd::sparkpix::handler))
        .route("/imagehd/super-resolution", get(imagehd::super_resolution::handler).post(imagehd::super_resolution::handler))
        .route("/imagehd/upscale", get(imagehd::upscale::handler).post(imagehd::upscale::handler))
        .route("/imagehd/upscalev2", get(imagehd::upscalev2::handler).post(imagehd::upscalev2::handler))
        .route("/imagehd/upscalev3", get(imagehd::upscalev3::handler).post(imagehd::upscalev3::handler))
        .route("/imagehd/webability", get(imagehd::webability::handler).post(imagehd::webability::handler))
        .route("/imagehd/wink-hd", get(imagehd::wink_hd::handler).post(imagehd::wink_hd::handler))
        // MAKER
        .route("/maker/bounty", get(maker::bounty::handler).post(maker::bounty::handler))
        .route("/maker/ektp", get(maker::ektp::handler).post(maker::ektp::handler))
        .route("/maker/fake-afinitas-ml", get(maker::fake_afinitas_ml::handler).post(maker::fake_afinitas_ml::handler))
        .route("/maker/fake-ff", get(maker::fake_ff::handler).post(maker::fake_ff::handler))
        .route("/maker/fake-ml", get(maker::fake_ml::handler).post(maker::fake_ml::handler))
        .route("/maker/fake-nokia", get(maker::fake_nokia::handler).post(maker::fake_nokia::handler))
        .route("/maker/fake-profile-ff", get(maker::fake_profile_ff::handler).post(maker::fake_profile_ff::handler))
        .route("/maker/fake-tele", get(maker::fake_tele::handler).post(maker::fake_tele::handler))
        .route("/maker/fake-tweet", get(maker::fake_tweet::handler).post(maker::fake_tweet::handler))
        .route("/maker/fakebca", get(maker::fakebca::handler).post(maker::fakebca::handler))
        .route("/maker/fakeboard", get(maker::fakeboard::handler).post(maker::fakeboard::handler))
        .route("/maker/fakebook", get(maker::fakebook::handler).post(maker::fakebook::handler))
        .route("/maker/fakecall-andro", get(maker::fakecall_andro::handler).post(maker::fakecall_andro::handler))
        .route("/maker/fakecall-ios", get(maker::fakecall_ios::handler).post(maker::fakecall_ios::handler))
        .route("/maker/fakech", get(maker::fakech::handler).post(maker::fakech::handler))
        .route("/maker/fakedev", get(maker::fakedev::handler).post(maker::fakedev::handler))
        .route("/maker/fakegc", get(maker::fakegc::handler).post(maker::fakegc::handler))
        .route("/maker/fakeig", get(maker::fakeig::handler).post(maker::fakeig::handler))
        .route("/maker/fakeigprofile", get(maker::fakeigprofile::handler).post(maker::fakeigprofile::handler))
        .route("/maker/fakeigprofilev2", get(maker::fakeigprofilev2::handler).post(maker::fakeigprofilev2::handler))
        .route("/maker/fakenote", get(maker::fakenote::handler).post(maker::fakenote::handler))
        .route("/maker/fakenotif", get(maker::fakenotif::handler).post(maker::fakenotif::handler))
        .route("/maker/fakenotifwa", get(maker::fakenotifwa::handler).post(maker::fakenotifwa::handler))
        .route("/maker/igstory", get(maker::igstory::handler).post(maker::igstory::handler))
        .route("/maker/iqc", get(maker::iqc::handler).post(maker::iqc::handler))
        .route("/maker/iqc-dark", get(maker::iqc_dark::handler).post(maker::iqc_dark::handler))
        .route("/maker/iqc-pink", get(maker::iqc_pink::handler).post(maker::iqc_pink::handler))
        .route("/maker/jarvis-meme", get(maker::jarvis_meme::handler).post(maker::jarvis_meme::handler))
        .route("/maker/motivasi", get(maker::motivasi::handler).post(maker::motivasi::handler))
        .route("/maker/nulis", get(maker::nulis::handler).post(maker::nulis::handler))
        .route("/maker/post-ig", get(maker::post_ig::handler).post(maker::post_ig::handler))
        .route("/maker/profilejson", get(maker::profilejson::handler).post(maker::profilejson::handler))
        .route("/maker/qcwa", get(maker::qcwa::handler).post(maker::qcwa::handler))
        .route("/maker/quotecard", get(maker::quotecard::handler).post(maker::quotecard::handler))
        .route("/maker/quotes-anime", get(maker::quotes_anime::handler).post(maker::quotes_anime::handler))
        .route("/maker/resize", get(maker::resize::handler).post(maker::resize::handler))
        .route("/maker/rusdi-quote", get(maker::rusdi_quote::handler).post(maker::rusdi_quote::handler))
        .route("/maker/saldo-dana", get(maker::saldo_dana::handler).post(maker::saldo_dana::handler))
        .route("/maker/saldo-gopay", get(maker::saldo_gopay::handler).post(maker::saldo_gopay::handler))
        .route("/maker/saldo-ovo", get(maker::saldo_ovo::handler).post(maker::saldo_ovo::handler))
        .route("/maker/sertifikat-nasa", get(maker::sertifikat_nasa::handler).post(maker::sertifikat_nasa::handler))
        .route("/maker/students", get(maker::students::handler).post(maker::students::handler))
        .route("/maker/textvideo", get(maker::textvideo::handler).post(maker::textvideo::handler))
        .route("/maker/ttqc", get(maker::ttqc::handler).post(maker::ttqc::handler))
        .route("/maker/twobuttons", get(maker::twobuttons::handler).post(maker::twobuttons::handler))
        .route("/maker/wafat", get(maker::wafat::handler).post(maker::wafat::handler))
        // MOVIE
        .route("/movie/freemovie", get(movie::freemovie::handler).post(movie::freemovie::handler))
        .route("/movie/melolo", get(movie::melolo::handler).post(movie::melolo::handler))
        .route("/movie/moviebox", get(movie::moviebox::handler).post(movie::moviebox::handler))
        .route("/movie/moviezone", get(movie::moviezone::handler).post(movie::moviezone::handler))
        // NSFW
        .route("/nsfw/foot", get(nsfw::foot::handler).post(nsfw::foot::handler))
        .route("/nsfw/masturbation", get(nsfw::masturbation::handler).post(nsfw::masturbation::handler))
        // PAYMENT
        .route("/payment/gopay-history", get(payment::gopay_history::handler).post(payment::gopay_history::handler))
        .route("/payment/gopay-history-auto", get(payment::gopay_history_auto::handler).post(payment::gopay_history_auto::handler))
        .route("/payment/gopay-journal", get(payment::gopay_journal::handler).post(payment::gopay_journal::handler))
        .route("/payment/gopay-login", get(payment::gopay_login::handler).post(payment::gopay_login::handler))
        .route("/payment/gopay-me", get(payment::gopay_me::handler).post(payment::gopay_me::handler))
        .route("/payment/gopay-merchant", get(payment::gopay_merchant::handler).post(payment::gopay_merchant::handler))
        .route("/payment/gopay-payouts", get(payment::gopay_payouts::handler).post(payment::gopay_payouts::handler))
        .route("/payment/gopay-qris", get(payment::gopay_qris::handler).post(payment::gopay_qris::handler))
        .route("/payment/gopay-qris-official-create", get(payment::gopay_qris_official_create::handler).post(payment::gopay_qris_official_create::handler))
        .route("/payment/gopay-qris-official-status", get(payment::gopay_qris_official_status::handler).post(payment::gopay_qris_official_status::handler))
        .route("/payment/gopay-qris-status", get(payment::gopay_qris_status::handler).post(payment::gopay_qris_status::handler))
        .route("/payment/gopay-refresh", get(payment::gopay_refresh::handler).post(payment::gopay_refresh::handler))
        .route("/payment/gopay-token-save", get(payment::gopay_token_save::handler).post(payment::gopay_token_save::handler))
        .route("/payment/gopay-token-status", get(payment::gopay_token_status::handler).post(payment::gopay_token_status::handler))
        .route("/payment/gopay-verif", get(payment::gopay_verif::handler).post(payment::gopay_verif::handler))
        .route("/payment/qris-static", get(payment::qris_static::handler).post(payment::qris_static::handler))
        .route("/payment/qris-static-v2", get(payment::qris_static_v2::handler).post(payment::qris_static_v2::handler))
        .route("/payment/sociabuzz-create", get(payment::sociabuzz_create::handler).post(payment::sociabuzz_create::handler))
        .route("/payment/sociabuzz-status", get(payment::sociabuzz_status::handler).post(payment::sociabuzz_status::handler))
        // SOLVE
        .route("/solve/altcha", get(solve::altcha::handler).post(solve::altcha::handler))
        .route("/solve/cloudflare", get(solve::cloudflare::handler).post(solve::cloudflare::handler))
        .route("/solve/friendly", get(solve::friendly::handler).post(solve::friendly::handler))
        .route("/solve/getsitekey", get(solve::getsitekey::handler).post(solve::getsitekey::handler))
        .route("/solve/linkvertise", get(solve::linkvertise::handler).post(solve::linkvertise::handler))
        .route("/solve/recaptcha-v2", get(solve::recaptcha_v2::handler).post(solve::recaptcha_v2::handler))
        .route("/solve/recaptcha-v3", get(solve::recaptcha_v3::handler).post(solve::recaptcha_v3::handler))
        .route("/solve/turnstile", get(solve::turnstile::handler).post(solve::turnstile::handler))
        .route("/solve/uam", get(solve::uam::handler).post(solve::uam::handler))
        .route("/solve/waf", get(solve::waf::handler).post(solve::waf::handler))
        // TEMPMAIL
        .route("/tempmail/1timetech", get(tempmail::m_1timetech::handler).post(tempmail::m_1timetech::handler))
        .route("/tempmail/akunlama", get(tempmail::akunlama::handler).post(tempmail::akunlama::handler))
        .route("/tempmail/boomlify", get(tempmail::boomlify::handler).post(tempmail::boomlify::handler))
        .route("/tempmail/cybermail", get(tempmail::cybermail::handler).post(tempmail::cybermail::handler))
        .route("/tempmail/emailtick", get(tempmail::emailtick::handler).post(tempmail::emailtick::handler))
        .route("/tempmail/freetempmail", get(tempmail::freetempmail::handler).post(tempmail::freetempmail::handler))
        .route("/tempmail/guerrilla", get(tempmail::guerrilla::handler).post(tempmail::guerrilla::handler))
        .route("/tempmail/imailedu", get(tempmail::imailedu::handler).post(tempmail::imailedu::handler))
        .route("/tempmail/instanttempemail", get(tempmail::instanttempemail::handler).post(tempmail::instanttempemail::handler))
        .route("/tempmail/maildropy", get(tempmail::maildropy::handler).post(tempmail::maildropy::handler))
        .route("/tempmail/mailtm", get(tempmail::mailtm::handler).post(tempmail::mailtm::handler))
        .route("/tempmail/multidomain", get(tempmail::multidomain::handler).post(tempmail::multidomain::handler))
        .route("/tempmail/onesec-mail", get(tempmail::onesec_mail::handler).post(tempmail::onesec_mail::handler))
        .route("/tempmail/tempamail", get(tempmail::tempamail::handler).post(tempmail::tempamail::handler))
        .route("/tempmail/tempmailchat", get(tempmail::tempmailchat::handler).post(tempmail::tempmailchat::handler))
        .route("/tempmail/tempmailing", get(tempmail::tempmailing::handler).post(tempmail::tempmailing::handler))
        .route("/tempmail/tempmailio", get(tempmail::tempmailio::handler).post(tempmail::tempmailio::handler))
        .route("/tempmail/tempmailplus", get(tempmail::tempmailplus::handler).post(tempmail::tempmailplus::handler))
        .route("/tempmail/temporarymail", get(tempmail::temporarymail::handler).post(tempmail::temporarymail::handler))
        .route("/tempmail/temptf", get(tempmail::temptf::handler).post(tempmail::temptf::handler))
        .route("/tempmail/tmailor", get(tempmail::tmailor::handler).post(tempmail::tmailor::handler))
        // TOPUP
        .route("/topup/cek", get(topup::cek::handler).post(topup::cek::handler))
        .route("/topup/dana", get(topup::dana::handler).post(topup::dana::handler))
        .route("/topup/ff", get(topup::ff::handler).post(topup::ff::handler))
        .route("/topup/ml", get(topup::ml::handler).post(topup::ml::handler))
        .route("/topup/unipin", get(topup::unipin::handler).post(topup::unipin::handler))
        // VTUBERSPACE
        .route("/vtuberspace/agencies", get(vtuberspace::agencies::handler).post(vtuberspace::agencies::handler))
        .route("/vtuberspace/debuts", get(vtuberspace::debuts::handler).post(vtuberspace::debuts::handler))
        .route("/vtuberspace/home", get(vtuberspace::home::handler).post(vtuberspace::home::handler))
        .route("/vtuberspace/news", get(vtuberspace::news::handler).post(vtuberspace::news::handler))
        .route("/vtuberspace/news-categories", get(vtuberspace::news_categories::handler).post(vtuberspace::news_categories::handler))
        .route("/vtuberspace/news-detail", get(vtuberspace::news_detail::handler).post(vtuberspace::news_detail::handler))
        .route("/vtuberspace/news-latest", get(vtuberspace::news_latest::handler).post(vtuberspace::news_latest::handler))
        .route("/vtuberspace/news-popular", get(vtuberspace::news_popular::handler).post(vtuberspace::news_popular::handler))
        .route("/vtuberspace/news-search", get(vtuberspace::news_search::handler).post(vtuberspace::news_search::handler))
        .route("/vtuberspace/news-tags", get(vtuberspace::news_tags::handler).post(vtuberspace::news_tags::handler))
        .route("/vtuberspace/vtuber-detail", get(vtuberspace::vtuber_detail::handler).post(vtuberspace::vtuber_detail::handler))
        .route("/vtuberspace/vtuber-search", get(vtuberspace::vtuber_search::handler).post(vtuberspace::vtuber_search::handler))
        .route("/vtuberspace/vtubers", get(vtuberspace::vtubers::handler).post(vtuberspace::vtubers::handler))
        .route("/vtuberspace/youtube-avatar", get(vtuberspace::youtube_avatar::handler).post(vtuberspace::youtube_avatar::handler))
        // STALKER
        .route("/stalker/deepsearch", get(stalker::deepsearch::handler).post(stalker::deepsearch::handler))
        .route("/stalker/freefire", get(stalker::freefire::handler).post(stalker::freefire::handler))
        .route("/stalker/getcontact", get(stalker::getcontact::handler).post(stalker::getcontact::handler))
        .route("/stalker/instagram", get(stalker::instagram::handler).post(stalker::instagram::handler))
        .route("/stalker/tiktok", get(stalker::tiktok::handler).post(stalker::tiktok::handler))
        .route("/stalker/x", get(stalker::x::handler).post(stalker::x::handler))
        .route("/stalker/youtube", get(stalker::youtube::handler).post(stalker::youtube::handler))
        // SEARCH
        .route("/search/4kwallpapers", get(search::m_4kwallpapers::handler).post(search::m_4kwallpapers::handler))
        .route("/search/7reels", get(search::m_7reels::handler).post(search::m_7reels::handler))
        .route("/search/8daudio", get(search::m_8daudio::handler).post(search::m_8daudio::handler))
        .route("/search/anime", get(search::anime::handler).post(search::anime::handler))
        .route("/search/apkcombo", get(search::apkcombo::handler).post(search::apkcombo::handler))
        .route("/search/bacakomik", get(search::bacakomik::handler).post(search::bacakomik::handler))
        .route("/search/bgn", get(search::bgn::handler).post(search::bgn::handler))
        .route("/search/bilibili", get(search::bilibili::handler).post(search::bilibili::handler))
        .route("/search/cekbansos", get(search::cekbansos::handler).post(search::cekbansos::handler))
        .route("/search/cinesubz", get(search::cinesubz::handler).post(search::cinesubz::handler))
        .route("/search/cookpad", get(search::cookpad::handler).post(search::cookpad::handler))
        .route("/search/dapodik", get(search::dapodik::handler).post(search::dapodik::handler))
        .route("/search/douyin-search", get(search::douyin_search::handler).post(search::douyin_search::handler))
        .route("/search/duckduckgo", get(search::duckduckgo::handler).post(search::duckduckgo::handler))
        .route("/search/flac", get(search::flac::handler).post(search::flac::handler))
        .route("/search/gempa", get(search::gempa::handler).post(search::gempa::handler))
        .route("/search/genius", get(search::genius::handler).post(search::genius::handler))
        .route("/search/goal", get(search::goal::handler).post(search::goal::handler))
        .route("/search/ipa-pelajaran", get(search::ipa_pelajaran::handler).post(search::ipa_pelajaran::handler))
        .route("/search/jadwal-sepakbola", get(search::jadwal_sepakbola::handler).post(search::jadwal_sepakbola::handler))
        .route("/search/jadwalbola", get(search::jadwalbola::handler).post(search::jadwalbola::handler))
        .route("/search/jadwaltv", get(search::jadwaltv::handler).post(search::jadwaltv::handler))
        .route("/search/kodepos", get(search::kodepos::handler).post(search::kodepos::handler))
        .route("/search/lazada", get(search::lazada::handler).post(search::lazada::handler))
        .route("/search/livescore", get(search::livescore::handler).post(search::livescore::handler))
        .route("/search/mangadex", get(search::mangadex::handler).post(search::mangadex::handler))
        .route("/search/manhwaindo", get(search::manhwaindo::handler).post(search::manhwaindo::handler))
        .route("/search/manhwaland", get(search::manhwaland::handler).post(search::manhwaland::handler))
        .route("/search/mcpedl", get(search::mcpedl::handler).post(search::mcpedl::handler))
        .route("/search/moviedetail", get(search::moviedetail::handler).post(search::moviedetail::handler))
        .route("/search/murotal-quran", get(search::murotal_quran::handler).post(search::murotal_quran::handler))
        .route("/search/musixmatch", get(search::musixmatch::handler).post(search::musixmatch::handler))
        .route("/search/nasa", get(search::nasa::handler).post(search::nasa::handler))
        .route("/search/nowsecure", get(search::nowsecure::handler).post(search::nowsecure::handler))
        .route("/search/otakudesu", get(search::otakudesu::handler).post(search::otakudesu::handler))
        .route("/search/pinterest", get(search::pinterest::handler).post(search::pinterest::handler))
        .route("/search/pinvid-search", get(search::pinvid_search::handler).post(search::pinvid_search::handler))
        .route("/search/playstore", get(search::playstore::handler).post(search::playstore::handler))
        .route("/search/prodi", get(search::prodi::handler).post(search::prodi::handler))
        .route("/search/search-song", get(search::search_song::handler).post(search::search_song::handler))
        .route("/search/sigstick", get(search::sigstick::handler).post(search::sigstick::handler))
        .route("/search/sinopsis", get(search::sinopsis::handler).post(search::sinopsis::handler))
        .route("/search/soundcloud", get(search::soundcloud::handler).post(search::soundcloud::handler))
        .route("/search/spotify", get(search::spotify::handler).post(search::spotify::handler))
        .route("/search/spotifyv2", get(search::spotifyv2::handler).post(search::spotifyv2::handler))
        .route("/search/tiktok-search", get(search::tiktok_search::handler).post(search::tiktok_search::handler))
        .route("/search/tokusatsu", get(search::tokusatsu::handler).post(search::tokusatsu::handler))
        .route("/search/voratoon", get(search::voratoon::handler).post(search::voratoon::handler))
        .route("/search/webtoon", get(search::webtoon::handler).post(search::webtoon::handler))
        .route("/search/youtube-search", get(search::youtube_search::handler).post(search::youtube_search::handler))
        .route("/search/ytscrape", get(search::ytscrape::handler).post(search::ytscrape::handler))
        // TOOLS
        .route("/tools/aidetect", get(tools::aidetect::handler).post(tools::aidetect::handler))
        .route("/tools/ccgenerator", get(tools::ccgenerator::handler).post(tools::ccgenerator::handler))
        .route("/tools/cekplat", get(tools::cekplat::handler).post(tools::cekplat::handler))
        .route("/tools/cloneweb", get(tools::cloneweb::handler).post(tools::cloneweb::handler))
        .route("/tools/crypto", get(tools::crypto::handler).post(tools::crypto::handler))
        .route("/tools/dummylabs", get(tools::dummylabs::handler).post(tools::dummylabs::handler))
        .route("/tools/ekycpro", get(tools::ekycpro::handler).post(tools::ekycpro::handler))
        .route("/tools/encrypt", get(tools::encrypt::handler).post(tools::encrypt::handler))
        .route("/tools/fakedata", get(tools::fakedata::handler).post(tools::fakedata::handler))
        .route("/tools/font", get(tools::font::handler).post(tools::font::handler))
        .route("/tools/html2img", get(tools::html2img::handler).post(tools::html2img::handler))
        .route("/tools/ilovepdf", get(tools::ilovepdf::handler).post(tools::ilovepdf::handler))
        .route("/tools/kodepos", get(tools::kodepos::handler).post(tools::kodepos::handler))
        .route("/tools/ngl-spam", get(tools::ngl_spam::handler).post(tools::ngl_spam::handler))
        .route("/tools/nikparse", get(tools::nikparse::handler).post(tools::nikparse::handler))
        .route("/tools/ocr", get(tools::ocr::handler).post(tools::ocr::handler))
        .route("/tools/password-generator", get(tools::password_generator::handler).post(tools::password_generator::handler))
        .route("/tools/proxy", get(tools::proxy::handler).post(tools::proxy::handler))
        .route("/tools/proxy2", get(tools::proxy2::handler).post(tools::proxy2::handler))
        .route("/tools/qr2text", get(tools::qr2text::handler).post(tools::qr2text::handler))
        .route("/tools/qris-info", get(tools::qris_info::handler).post(tools::qris_info::handler))
        .route("/tools/scanweb", get(tools::scanweb::handler).post(tools::scanweb::handler))
        .route("/tools/spam-otp", get(tools::spam_otp::handler).post(tools::spam_otp::handler))
        .route("/tools/ssweb", get(tools::ssweb::handler).post(tools::ssweb::handler))
        .route("/tools/sub4unlock", get(tools::sub4unlock::handler).post(tools::sub4unlock::handler))
        .route("/tools/text2qr", get(tools::text2qr::handler).post(tools::text2qr::handler))
        .route("/tools/top4top", get(tools::top4top::handler).post(tools::top4top::handler))
        .route("/tools/trackip", get(tools::trackip::handler).post(tools::trackip::handler))
        .route("/tools/translate", get(tools::translate::handler).post(tools::translate::handler))
        .route("/tools/upload", get(tools::upload::handler).post(tools::upload::handler))
        .route("/tools/upload-v3", get(tools::upload_v3::handler).post(tools::upload_v3::handler))
        .route("/tools/upload2", get(tools::upload2::handler).post(tools::upload2::handler))
        .route("/tools/vccgen", get(tools::vccgen::handler).post(tools::vccgen::handler))
        .route("/tools/web2apk", get(tools::web2apk::handler).post(tools::web2apk::handler))
        .route("/tools/zippyshare", get(tools::zippyshare::handler).post(tools::zippyshare::handler))
        // DOWNLOADER
        .route("/downloader/7reels", get(downloader::m_7reels::handler).post(downloader::m_7reels::handler))
        .route("/downloader/9xbuddy", get(downloader::m_9xbuddy::handler).post(downloader::m_9xbuddy::handler))
        .route("/downloader/allinone", get(downloader::allinone::handler).post(downloader::allinone::handler))
        .route("/downloader/allinonev2", get(downloader::allinonev2::handler).post(downloader::allinonev2::handler))
        .route("/downloader/allinonev3", get(downloader::allinonev3::handler).post(downloader::allinonev3::handler))
        .route("/downloader/allinonev4", get(downloader::allinonev4::handler).post(downloader::allinonev4::handler))
        .route("/downloader/apkmody", get(downloader::apkmody::handler).post(downloader::apkmody::handler))
        .route("/downloader/applemusic", get(downloader::applemusic::handler).post(downloader::applemusic::handler))
        .route("/downloader/capcutv2", get(downloader::capcutv2::handler).post(downloader::capcutv2::handler))
        .route("/downloader/deezer", get(downloader::deezer::handler).post(downloader::deezer::handler))
        .route("/downloader/drama", get(downloader::drama::handler).post(downloader::drama::handler))
        .route("/downloader/facebook", get(downloader::facebook::handler).post(downloader::facebook::handler))
        .route("/downloader/flac", get(downloader::flac::handler).post(downloader::flac::handler))
        .route("/downloader/frama", get(downloader::frama::handler).post(downloader::frama::handler))
        .route("/downloader/gdrive", get(downloader::gdrive::handler).post(downloader::gdrive::handler))
        .route("/downloader/getdl", get(downloader::getdl::handler).post(downloader::getdl::handler))
        .route("/downloader/gtw", get(downloader::gtw::handler).post(downloader::gtw::handler))
        .route("/downloader/igexport", get(downloader::igexport::handler).post(downloader::igexport::handler))
        .route("/downloader/instaloadr", get(downloader::instaloadr::handler).post(downloader::instaloadr::handler))
        .route("/downloader/insvid", get(downloader::insvid::handler).post(downloader::insvid::handler))
        .route("/downloader/lk21", get(downloader::lk21::handler).post(downloader::lk21::handler))
        .route("/downloader/lk21v2", get(downloader::lk21v2::handler).post(downloader::lk21v2::handler))
        .route("/downloader/mcpelife", get(downloader::mcpelife::handler).post(downloader::mcpelife::handler))
        .route("/downloader/mediafire", get(downloader::mediafire::handler).post(downloader::mediafire::handler))
        .route("/downloader/mediafirev2", get(downloader::mediafirev2::handler).post(downloader::mediafirev2::handler))
        .route("/downloader/meganz", get(downloader::meganz::handler).post(downloader::meganz::handler))
        .route("/downloader/omnify", get(downloader::omnify::handler).post(downloader::omnify::handler))
        .route("/downloader/pinterest", get(downloader::pinterest::handler).post(downloader::pinterest::handler))
        .route("/downloader/pinterest-dl", get(downloader::pinterest_dl::handler).post(downloader::pinterest_dl::handler))
        .route("/downloader/pinvid", get(downloader::pinvid::handler).post(downloader::pinvid::handler))
        .route("/downloader/rednote", get(downloader::rednote::handler).post(downloader::rednote::handler))
        .route("/downloader/savefrom", get(downloader::savefrom::handler).post(downloader::savefrom::handler))
        .route("/downloader/savefromins", get(downloader::savefromins::handler).post(downloader::savefromins::handler))
        .route("/downloader/savetube", get(downloader::savetube::handler).post(downloader::savetube::handler))
        .route("/downloader/saveus", get(downloader::saveus::handler).post(downloader::saveus::handler))
        .route("/downloader/snapany", get(downloader::snapany::handler).post(downloader::snapany::handler))
        .route("/downloader/snapinsta", get(downloader::snapinsta::handler).post(downloader::snapinsta::handler))
        .route("/downloader/spotify", get(downloader::spotify::handler).post(downloader::spotify::handler))
        .route("/downloader/spotifyv2", get(downloader::spotifyv2::handler).post(downloader::spotifyv2::handler))
        .route("/downloader/sssinstagram", get(downloader::sssinstagram::handler).post(downloader::sssinstagram::handler))
        .route("/downloader/terabox", get(downloader::terabox::handler).post(downloader::terabox::handler))
        .route("/downloader/tiktokio", get(downloader::tiktokio::handler).post(downloader::tiktokio::handler))
        .route("/downloader/tiktokv2", get(downloader::tiktokv2::handler).post(downloader::tiktokv2::handler))
        .route("/downloader/tiktokv3", get(downloader::tiktokv3::handler).post(downloader::tiktokv3::handler))
        .route("/downloader/tiktokv4", get(downloader::tiktokv4::handler).post(downloader::tiktokv4::handler))
        .route("/downloader/tiktokv5", get(downloader::tiktokv5::handler).post(downloader::tiktokv5::handler))
        .route("/downloader/tiktokv6", get(downloader::tiktokv6::handler).post(downloader::tiktokv6::handler))
        .route("/downloader/webtoon", get(downloader::webtoon::handler).post(downloader::webtoon::handler))
        .route("/downloader/weibo", get(downloader::weibo::handler).post(downloader::weibo::handler))
        .route("/downloader/xdl", get(downloader::xdl::handler).post(downloader::xdl::handler))
        .route("/downloader/youtube-analytic", get(downloader::youtube_analytic::handler).post(downloader::youtube_analytic::handler))
        .route("/downloader/youtubev1", get(downloader::youtubev1::handler).post(downloader::youtubev1::handler))
        .route("/downloader/youtubev2", get(downloader::youtubev2::handler).post(downloader::youtubev2::handler))
        .route("/downloader/youtubev3", get(downloader::youtubev3::handler).post(downloader::youtubev3::handler))
        .route("/downloader/youtubev4", get(downloader::youtubev4::handler).post(downloader::youtubev4::handler))
        .route("/downloader/youtubev5", get(downloader::youtubev5::handler).post(downloader::youtubev5::handler))
        .route("/downloader/ytplay", get(downloader::ytplay::handler).post(downloader::ytplay::handler))
        .route("/downloader/ytscrape", get(downloader::ytscrape::handler).post(downloader::ytscrape::handler))
        .route("/downloader/zippyshare", get(downloader::zippyshare::handler).post(downloader::zippyshare::handler))

        // AGENT & REMAINING ENDPOINTS
        .route("/games/akinator", get(games::akinator::handler).post(games::akinator::handler))
        .route("/games/tebakheroml", get(games::tebakheroml::handler).post(games::tebakheroml::handler))
        .route("/shortlink/tinyurlv2", get(shortlink::tinyurlv2::handler).post(shortlink::tinyurlv2::handler))
        .route("/tools/magma/catalog", get(tools::magma::catalog::handler).post(tools::magma::catalog::handler))
        .route("/tools/magma/status", get(tools::magma::status::handler).post(tools::magma::status::handler))
        .route("/tools/viu", get(tools::viu::handler).post(tools::viu::handler))
        .route("/v1/models", get(v1::models::handler).post(v1::models::handler))
        .route("/v1/chat/completions", get(v1::chat::completions::handler).post(v1::chat::completions::handler))
        .route("/v2/models", get(v2::models::handler).post(v2::models::handler))
        .route("/v2/chat/completions", get(v2::chat::completions::handler).post(v2::chat::completions::handler))
        .route("/v3/models", get(v3::models::handler).post(v3::models::handler))
        .route("/v3/chat/completions", get(v3::chat::completions::handler).post(v3::chat::completions::handler))

}
