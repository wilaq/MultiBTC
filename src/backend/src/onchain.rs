//! Canister-side reads of multiBTC balances, so the canister -- not the
//! claimant's browser -- attests what each wallet held.
//!
//! Two snapshots per chain:
//! - **pre-incident**: the last block before the first malicious Multichain
//!   transaction (2023-07-06 16:21:23 UTC). This is what a claim is about.
//! - **current**: a recent block, for context and to check the balance the
//!   claimant's browser reported when signing.
//!
//! Outcalls are made by a single node (`is_replicated = false`) under
//! pay-as-you-go pricing, about a third of the cost of fully replicated legacy
//! calls. The trade-off is that one node's answer stands in for subnet
//! consensus, so every observation records that it is single-node. For the
//! pre-incident snapshot this matters little: the block is fixed and the data is
//! public, so anyone can re-check the figure against any archive node.

use candid::{CandidType, Nat, Principal};
use ic_cdk::api::management_canister::http_request::{
    HttpHeader, HttpMethod, HttpResponse, TransformArgs, TransformContext,
};

use crate::types::EthAddress;

pub struct Chain {
    /// Must match the chain keys the frontend uses (`CHAIN_KEYS` in wagmi.ts).
    pub key: &'static str,
    pub token: &'static str,
    /// Last block strictly before 2023-07-06 16:21:23 UTC, found by binary
    /// search on block timestamps. On Ethereum the next block (17_635_954) is
    /// the one carrying the first malicious transaction. `None` where no
    /// provider could be reached to establish it.
    pub pre_incident_block: Option<u64>,
    /// Archive-capable endpoints, tried in order. Only endpoints that actually
    /// served `eth_call` at the pre-incident block in testing are listed.
    pub providers: &'static [&'static str],
    /// "Current" block numbers are rounded down to a multiple of this.
    pub current_round: u64,
}

pub const CHAINS: &[Chain] = &[
    Chain {
        key: "ethereum",
        token: "0x66eff5221ca926636224650fd3b9c497ff828f7d",
        pre_incident_block: Some(17_635_953),
        providers: &[
            "https://eth.drpc.org",
            "https://eth-mainnet.public.blastapi.io",
            "https://mainnet.gateway.tenderly.co",
            "https://rpc.mevblocker.io",
            "https://eth-pokt.nodies.app",
        ],
        current_round: 100, // ~20 minutes of 12 s blocks
    },
    Chain {
        key: "bsc",
        token: "0xd9907fcda91ac644f70477b8fc1607ad15b2d7a8",
        pre_incident_block: Some(29_730_477),
        // The only free endpoint found serving 2023 BSC state; the Binance
        // dataseed nodes prune it ("missing trie node").
        providers: &["https://bsc-mainnet.public.blastapi.io"],
        current_round: 4_000,
    },
    Chain {
        key: "polygon",
        token: "0xf5b9b4a0534cf508ab9953c64c5310dfa0b303a1",
        pre_incident_block: Some(44_757_671),
        providers: &["https://polygon.drpc.org"],
        current_round: 500,
    },
    Chain {
        key: "canto",
        token: "0x80a16016cc4a2e6a2caca8a4a498b1699ff0f844",
        // As of 2026-10-01 every known public Canto endpoint is unreachable or
        // serves an expired TLS certificate, which outcalls reject. Recorded
        // explicitly as unavailable -- never as a zero balance.
        pre_incident_block: None,
        providers: &[],
        current_round: 0,
    },
];

const MAX_RESPONSE_BYTES: u64 = 4_096;

/// Management canister `http_request` arguments, including the two fields added
/// after ic-cdk 0.17 (interface spec 0.68): single-node execution and
/// pay-as-you-go pricing. Candid records are structural, so this is the same
/// call ic-cdk would make, plus those fields.
#[derive(CandidType)]
struct HttpRequestArgs {
    url: String,
    max_response_bytes: Option<u64>,
    method: HttpMethod,
    headers: Vec<HttpHeader>,
    body: Option<Vec<u8>>,
    transform: Option<TransformContext>,
    is_replicated: Option<bool>,
    pricing_version: Option<u32>,
}

/// Cycles attached to one single-node, pricing-v2 outcall: the base fee with
/// n = 13 (an upper bound; the SEV subnet has 7 nodes), plus a budget covering
/// usage and delivery of a worst-case 4 KiB response. Under v2 the unused part
/// of the budget is refunded, so the margin costs nothing.
fn outcall_cycles(request_bytes: u64) -> u128 {
    let n: u128 = 13;
    let req = request_bytes as u128;
    let resp = MAX_RESPONSE_BYTES as u128;
    let base = (1_000_000 + 50 * req + 90_000 * n + (2_000 * n + 100_000)) * n;
    let usage = 50 * resp + 300 * 30_000; // up to a 30 s round trip
    let delivery = n * (10 * n + 600) * resp;
    let total = base + usage + delivery;
    total + total / 2
}

/// One JSON-RPC call. Returns the `result` field as canonicalised by
/// `canonicalise`, or a short error that is identical on every replica.
async fn rpc(url: &str, body: String, round: u64) -> Result<String, String> {
    let headers = vec![HttpHeader {
        name: "Content-Type".into(),
        value: "application/json".into(),
    }];
    let request_bytes = (url.len() + body.len() + 40) as u64;
    let arg = HttpRequestArgs {
        url: url.to_string(),
        max_response_bytes: Some(MAX_RESPONSE_BYTES),
        method: HttpMethod::POST,
        headers,
        body: Some(body.into_bytes()),
        transform: Some(TransformContext::from_name(
            "transform_rpc".to_string(),
            round.to_be_bytes().to_vec(),
        )),
        is_replicated: Some(false),
        pricing_version: Some(2),
    };
    let (resp,): (HttpResponse,) = ic_cdk::api::call::call_with_payment128(
        Principal::management_canister(),
        "http_request",
        (arg,),
        outcall_cycles(request_bytes),
    )
    .await
    .map_err(|(code, msg)| format!("outcall failed: {code:?} {}", truncate(&msg, 120)))?;
    let text = String::from_utf8_lossy(&resp.body).into_owned();
    match text.split_once(':') {
        Some(("R", value)) => Ok(value.to_string()),
        Some(("E", err)) => Err(err.to_string()),
        _ => Err("unrecognised transform output".into()),
    }
}

fn truncate(s: &str, n: usize) -> &str {
    match s.char_indices().nth(n) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}

/// Transform run on every replica before consensus. Reduces the provider's
/// response to `R:<result>` or `E:<short error>` with no headers, so replicas
/// agree on everything that does not matter (headers, request ids, field order)
/// and disagree only if the provider genuinely answered differently.
pub fn canonicalise(args: TransformArgs) -> HttpResponse {
    let round = <[u8; 8]>::try_from(args.context.as_slice()).map(u64::from_be_bytes).unwrap_or(0);
    let status_ok = args.response.status == Nat::from(200u32);
    let text = String::from_utf8_lossy(&args.response.body);
    let body = if !status_ok {
        format!("E:http status {}", args.response.status)
    } else if let Some(code) = json_error_code(&text) {
        format!("E:rpc error {code}")
    } else if let Some(result) = json_string_field(&text, "result") {
        let result = result.to_ascii_lowercase();
        if round > 0 {
            match parse_hex_u64(&result) {
                Ok(n) => format!("R:0x{:x}", n - n % round),
                Err(e) => format!("E:{e}"),
            }
        } else {
            format!("R:{result}")
        }
    } else {
        "E:unrecognised response".to_string()
    };
    HttpResponse { status: Nat::from(200u32), headers: vec![], body: body.into_bytes() }
}

/// The value of a top-level string field, e.g. `"result":"0x12"`. Hand-rolled
/// to avoid pulling a JSON crate into a canister whose dependencies are pinned.
fn json_string_field(s: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let rest = s[s.find(&pat)? + pat.len()..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start().strip_prefix('"')?;
    Some(rest[..rest.find('"')?].to_string())
}

fn json_error_code(s: &str) -> Option<i64> {
    let e = &s[s.find("\"error\"")?..];
    let rest = e[e.find("\"code\"")? + 6..].trim_start().strip_prefix(':')?.trim_start();
    let end = rest.find(|c: char| !(c == '-' || c.is_ascii_digit())).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn parse_hex_u64(h: &str) -> Result<u64, String> {
    let h = h.strip_prefix("0x").ok_or("expected 0x-prefixed hex")?;
    u64::from_str_radix(h, 16).map_err(|_| "block number is not valid hex".to_string())
}

/// A 32-byte ABI word as a balance. `0x` alone means the token contract had no
/// code at that block, which must not be read as a zero balance.
fn parse_balance(h: &str) -> Result<u128, String> {
    let h = h.strip_prefix("0x").ok_or("expected 0x-prefixed hex")?;
    if h.is_empty() {
        return Err("token contract had no code at this block".into());
    }
    let digits = h.trim_start_matches('0');
    if digits.len() > 32 {
        return Err("balance exceeds u128".into());
    }
    if digits.is_empty() {
        return Ok(0);
    }
    u128::from_str_radix(digits, 16).map_err(|_| "balance is not valid hex".into())
}

/// Latest block on `chain`, rounded down, from the first provider that answers.
pub async fn current_block(chain: &Chain) -> Result<(u64, String), String> {
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}"#.to_string();
    let mut last_err = "no provider configured".to_string();
    for url in chain.providers {
        match rpc(url, body.clone(), chain.current_round).await {
            Ok(hex) => return Ok((parse_hex_u64(&hex)?, url.to_string())),
            Err(e) => last_err = format!("{url}: {e}"),
        }
    }
    Err(last_err)
}

/// `balanceOf(addr)` on the multiBTC token at `block`, from the first provider
/// that answers.
pub async fn balance_at(chain: &Chain, addr: &EthAddress, block: u64) -> Result<(u128, String), String> {
    let body = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{{"to":"{}","data":"0x70a08231000000000000000000000000{}"}},"0x{:x}"]}}"#,
        chain.token,
        hex::encode(addr.0),
        block
    );
    let mut last_err = "no provider configured".to_string();
    for url in chain.providers {
        match rpc(url, body.clone(), 0).await {
            Ok(hex) => return Ok((parse_balance(&hex)?, url.to_string())),
            Err(e) => last_err = format!("{url}: {e}"),
        }
    }
    Err(last_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ic_cdk::api::management_canister::http_request::HttpHeader;

    fn resp(status: u32, body: &str) -> TransformArgs {
        TransformArgs {
            response: HttpResponse {
                status: Nat::from(status),
                headers: vec![HttpHeader { name: "x-request-id".into(), value: "abc123".into() }],
                body: body.as_bytes().to_vec(),
            },
            context: 0u64.to_be_bytes().to_vec(),
        }
    }
    fn out(a: TransformArgs) -> String {
        let r = canonicalise(a);
        assert!(r.headers.is_empty(), "headers must be stripped");
        String::from_utf8(r.body).unwrap()
    }

    #[test]
    fn replicas_agree_despite_formatting_and_headers() {
        let a = out(resp(200, r#"{"jsonrpc":"2.0","id":1,"result":"0x00AB"}"#));
        let b = out(resp(200, r#"{"id":1, "result" : "0x00ab", "jsonrpc":"2.0"}"#));
        assert_eq!(a, "R:0x00ab");
        assert_eq!(a, b);
    }

    #[test]
    fn errors_are_short_and_deterministic() {
        assert_eq!(
            out(resp(200, r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"missing trie node 8f3a"}}"#)),
            "E:rpc error -32000"
        );
        assert_eq!(out(resp(429, "Too Many Requests")), "E:http status 429");
    }

    /// Two replicas asking a few blocks apart must still agree.
    #[test]
    fn current_block_is_rounded_so_replicas_agree() {
        let mut a = resp(200, r#"{"result":"0x10ce5d1"}"#); // 17_622_481
        a.context = 100u64.to_be_bytes().to_vec();
        let mut b = resp(200, r#"{"result":"0x10ce5e0"}"#); // 17_622_496
        b.context = 100u64.to_be_bytes().to_vec();
        assert_eq!(out(a), "R:0x10ce580"); // 17_622_400
        assert_eq!(out(b), "R:0x10ce580");
    }

    #[test]
    fn balances_parse_and_empty_code_is_not_zero() {
        assert_eq!(parse_balance("0x000000000000000000000000000000000000000000000000000000001d74c164"), Ok(494_190_948));
        assert_eq!(parse_balance("0x0000000000000000000000000000000000000000000000000000000000000000"), Ok(0));
        assert!(parse_balance("0x").is_err());
        assert!(parse_balance(&format!("0x1{}", "0".repeat(32))).is_err());
    }
}
