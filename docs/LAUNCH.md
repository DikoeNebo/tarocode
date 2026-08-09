# Launch post draft (English)

Copy/paste for Show HN, Reddit, Discord, etc. Attach or link the demo image: `docs/screenshots/demo-deck.png` (replace with a real GIF when you have one: game focused → click card → text appears in Cursor).

---

**Title options**

1. Keycode: always-on-top prompt cards for Cursor (no focus steal)
2. Show HN: Lazy Coder — tarot-style prompt deck that pastes into Cursor in the background

**Body**

I kept retyping the same long prompts into Cursor (“evaluate”, “fix”, “test”, “ship it”). So I built a small Windows app: an always-on-top deck of up to 9 prompt cards. Click a card (or F1–F8 for hotkeyed cards) and the text is pasted into the Cursor chats you enabled — **without Alt‑Tabbing or stealing focus**, so a game or another window can stay in front.

Optional: a phone web remote on the same Wi‑Fi to pick a live Cursor chat and send a card from the couch.

- Official builds: https://github.com/DikoeNebo/keycode/releases
- Source (MIT): https://github.com/DikoeNebo/keycode

Honest limits for v1:

- Windows only; Cursor path uses local CDP (`--remote-debugging-port` via a Keycode shortcut)
- First builds are unsigned → SmartScreen “Unknown publisher” is expected; SHA-256 is on the Release
- Phone remote is home LAN only — anyone on that Wi‑Fi with the secret link can use it
- Not a cloud agent / not Tailscale yet

Feedback welcome on GitHub Issues — especially paste reliability and first-run friction.

---

**Where to post (pick 2–3, not 20)**

- Show HN
- r/cursor (check rules)
- Cursor Discord / forum if self-promo is allowed
- One vibe-coding community you already use

**Do not claim:** code signing, internet remote, auto-picking cards with AI, non-Cursor IDEs.
