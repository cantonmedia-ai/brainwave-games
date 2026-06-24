# Truth or Bluff Agent QA Checklist

Run this before deploying.

## Required Simulations

- `node test-flow.mjs`
- `node test-gameplay.mjs`
- `node test-full-game.mjs`
- `node test-live-online.mjs` after production deploy

## Manual Host Flow

- Host can create a new game from `/bluffgame/host`.
- Host sees Game ID, QR code, Join Link, and Display Link.
- Host can write their own stories with `Write My Stories`.
- Host controls render once only.
- Host can start, reveal, next player, pause, skip, end, reset, and add demo data.
- Host storyteller round still has safety controls.

## Manual Player Flow

- Player joins with phone and nickname.
- Duplicate nickname is blocked.
- Existing phone rejoins original player.
- Player can leave device and rejoin.
- Story submission is one screen at a time.
- Unsafe story text is blocked.
- Storyteller cannot vote.
- Voter must confirm before answer locks.

## Manual Display Flow

- Display lobby shows readiness.
- Voting screen shows storyteller, stories, and vote count.
- Display does not show phone numbers.
- Display does not show bluff answer before reveal.
- Ended display shows Award Ceremony and leaderboard.

## Release Score

Do not deploy below 9/10:

- 2 points: join/rejoin works across live separate browser contexts.
- 2 points: complete game can finish from host create to awards.
- 2 points: no private information leaks on display/player screens.
- 1 point: host controls do not duplicate or trap host.
- 1 point: copy is clear, warm, and action-oriented.
- 1 point: responsive player UI works on mobile width.
