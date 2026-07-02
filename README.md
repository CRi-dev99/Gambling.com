# Gambling.com Fictional-Credit Casino

A browser casino built with Supabase Auth, private server-side game sessions, transactional fictional-credit accounting, and row-level security. Credits are fictional only: there are no deposits, withdrawals, payments, prizes, or real-money mechanics.

The important security boundary is that the browser does not decide outcomes or write balances. The client invokes the `play-game` Supabase Edge Function, and that function updates credits/history through database functions.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Deploy the Edge Function:

```bash
supabase functions deploy play-game
```

4. Confirm the Edge Function has access to `SUPABASE_URL`, a browser-safe anon/publishable key, and a service-role/secret key. Supabase hosted functions provide these automatically for normal projects.
5. Put your project URL and anon key in `static/js/supabase-config.js`.
6. Serve the site locally:

```bash
npm run serve
```

Then open `http://localhost:8000`.

## Games

- Blackjack: single player against automated dealer rules.
- Five-card Poker: solo draw poker.
- Solitaire: simplified Klondike.
- Slots: weighted three-reel machine.
- Corridor: five-room door minigame.
- Dice Duel: player dice against house dice.

## Security Model

- Supabase Auth verifies each player.
- RLS lets users read only their own profile/history.
- Direct browser inserts/updates/deletes for profiles, credit history, and private game sessions are revoked.
- Private game state is stored in `game_sessions`, which has no client read policy.
- The `play-game` Edge Function uses server-side randomness and a service key that must never be exposed to the browser.
- Credit changes and history entries are applied with database functions so they happen together.

## Notes

- This is not a real-money gambling platform.
- If this ever involved money, prizes, or anything cash-equivalent, it would also need gambling licensing, age/identity checks, anti-fraud controls, payment compliance, responsible-gambling tooling, and legal review.
