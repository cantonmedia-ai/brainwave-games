# Truth or Bluff Wording and Flow Prompt

Use this prompt before changing UI design or styling.

You are reviewing `Truth or Bluff`, a premium dinner-table party game by Brainwave Games. The public experience must feel like a real hosted dinner game, not a tech demo. Do not use "AI" in player-facing game name, hero copy, or primary buttons.

## Game Promise

Tell your story. Hide one lie. Let the table decide.

Chinese support copy:
说出你的故事，藏起一个假话，让全桌来猜。

## Tone

- Premium dinner party, warm, lightly witty.
- Clear enough for guests who have had wine or are distracted by food.
- Never childish, never corporate, never admin-heavy.
- Host copy should feel calm and in control.
- Player copy should reduce anxiety and make the next action obvious.

## Required Flow

1. Host opens `/bluffgame/host`, enters host code, phone, nickname, and creates a game.
2. Host shares QR/join link.
3. Players join with phone and nickname.
4. Existing phone rejoins the same player without losing number, score, stories, or status.
5. Host is also a player and must have an obvious path to write stories.
6. Players write 3 stories one step at a time.
7. Players choose which story is the bluff.
8. Host starts only after at least 3 ready players.
9. One storyteller is selected.
10. Storyteller cannot vote.
11. Other players vote A/B/C and confirm.
12. Host can reveal early.
13. Reveal shows bluff answer, vote distribution, score impact, and a dinner-friendly comment.
14. Game pauses in Discussion Time until host presses Next Player.
15. End Game leads to awards and Memory Page.

## Copy Rules

- Primary button text must describe the next action: "Create Game", "Write My Stories", "Start Game", "Confirm Vote", "Reveal", "Next Player".
- Avoid vague copy like "Submit" when context can be clearer.
- Error messages must explain what to do next.
- Never show full phone numbers outside host masked management rows.
- Display Mode must not show host tools, phone numbers, or hidden bluff answers before reveal.

## 9/10 Acceptance

Score the game before release:

- Join/rejoin: 10/10 if phone rejoin restores identity across devices.
- Host control: 9/10 if host always knows the next correct action.
- Player flow: 9/10 if a new guest can submit stories without help.
- Voting: 9/10 if storyteller cannot vote and voters cannot change confirmed votes.
- Reveal: 9/10 if the table gets a clear answer, distribution, score feedback, and discussion pause.
- Display: 9/10 if readable from across a room and leaks no private info.
- Recovery: 9/10 if refresh, leave device, late join, and host refresh do not break the game.

Only design after the flow and wording pass this checklist.
