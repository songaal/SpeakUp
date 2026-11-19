# Speak Up — notes for the next agent

English-speaking practice web app. The learner sees a **literal (직역) Korean translation**, says the English sentence out loud, sees their words recognized live, and gets a word-by-word comparison with a match score. Content is dialogues *and* plain articles/news (no speaker).

- Live: https://speakup.kappy.app (also `speakup.<account>.workers.dev`)
- Owner: Sammy (Korean speaker). **Reply to the owner in Korean.** UI strings are Korean, hardcoded (no i18n layer).
- Theme: Duolingo-like (Nunito, green `#58CC02`, chunky bottom-border buttons). Keep it.

## Run / test / deploy
- No build step. `public/` is served as-is. Local: `npm run dev` → http://localhost:8000 (ES modules need http, not `file://`; `localhost` counts as a secure context so the mic works).
- Unit tests for the pure logic: `npm test` (`node --test tests/*.test.mjs`). Add a test when you touch `core.js`.
- Deploy: push to `main` → Cloudflare Workers Builds runs `npx wrangler deploy` (assets-only Worker, see `wrangler.jsonc`). Same setup as the owner's other kappy.app apps (e.g. `songaal/working`).
- After changing CSS/JS, bump the `?v=` on `style.css` and `js/app.js` in `public/index.html` and the `version` in `package.json`.

## Files
```
public/index.html        markup for all views + sheets (library, info, player, editor, export, modal, toast)
public/style.css         all styles
public/js/app.js         UI + state + speech engines (entry, ES module)
public/js/core.js        pure logic, no DOM: md/json parse+serialize, tokenize, align, score, stats  ← unit-tested
public/js/content.js     SAMPLE_MD (default dialogue) and CONVERT_PROMPT (📋 프롬프트 button text)
public/manifest.webmanifest, public/icons/   PWA metadata + icons (icon.svg → PNGs via rsvg-convert)
tests/core.test.mjs      node:test suite for core.js
wrangler.jsonc           Cloudflare Worker (static assets only, custom domain speakup.kappy.app)
```

## Views (app.js)
`library` → tap card → `info` (stats: sentences/words/unique words/avg length, best-progress bar, full text list, Start / Resume) → `player`.
- Library: edit mode (✎ 편집) shows checkboxes (multi-delete with in-page confirm modal) and ▲▼ reorder buttons. `＋ 새 대화` opens the editor sheet; 가져오기 (file input, .md/.json, many files, **appends**); 내보내기 (sheet with MD/JSON tabs, Copy, Save file).
- 📋 프롬프트: popover with `CONVERT_PROMPT`; opening it copies to clipboard; closes on outside pointerdown, window blur, Esc, or toggling.
- Info: ✎ 수정 opens the editor with that dialogue as md; saving with extra `---` sections inserts them as new dialogues after it. The editor also has 삭제.
- Player: vertical script. Current line centred (big, Korean + masked English word slots + "heard" box); previous lines above show English (revealed) + their score this session; next lines below show Korean only, faded. Free swipe/wheel scroll with CSS `scroll-snap`; when scrolling settles (`onScrollSettle`, 130 ms debounce) the line nearest the centre becomes current. Programmatic scrolls set `progScrollUntil` so they don't re-trigger selection.

## Masking / hint rules (player)
A word of the current line is shown only if: said correctly (live or in the last attempt), hint level 2, or the attempt scored 100%. Otherwise it is a blank slot (`.w.hid`); wrong/missed words after an attempt are pink blanks with what was heard shown underneath. 💡 cycles: 0 blanks → 1 first letter on blanks only → 2 show answer. Hint resets to 0 when the line changes.

## Scoring (core.js)
- `tokenize()` normalizes both sides: lowercase, strip punctuation, expand contractions (I've→i have), numbers <100 → words, `%` → percent, hyphens removed (off-peak→offpeak), `'s` → `s` token. Each token keeps the index of its display word.
- `mergeCompounds()` joins two heard tokens when the joined form is in the answer ("off peak" → "offpeak").
- `align()` = word-level Levenshtein with backtrace. `prefix=true` for the live view (trailing answer words are "pending", not missed).
- `score = matched answer tokens / (answer tokens + extra spoken tokens)`, rounded %. Extra words are penalised on purpose.
- Live: as soon as every answer token is matched, listening stops and it scores (no need to wait for silence).

## Speech engines (app.js)
- **Browser** (kappy.app, localhost): Web Speech API, `lang=en-US`, `continuous`, `interimResults`, `maxAlternatives=3` (final results pick the alternative overlapping the answer most). Chrome ends a session by itself after silence → `onend` restarts it, keeps text in `baseText`, and shows a toast nudge "🔄 인식이 잠깐 끊겨서…". Fatal errors (not-allowed, network) set `stopRequested` so it doesn't loop.
- **Claude artifact** (the owner also previews it as a claude.ai artifact): the sandbox blocks the mic, so it uses `window.claude.use("dictation")` (declared capability) and `use("downloads")` for Save file. Detected via `window.claude.use`. Don't remove this branch.
- Pause handling: ⏸ chip cycles 2s / 4s (default) / 7s / manual. After that much silence (with some speech) it stops and scores; manual = only a tap stops it.
- Firefox has no Web Speech recognition → mic disabled with a message.

## Data (localStorage only — no server)
| key | value |
|---|---|
| `speakup.lib.v3` | `[{id, title, lines:[{spk, en, ko}], created, updated}]` — array order = list order |
| `speakup.best.v3` | `{"<dialogId>|<english sentence>": bestScore}` — keyed by sentence text so reordering lines keeps scores |
| `speakup.pos.v3` | `{dialogId: lastLineIndex}` (Resume button) |
| `speakup.auto.v3`, `speakup.pause.v3` | settings |
First run seeds the sample dialogue (`SAMPLE_MD`). If storage throws, a warning banner tells the user to export.
Data is per browser **and per origin** (artifact vs localhost vs kappy.app are separate). Lost on clearing site data, private mode, Safari's 7-day eviction of non-home-screen sites. Export is the backup. If cross-device sync is ever wanted, it needs a server (e.g. Cloudflare KV/D1) — not built.

## Script format (.md) — import, export and the editor all use it
```
# Title
- Speaker: English sentence      ("- " optional, "Speaker: " optional)
- 한국어 직역                       (a line containing Hangul = translation of the English line above; a speaker prefix here is dropped)
---                              (separates dialogues; a new "# " also starts one)
```
One sentence per line. Code-fence lines (```) are ignored so pasted AI output works. Export MD writes every dialogue joined by `---`. JSON: `{app:"speak-up", version:1, dialogues:[{title, lines:[{spk,en,ko}]}]}`; import also accepts a bare array or a single dialogue.

## Owner preferences / decisions so far
- Korean shown, English hidden is the core mode (not reading practice). Korean must be a literal translation to help recall the English word order.
- Neighbouring sentences faded for continuity; past sentences scroll up, next ones below.
- Hint only fills blanks, never re-hides correct words.
- Notify (toast) when Chrome drops recognition rather than silently ending.
- Lists: reorder, multi-select delete, edit inside the dialogue, big textarea for adding.

## Ideas not built yet
- Pronunciation scoring (Azure Pronunciation Assessment needs a key + server proxy).
- Cross-device sync, review of weak sentences (spaced repetition), shadowing mode (auto-play TTS then record), service worker/offline.
