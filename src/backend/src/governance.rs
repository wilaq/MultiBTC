//! Holder governance: proposals, secret ballots, and the rule that resolves
//! them. Pure functions only -- storage and endpoints live in lib.rs -- so the
//! rule can be tested exhaustively.
//!
//! The rule, as chosen by the operator:
//! - A proposal resolves early once every eligible holder has voted.
//! - Otherwise it resolves 7 days after creation, and the higher share of the
//!   votes cast wins. There is no minimum turnout.
//! - A tie in votes goes to the side whose voters hold more multiBTC, by the
//!   canister's own latest verified current readings. A tie there too (including
//!   no votes at all) fails, so nothing changes.
//! - Who votes: holders who had signed a wallet before the rule was set keep
//!   their vote. Later holders vote once their first signed wallet is 14 days
//!   old and the canister has verified at least 0.02 multiBTC across their
//!   wallets -- so a vote cannot be swung by last-minute or empty sign-ups.
//!
//! Note what this does not do: the canister's controllers can still upgrade it.
//! Governance here is a binding, publicly recorded process for holders, and the
//! only code path that releases holder data -- not a constraint on controllers.

pub const VOTING_PERIOD_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
pub const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
pub const MAX_ACCESS_DAYS: u32 = 365;
pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_DESCRIPTION_CHARS: usize = 5_000;
pub const MAX_OPEN_PER_PROPOSER: usize = 3;
/// 2026-10-01T16:00:00Z, when the operator set the eligibility rule.
pub const FOUNDING_CUTOFF_NS: u64 = 1_790_870_400_000_000_000;
pub const NEW_HOLDER_MIN_AGE_NS: u64 = 14 * DAY_NS;
/// 0.02 multiBTC (8 decimals on every chain).
pub const NEW_HOLDER_MIN_BALANCE: u128 = 2_000_000;

/// Whether a holder with a signed wallet may vote, from when their first
/// wallet was signed and their canister-verified current balance.
pub fn may_vote(now: u64, first_signed_at: u64, verified_balance: u128) -> bool {
    first_signed_at < FOUNDING_CUTOFF_NS
        || (now >= first_signed_at.saturating_add(NEW_HOLDER_MIN_AGE_NS)
            && verified_balance >= NEW_HOLDER_MIN_BALANCE)
}

/// Whether a proposal passes, and why, from its final tallies.
pub fn decide(yes: u32, no: u32, yes_balance: u128, no_balance: u128) -> (bool, &'static str) {
    if yes > no {
        (true, "more yes votes than no votes")
    } else if no > yes {
        (false, "more no votes than yes votes")
    } else if yes_balance > no_balance {
        (true, "votes tied; yes voters hold more verified multiBTC")
    } else if no_balance > yes_balance {
        (false, "votes tied; no voters hold more verified multiBTC")
    } else {
        (false, "votes and verified balances tied; nothing changes")
    }
}

/// When a proposal resolves, if it has: early at `now` once everyone eligible
/// has voted, else at its deadline. The deadline is used as the resolution time
/// even if finalisation happens later, so an access grant's window does not
/// depend on when someone happened to trigger it.
pub fn resolution_time(now: u64, deadline: u64, ballots: usize, eligible: usize) -> Option<u64> {
    if now >= deadline {
        Some(deadline)
    } else if eligible > 0 && ballots >= eligible {
        Some(now)
    } else {
        None
    }
}

/// Whether a passed grant covers `now`: from resolution, for `days` days.
pub fn grant_active(now: u64, resolved_at: u64, days: u32) -> bool {
    now >= resolved_at && now < resolved_at.saturating_add(days as u64 * DAY_NS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn majority_of_votes_cast_wins_with_no_minimum_turnout() {
        assert!(decide(1, 0, 0, 0).0, "one yes with everyone else silent passes");
        assert!(!decide(0, 1, 0, 0).0);
        assert!(decide(3, 2, 0, 1_000).0, "headcount beats balance when not tied");
    }

    #[test]
    fn ties_go_to_the_side_holding_more_verified_multibtc() {
        assert!(decide(2, 2, 500, 499).0);
        assert!(!decide(2, 2, 499, 500).0);
    }

    #[test]
    fn a_full_tie_or_no_votes_changes_nothing() {
        assert!(!decide(2, 2, 500, 500).0);
        assert!(!decide(0, 0, 0, 0).0);
    }

    #[test]
    fn resolves_early_only_when_everyone_eligible_has_voted() {
        let deadline = 1_000;
        assert_eq!(resolution_time(10, deadline, 3, 4), None);
        assert_eq!(resolution_time(10, deadline, 4, 4), Some(10));
        assert_eq!(resolution_time(10, deadline, 0, 0), None, "no electorate never resolves early");
    }

    #[test]
    fn otherwise_resolves_at_the_deadline_however_late_it_is_finalised() {
        assert_eq!(resolution_time(5_000, 1_000, 1, 4), Some(1_000));
    }

    #[test]
    fn founding_holders_vote_regardless_of_age_or_balance() {
        assert!(may_vote(FOUNDING_CUTOFF_NS, FOUNDING_CUTOFF_NS - 1, 0));
    }

    #[test]
    fn later_holders_need_fourteen_days_and_two_hundredths_of_a_multibtc() {
        let signed = FOUNDING_CUTOFF_NS;
        let ripe = signed + NEW_HOLDER_MIN_AGE_NS;
        assert!(!may_vote(ripe - 1, signed, NEW_HOLDER_MIN_BALANCE), "13.99 days old");
        assert!(may_vote(ripe, signed, NEW_HOLDER_MIN_BALANCE), "14 days, exactly 0.02");
        assert!(!may_vote(ripe, signed, NEW_HOLDER_MIN_BALANCE - 1), "just under 0.02");
        assert!(!may_vote(ripe * 2, signed, 0), "never verified");
    }

    #[test]
    fn access_window_is_half_open_and_expires() {
        let t = 1_000_000;
        assert!(!grant_active(t - 1, t, 2), "not before resolution");
        assert!(grant_active(t, t, 2));
        assert!(grant_active(t + 2 * DAY_NS - 1, t, 2));
        assert!(!grant_active(t + 2 * DAY_NS, t, 2), "expired exactly at the end");
    }
}
