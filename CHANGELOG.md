# Patch Changelog

## Patch Summary
Phase 1 tuning pass to let players get ahead of corruption through stronger multipliers and a cadence-based momentum system.

## Files Modified
- js/phase1.js

## Changes Made
- Added PING momentum (cadence chain): each PING builds a short chain that boosts click gain and slightly boosts passive signal. The chain decays quickly when you stop pinging.
- Added new Phase 1 buff: SIGNAL SURGE.
  - After each PING: click gain is multiplied by 5 for 6 seconds.
  - While the surge window is active, corruption bleeds off faster.
- Retuned Phase 1 buff effects to be more multiplicative (BANDPASS FILTER, CRYO AMP, HARMONIC LOCK) so buffs create a real “breakthrough” moment.
- Passive gain math rebuilt around multipliers and a softened corruption drag; NOISE CANCELLER now provides much stronger corruption relief.
- Synchronicity math tuned: faster early growth, cadence reward, reduced corruption bite, and stronger mitigation from NOISE CANCELLER.

## Intentional Design Decisions (DO NOT REVERT)
- Phase 1 should have at least one overpowered window that lets a good build outrun corruption (SIGNAL SURGE).
- Buffs in Phase 1 should stack primarily as multipliers, not tiny additive bumps.

## Known Risks / Regression Watch
- If Phase 1 click or passive math is refactored later, ensure the momentum chain and SIGNAL SURGE window still apply.
- If corruption tuning is changed globally, Phase 1 may need a follow-up pass to preserve the “breakthrough” feel.
