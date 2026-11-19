# Speak Up — notes for the next agent

English-speaking practice web app. The learner sees a **literal (직역) Korean translation**, says the English sentence out loud, sees their words recognized live, and gets a word-by-word comparison with a match score. Content is dialogues *and* plain articles/news (no speaker).

- Live: https://speakup.kappy.app (also `speakup.<account>.workers.dev`)
- Owner: Sammy (Korean speaker). **Reply to the owner in Korean.**
- UI language: Korean + English via `public/js/i18n.js` (`t(key, …args)`; static markup uses `data-i18n`, `data-i18n-html`, `data-i18n-title`, `data-i18n-ph`, `data-i18n-aria`). Choice in ⚙︎ 설정: system (default — `navigator.language` ko* → ko, else en) / 한국어 / English, stored in `speakup.lang.v3`. **Every new UI string must be added to both `STR.ko` and `STR.en`.** Script content (titles, sample) is not translated.
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
public/js/content.js     SAMPLE_MD (default dialogue: ordering coffee at a café), OLD_SAMPLE fingerprint, CONVERT_PROMPT / CONVERT_PROMPT_EN (📋 button text per UI language)
public/js/i18n.js        UI strings (STR.ko / STR.en), QUOTES for the finish screen, language choice + applyStatic()
public/manifest.webmanifest, public/icons/   PWA metadata + icons (icon.svg → PNGs via rsvg-convert)
tests/core.test.mjs      node:test suite for core.js
wrangler.jsonc           Cloudflare Worker (static assets only, custom domain speakup.kappy.app)
```

## Views (app.js)
`library` → tap card → `info` (stats tiles: sentences / words / 연습한 문장 = total scored attempts for this dialogue; Start / Resume buttons right under the stats; full text list with best % per line) → `player`.
- Library card: title + `N문장 · 연습 N문장 · 마지막 <date>` (or 아직 연습 안 함). No "완벽 x/N" and no progress bar (owner removed them).
- Library: edit mode (✎ 편집) shows checkboxes (multi-delete with in-page confirm modal, or **export only the selected** ones) and ▲▼ reorder buttons. `＋ 새 대화` opens the editor sheet; 가져오기 (file input, .md/.json, many files, **appends**); 내보내기 (sheet with MD/JSON tabs, Copy, Save file).
- 📋 프롬프트: popover with `CONVERT_PROMPT`; opening it copies to clipboard; closes on outside pointerdown, window blur, Esc, or toggling.
- Finish screen (`showFinish`): shown 1.3 s after the **last** sentence scores 100%, or when › is tapped on the last line after attempting it. Full-screen: 🏆, dialogue title, average of this session's attempt scores, tiles (perfect / spoken out of N / time since the player opened), a random perseverance quote (`QUOTES`; English + Korean translation and author in ko UI, English only in en UI), canvas confetti (~5 s, own code) and a synthesized "빰빠밤" fanfare (`fanfare()`, Web Audio arpeggio → major chord). 완료 → library.
- ⚙︎ Settings sheet (library header): app language + version line.
- Info: ✎ 수정 opens the editor with that dialogue as md; saving with extra `---` sections inserts them as new dialogues after it. The editor also has 삭제.
- Player: vertical script. Current line centred (big, Korean + masked English word slots + "heard" box); previous lines above and next lines below show **Korean only** (never the English — it is the answer, even for solved lines), faded, with the session score badge on past lines. Free swipe/wheel scroll with CSS `scroll-snap`; when scrolling settles (`onScrollSettle`, 130 ms debounce) the line nearest the centre becomes current. Programmatic scrolls set `progScrollUntil` so they don't re-trigger selection.

## Masking / hint rules (player)
Before/while speaking, a word of the current line is a blank slot (`.w.hid`) until it is said correctly (live → green). After an attempt is scored **every answer word is shown**: correct = green; wrong / missed = the answer word in normal ink, exactly as the 👀 정답 hint shows it, on a light-red slot with a red underline (no strikethrough, no red text), plus the heard word underneath for substitutions. Owner wants the right answer readable in place of the mistake. Tapping the mic again clears the attempt and re-blanks the line. 💡 cycles: 0 blanks → 1 first letter on blanks only → 2 show answer. Hint resets to 0 when the line changes **and when a sentence is scored** (matters in keep mode, where you retry on the same line).

## Scoring (core.js)
- `tokenize()` normalizes both sides: money (`$8.50` → 8 dollars and 50 cents), lowercase, strip punctuation, expand contractions (I've→i have), numbers <100 → words, `%` → percent, hyphens removed (off-peak→offpeak), `'s` → `s` token. Each token keeps the index of its display word.
- `mergeCompounds()` joins two heard tokens when the joined form is in the answer ("off peak" → "offpeak").
- `align()` = word-level Levenshtein with backtrace; modes global / prefix / **local** (free answer words on both sides, so a fragment or a second try lands in the right place).
- **Score = blanks filled / answer words** (owner rule: "You said" is only a reference). `fillWords()` aligns locally each of: the whole transcript, every settled phrase (`finalParts`), and the live guess; a word is filled once it was said right in any of them. In the player `filledSet` accumulates across the whole capture — once green, stays green — so several messy tries that eventually fill every blank score 100%. Extra or wrong words cost nothing.
- After scoring, unfilled words show the answer on a red slot; for substitutions the heard word (from the global alignment) goes underneath.
- Live: as soon as every blank is filled it scores (no need to wait for silence).

## Speech engines (app.js)
- **Browser** (kappy.app, localhost): Web Speech API, `lang=en-US`, `continuous`, `interimResults`, `maxAlternatives=3` (final results pick the alternative overlapping the answer most). Chrome ends a session by itself after silence → `onend` restarts it, keeps text in `baseText`, and shows a toast nudge "🔄 인식이 잠깐 끊겨서…". Fatal errors (not-allowed, network) set `stopRequested` so it doesn't loop.
- **Claude artifact** (the owner also previews it as a claude.ai artifact): the sandbox blocks the mic, so it uses `window.claude.use("dictation")` (declared capability) and `use("downloads")` for Save file. Detected via `window.claude.use`. Don't remove this branch.
- **유지 (keep) button** next to the mic (`keepOn`, `speakup.keep.v3`): one recognition session stays open across sentences (also means fewer iOS start/stop chimes). When a sentence completes (`sentenceDone`: all matched or pause ran out) it scores, then `resetCapture()` starts a fresh capture in the same session — native skips results before index `consumed`; dictation drops the rest of an in-progress phrase (`skipNextFinal`). While waiting for auto-advance, `gated` ignores speech. Speaking again on a scored line starts a new attempt. `select()` keeps the session in keep mode. Tap the mic to turn it off; end of script at 100% stops it.
- Ending a sentence: all words matched → scores at once; **✅ 완료** chip (or Enter) scores what was said so far (blanks may stay unfilled); mic tap stops and scores; otherwise 30 s of silence after some speech (`PAUSE_MS`, fixed — the ⏸ setting chip was removed). In keep mode each of these scores and keeps listening.
- 100% sentence → `chime()`: short rising two-note sine tone made with Web Audio (no file, original — not Duolingo's asset). AudioContext is unlocked on the mic / 완료 tap for iOS. Unverified on iPhone while the mic is open (iOS may duck or route it to the earpiece).
- Firefox has no Web Speech recognition → mic disabled with a message.

## Data (localStorage only — no server)
| key | value |
|---|---|
| `speakup.lib.v3` | `[{id, title, lines:[{spk, en, ko}], created, updated}]` — array order = list order |
| `speakup.best.v3` | `{"<dialogId>|<english sentence>": bestScore}` — keyed by sentence text so reordering lines keeps scores |
| `speakup.pos.v3` | `{dialogId: lastLineIndex}` (Resume button) |
| `speakup.count.v3` | `{dialogId: n}` — +1 on every scored attempt (retries count too); shown as 연습한 문장 on the info page and in the library card |
| `speakup.last.v3` | `{dialogId: ms}` — time of the last scored attempt; library card shows it as 오늘 / 어제 / N일 전 / M월 D일 (`relDate`) |
| `speakup.auto.v3`, `speakup.keep.v3`, `speakup.lang.v3` | settings (`speakup.pause.v3` is obsolete) |
First run seeds the sample dialogue (`SAMPLE_MD`) — the same in every browser, it is not the owner's data. Keep the sample generic: no work/company content (owner asked to replace the old team-meeting sample). On load, an unedited old sample (matched by `OLD_SAMPLE`) is swapped for the current one. If storage throws, a warning banner tells the user to export.
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
- Neighbouring sentences faded for continuity; past sentences scroll up, next ones below. Never show the English of a non-current line, solved or not.
- Hint only fills blanks, never re-hides correct words.
- After scoring, show the correct word in place of each mistake — readable like the 정답 hint, marked wrong only by the red slot — with the heard word underneath.
- Notify (toast) when Chrome drops recognition rather than silently ending.
- Lists: reorder, multi-select delete, edit inside the dialogue, big textarea for adding.

- Info page: no "perfect sentences" progress box and no unique-word / average-length stats (owner removed them); Start sits where the progress box was.
- No login/auth: data never leaves the browser, so others visiting the site can't see it. Owner agreed (2026/11/19) to stay login-free; only revisit if server sync is added.
- Player dock: chips row **above** the mic row (owner taps them a lot): 💡 힌트 · 🔊 듣기 · ⏭ 자동 · ✅ 완료 (one non-wrapping row), then ‹ mic 유지 ›. About 170 px tall with ~30 px bottom padding so the mic isn't glued to the bottom edge — not cramped, not the original ~200 px. No slow-TTS, no pause chip, no engine/hint text lines.

## Versioning
Bump on every change: patch = fix/style, minor = new user-facing feature. Update `package.json` version, the `?v=` cache-busters in `public/index.html`, and add a changelog line.
- **Current version: v3.11.0 — 2026/11/19** (also `VERSION` in app.js, shown in Settings)

## Changelog
- v3.11.0 (2026/11/19): finish screen after the last sentence (average score, stats, confetti, fanfare, perseverance quote, 완료 → list). Settings with app language (system default / 한국어 / English) — all UI strings moved to i18n.js; English version of the AI prompt.
- v3.10.0 (2026/11/19): scoring = blanks filled (accumulated over every try in the attempt; extra/wrong words no longer lower the score). Non-current lines never show English.
- v3.9.0 (2026/11/19): success chime on a 100% sentence (Web Audio two-note tone).
- v3.8.0 (2026/11/19): dock roomier (~1.5×) with chips moved above the mic and more bottom padding; ✅ 완료 chip scores what was said so far; pause fixed at 30 s and the ⏸ chip removed; hint resets after each scored sentence.
- v3.7.0 (2026/11/19): 유지 button keeps the mic on across sentences (score → fresh capture in the same session). Past lines no longer reveal English unless attempted.
- v3.6.1 (2026/11/19): wrong/missed words show the answer in normal ink (like the 정답 hint) on a red-underlined slot — no strikethrough, no red text.
- v3.6.0 (2026/11/19): after scoring, wrong and missed words now reveal the correct answer word (red / strikethrough) instead of staying blank; the heard word stays underneath.
- v3.5.0 (2026/11/19): library cards show practised-sentence count and last practice date (new `speakup.last.v3`) instead of "완벽 x/N" and its progress bar. Fix: editor/export sheets scroll on short screens (Save button was pushed off-screen when the viewport or keyboard left little height).
- v3.4.0 (2026/11/19): sample replaced — "카페에서 커피 주문하기" (Barista/Customer, 17 lines) instead of the team-meeting script; browsers still holding the unedited old sample get it swapped on load. Prompt example switched to café lines. Tokenizer reads `$8.50`/`$8` as dollars/cents.
- v3.3.0 (2026/11/19): compact player dock — removed 🐢 천천히, chips on one non-wrapping row with shorter labels, smaller mic (60px) / nav buttons / result pill, dropped the hint and engine text lines (mic tooltip + `data-engine` instead).
- v3.2.0 (2026/11/19): edit mode gains "N개 내보내기" — export only the selected dialogues (same MD/JSON sheet; a single dialogue gets its title in the filename).
- v3.1.0 (2026/11/19): info page — removed the 완벽하게 말한 문장 box and the 고유 단어 / 평균 길이 tiles; Start/Resume buttons moved up into that spot (bottom bar removed); new 연습한 문장 tile counting every scored attempt per dialogue (`speakup.count.v3`).
- v3.0.0 (2026/11/19): first repo release — library (reorder, multi-delete, add/edit, md/json import-export, 📋 AI prompt), info page, swipe-to-select player, hints on blanks only, Chrome auto-resume nudge, pause setting.


## Ideas not built yet
- Pronunciation scoring (Azure Pronunciation Assessment needs a key + server proxy).
- Cross-device sync, review of weak sentences (spaced repetition), shadowing mode (auto-play TTS then record), service worker/offline.
