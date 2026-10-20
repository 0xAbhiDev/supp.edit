fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&supp_media::capabilities()).unwrap()
    );
}
