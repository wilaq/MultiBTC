use ic_cdk::api::management_canister::main::raw_rand;

/// Pull 16 fresh bytes of randomness from the IC and format them as a v4 UUID.
/// Async: this performs an inter-canister call to the management canister.
pub async fn fresh_uuid_v4() -> Result<String, String> {
    let (bytes,): (Vec<u8>,) = raw_rand()
        .await
        .map_err(|(c, e)| format!("raw_rand failed: {c:?} {e}"))?;
    if bytes.len() < 16 {
        return Err(format!("raw_rand returned {} bytes", bytes.len()));
    }
    let mut b = [0u8; 16];
    b.copy_from_slice(&bytes[..16]);
    // Set version = 4 (random) and variant = 10xx.
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    ))
}
