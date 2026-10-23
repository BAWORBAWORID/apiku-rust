use axum::{
    response::IntoResponse,
    Json,
};
use rand::seq::SliceRandom;
use serde_json::json;

const CARTOONS: &[(&str, &str)] = &[
    ("Tom and Jerry", "https://i.pinimg.com/736x/c2/f0/97/c2f0975cc0cb2985e359abce2461e986.jpg"),
    ("Mickey Mouse", "https://i.pinimg.com/736x/9e/bc/77/9ebc77ae4c7dca6ec3f342958d7b2cae.jpg"),
    ("Donald Duck", "https://i.pinimg.com/736x/6e/a7/d4/6ea7d415f9b6abe951fb1b43dc1e094f.jpg"),
    ("Scooby Doo", "https://i.pinimg.com/736x/68/76/fb/6876fb80983d8a780977c351fe65c54c.jpg"),
    ("The Flintstones", "https://i.pinimg.com/736x/3d/24/16/3d2416dbde61723402736548b72bd99b.jpg"),
    ("Popeye", "https://i.pinimg.com/736x/dc/48/a3/dc48a378fb3a86b744a0229d9ba36127.jpg"),
    ("SpongeBob SquarePants", "https://i.pinimg.com/736x/d2/b2/49/d2b2493f88da017b20b2f5ae1ad6be86.jpg"),
    ("Dora the Explorer", "https://i.pinimg.com/736x/35/a0/02/35a0020ad541c8d1d6428e119b523560.jpg"),
    ("Ben 10", "https://i.pinimg.com/736x/8a/f4/52/8af45205d34223f47b51f14edffce4e5.jpg"),
    ("Teenage Mutant Ninja Turtles", "https://i.pinimg.com/736x/59/72/c4/5972c4fd49d8343cb0d27201d5d861c0.jpg"),
    ("The Pink Panther", "https://i.pinimg.com/736x/4c/35/a1/4c35a178ac9b02dd3f5c64142ec8cb54.jpg"),
    ("Bugs Bunny", "https://i.pinimg.com/736x/8e/4c/16/8e4c16d699ca1b53ef3b8e935a9e1034.jpg"),
    ("Tweety", "https://i.pinimg.com/736x/e6/10/dc/e610dcb4430927c1d4f3b4a1e8476f14.jpg"),
    ("Sylvester", "https://i.pinimg.com/736x/0b/c0/7a/0bc07a3334a40578adecaadb829dcee2.jpg"),
    ("Daffy Duck", "https://i.pinimg.com/736x/21/71/b8/2171b82513f2ef7001ab9b83123c933e.jpg"),
    ("Porky Pig", "https://i.pinimg.com/736x/88/69/b4/8869b464d10c872572beeca9d33e4bea.jpg"),
    ("Woody Woodpecker", "https://i.pinimg.com/736x/ce/32/7c/ce327cb85461b3a3db2a6d8e9a95f442.jpg"),
    ("Road Runner", "https://i.pinimg.com/736x/d3/c1/d0/d3c1d05709d6cf2e3529271a3cbdeb23.jpg"),
    ("Wile E. Coyote", "https://i.pinimg.com/736x/56/4e/58/564e58e5d13c2664cf7c6ae3cb808ffa.jpg"),
    ("Garfield", "https://i.pinimg.com/736x/85/9f/09/859f09faf16470f5b10dc4480190fbbf.jpg"),
    ("The Smurfs", "https://i.pinimg.com/736x/49/df/d3/49dfd33c1d0c02a56dc89a4f23495f4a.jpg"),
    ("Inspector Gadget", "https://i.pinimg.com/736x/0a/3d/60/0a3d605f6265fbe9f229af368a5b56fb.jpg"),
    ("DuckTales", "https://i.pinimg.com/736x/f8/4e/80/f84e80b9d44ed7661be004cba7c88098.jpg"),
    ("Chip and Dale", "https://i.pinimg.com/736x/fe/11/af/fe11af8a6cba02993fef301a6369691b.jpg"),
    ("Goofy", "https://i.pinimg.com/736x/bf/e8/ce/bfe8ce9021e299f84a101862f181faac.jpg"),
    ("Pluto", "https://i.pinimg.com/736x/24/d4/62/24d4621de1aa4807644dff091207b3c9.jpg"),
    ("The Jetsons", "https://i.pinimg.com/736x/e2/e0/03/e2e00313ad19c89a94dcd779813ab95d.jpg"),
    ("Yogi Bear", "https://i.pinimg.com/736x/01/55/38/015538ed293a7739f2b49a3314a765ce.jpg"),
    ("Boo Boo Bear", "https://i.pinimg.com/736x/76/c8/2f/76c82fe2724f3e799a6820e38d7a79a4.jpg"),
    ("Fred Flintstone", "https://i.pinimg.com/736x/07/11/d0/0711d0ba95a7d8eba56add44cd145af6.jpg"),
    ("Barney Rubble", "https://i.pinimg.com/736x/b7/24/b8/b724b8d6f8855b8383ae99aaaa9a55af.jpg"),
    ("Betty Boop", "https://i.pinimg.com/736x/ce/53/d2/ce53d21013675ccafee2088234d3ad34.jpg"),
    ("Felix the Cat", "https://i.pinimg.com/736x/3f/f3/97/3ff39709b21abf120eaf9538f734aaf9.jpg"),
    ("Tayo the Little Bus", "https://i.pinimg.com/736x/d4/89/d3/d489d385be83e9eee8d3e6aea15e32eb.jpg"),
    ("Mr. Bean", "https://i.pinimg.com/736x/5d/c3/19/5dc3193d206fa1ec0cfcb4ced4aa8437.jpg"),
];

pub async fn handler() -> impl IntoResponse {
    let mut rng = rand::thread_rng();
    let (name, img) = CARTOONS.choose(&mut rng).unwrap();

    Json(json!({
        "status": true,
        "result": {
            "jawaban": name,
            "soal": img
        }
    })).into_response()
}
