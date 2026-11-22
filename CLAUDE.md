# Speak Up — notes for the next agent

English-speaking practice web app with two modes (tabs at the top of the library): **대화** (dialogues) and **문장만들기** (sentence building, see its section). In 대화 the learner sees a **literal (직역) Korean translation**, says the English sentence out loud, sees their words recognized live, and gets a word-by-word comparison with a match score. Content is dialogues *and* plain articles/news (no speaker).

- Live: https://speakup.kappy.app (also `speakup.<account>.workers.dev`)
- Owner: Sammy (Korean speaker). **Reply to the owner in Korean.**
- UI language: Korean + English via `public/js/i18n.js` (`t(key, …args)`; static markup uses `data-i18n`, `data-i18n-html`, `data-i18n-title`, `data-i18n-ph`, `data-i18n-aria`). Choice in ⚙︎ 설정: system (default — `navigator.language` ko* → ko, else en) / 한국어 / English, stored in `speakup.lang.v3`. **Every new UI string must be added to both `STR.ko` and `STR.en`.** Script content (titles, sample) is not translated.
- No zoom (viewport `maximum-scale=1, user-scalable=no`, `touch-action:manipulation`, iOS `gesture*` events blocked, inputs ≥16px so iOS doesn't auto-zoom on focus) while text stays drag-selectable (no `user-select:none` on content).
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
public/js/sx.js          문장만들기 UI: mode tabs, training/part/chapter/item pages, form sheet, unit test (speaking + word blocks), result
public/js/sxcore.js      문장만들기 pure logic: chapter JSON → items, questions, step answers, word blocks  ← unit-tested (tests/sx.test.mjs)
public/js/sxstore.js     IndexedDB store for chapter JSON files (fallback localStorage)
public/js/speech.js      small one-capture recognizer for 문장만들기 + `hub` sharing the artifact `dictation` object with app.js
public/js/fx.js          chime / thud / tick / fanfare (Web Audio), confetti (canvas), say() TTS, haptic — shared by both modes
public/js/content.js     SAMPLE_MD (default dialogue: ordering coffee at a café), OLD_SAMPLE fingerprint, CONVERT_PROMPT / CONVERT_PROMPT_EN (📋 button text per UI language)
public/js/i18n.js        UI strings (STR.ko / STR.en), QUOTES for the finish screen, language choice + applyStatic()
public/manifest.webmanifest, public/icons/   PWA metadata + icons (icon.svg → PNGs via rsvg-convert)
tests/core.test.mjs      node:test suite for core.js
tests/sx.test.mjs        node:test suite for sxcore.js (inline fixture — don't commit the owner's book files, they are copyrighted)
wrangler.jsonc           Cloudflare Worker (static assets only, custom domain speakup.kappy.app)
```

## Views (app.js)
`library` → tap card → `info` (stats tiles: sentences / words / 연습한 문장 = total scored attempts for this dialogue; Start / Resume buttons right under the stats; full text list with best % per line) → `player`.
- Library list is **sorted newest-created first** (display only; `lib` array order is untouched) and each card has a number badge counting down N…1 (newest = N). No manual reorder (▲▼ removed when sorting was introduced).
- Library card: number + title + `N문장 · 연습 N문장 · 마지막 <date>` (or 아직 연습 안 함). No "완벽 x/N" and no progress bar (owner removed them).
- Floating round ＋ button (bottom-right, `#fab`): tap → two round actions pop up above it — 새 대화 (editor sheet) and 가져오기 (file input, .md/.json, many files, **appends**); outside tap closes. Hidden in edit mode.
- Edit mode (✎ 편집) shows checkboxes and a bottom bar: 전체 선택 / N개 내보내기 / N개 삭제 (in-page confirm modal). The edit bar is the library's only bottom bar.
- Export of everything lives in ⚙︎ Settings › 데이터 › 전체 내보내기 (sheet with MD/JSON tabs, Copy, Save file).
- 📋 프롬프트: popover with `CONVERT_PROMPT`; opening it copies to clipboard; closes on outside pointerdown, window blur, Esc, or toggling.
- Finish screen (`showFinish`): shown 1.3 s after the **last** sentence scores 100%, or when › is tapped on the last line after attempting it. Full-screen: 🏆, dialogue title, average of this session's attempt scores, tiles (perfect / spoken out of N / time since the player opened), a random perseverance quote (`QUOTES`; English + Korean translation and author in ko UI, English only in en UI), canvas confetti (~5 s, own code) and a synthesized "빰빠밤" fanfare (`fanfare()`, Web Audio arpeggio → major chord). 완료 → library.
- ⚙︎ Settings sheet (library header, SVG gear icon): app language, 전체 내보내기, version line.
- Info: ✎ 수정 opens the editor with that dialogue as md; saving with extra `---` sections inserts them as new dialogues after it. The editor also has 삭제.
- Player: vertical script. Current line centred (big, Korean + masked English word slots + "heard" box); previous lines above and next lines below show **Korean only** (never the English — it is the answer, even for solved lines), faded, with the session score badge on past lines. Free swipe/wheel scroll with CSS `scroll-snap`; when scrolling settles (`onScrollSettle`, 130 ms debounce) the line nearest the centre becomes current. Programmatic scrolls set `progScrollUntil` so they don't re-trigger selection.

## Masking / hint rules (player)
Before/while speaking, a word of the current line is a blank slot (`.w.hid`) until it is said correctly (live → green). After an attempt is scored **every answer word is shown**: correct = green; wrong / missed = the answer word in normal ink, exactly as the 👀 정답 hint shows it, on a light-red slot with a red underline (no strikethrough, no red text), plus the heard word underneath for substitutions. Owner wants the right answer readable in place of the mistake. Tapping the mic again (or speaking again in keep mode) starts a new attempt, but **words already filled stay green** — `lineFilled[idx]` keeps them for the session and each new capture starts from them (owner: never un-fill a recognised word). 💡 cycles: 0 blanks → 1 first letter on blanks only → 2 show answer. Hint resets to 0 when the line changes **and when a sentence is scored** (matters in keep mode, where you retry on the same line).

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

## 문장만들기 (sentence building) — v3.14.0
Owner's spec (2026/11/22): keep dialogues as 대화, add 문장만들기 as a second type; two tabs on top; once inside a type, stay focused on it. **Import-only**: content is never typed or edited in the app — only numbers and titles.
- **Tabs**: segmented control `#modeTabs` under the library header (sliding pill). `speakup.mode.v1` = "dlg" | "sx"; `body[data-mode]`. In sx mode the library shows `#sxList` (training cards), 📋 프롬프트 / ✎ 편집 / FAB menu are hidden and the ＋ FAB creates a training. Tabs only exist on the library screen.
- **Hierarchy**: 훈련 (training: title) → 파트 (part: number + title, "파트 만들기") → 챕터 (chapter: number + title + one JSON file, "챕터 만들기"). Picking the file fills the chapter number from the filename (`Part1-Chapter2.json` → 2) and the title from `book_title` if empty, and shows a summary (units / tips / story / questions). The file text is stored as-is in IndexedDB (`sxstore.js`, db `speakup`, store `files`, key = chapter id) and parsed into memory (`cache` Map) on create or first open. `navigator.storage.persist()` is requested. ✎ 수정 on training/part/chapter pages opens the same form sheet: rename, renumber, replace the chapter file, delete (asks; deleting removes files and that chapter's scores).
- **sxView** (`#sxView`, one section, `nav = {t, p, c, it}`): part list (PART badges) → chapter list (CH badge, units, answered/total, progress ring) → chapter page (unit cards with grammar focus + main Korean sentence + avg ring, 💡 WRITING TIPS cards, 📖 LET'S WRITE A STORY card) → item page. Extended green FAB "＋ 파트 만들기 / 챕터 만들기". Page changes use the View Transitions API when available.
- **Item page — no answers shown**: unit = hero (UNIT badge, focus, main Korean, core_structure as + chunks), stats (questions / answered / avg), ▶ 테스트 (fresh run from question 1) and, when an unfinished run is saved, ⏯ 이어서 n/N next to it (`speakup.sxsess.v1`), STEP 1 steps (Korean with green "/" separators + hint chips), 응용 (type, prompt, chunk guide, word_hint), STEP 2 (Korean, chunk guide, hint chips), best % per question; tapping a question (any section, one delegated click handler on `#sxBody`, rows are `role=button`) starts the test there, keeping the saved run's scores. Tips = sections (lines starting "예:" become example boxes) or the modal strength ladder (`scale_order`). Story = prompts (Korean, hints, `en_template` only when it contains "..." — otherwise it is the answer) + Test for prompts that have an answer.
- **Questions** (`sxcore.questionsOf`): unit = STEP 1 steps → every variation → every STEP 2 item; story = every prompt. Items without an English answer get `noAnswer` (asked as free speaking, not scored). Answers are cleaned (`cleanAnswer`: drops "(= every Friday)"); the original is shown after answering. STEP 1 steps have no English in the data, so `stepAnswers` builds each one as a prefix of `main_sentence_en`, cut where the step's hint phrase appears (fuzzy stems, after the previous step; the last step = whole sentence). Those pages say "문장 쌓기" and, after answering, "메인 문장에서 만든 정답".
- **Test view** (`#stView`): one question per page, ‹ › buttons, horizontal swipe, ←/→ keys, slide-in animation; segmented progress bar (colour = score); the n/N counter opens a jump grid. ✕ leaves (results are already saved, position kept). Top-right **answer-mode picker** `#stInMode` in this order: 🎤 말하기 / ⌨️ 키보드 입력 / 🧩 단어 블록 (`speakup.sxinput.v2` = "speak" | "type" | "block", **default "type"** — owner, v3.18). 🔊 듣기 is a round speaker button `#stSay` at the right of the question's top row (not in the dock). In blocks/typing the dock has no chip row: 💡 `#stHintW` and ↺ `#stReset` are floating round 52 px buttons side by side just above the dock (right). `wordMode` = not speaking (uses the `.dk-word` dock), `blockMode`, `typeMode` (`#stView.typemode`):
  - Speaking: same masking/scoring as the player (`tokenize`/`fillWords`/`scoreAttempt`, filled words stay filled across retries of a question), 💡 힌트 cycle, ⏭ 자동 (`speakup.sxauto.v1`, next after 100%), ✅ 완료, mic. **유지** button next to the mic (`speakup.sxkeep.v1`) like the player: the session stays open across questions — a finished answer (all blanks / ✅ 완료 / 30 s silence, `capDone`) is scored, then `rec.reset()` starts a fresh capture; while waiting for auto-next `rec.gate(true)` ignores speech; moving to another question (`leaveQ`) resets instead of stopping; the last question at 100% turns the mic off. Recognizer = `speech.js`.
  - 단어 입력 (Word Story's block test): answer words as blocks sorted A→Z; tap to place in the blue tray, tap a placed block to take it back; **hold 150 ms and drag** (`drDown/drStart/drMove/drDrop/drEnd`, same as Word Story's `vtDr*`): drop in the tray at any position, reorder inside it, drop a placed block outside to send it back; moving > 8 px before the hold = scroll/swipe; ghost `.blk.ghost`, insertion bar `.gapm`; taps within 450 ms after a drag are ignored; placing the last block checks by itself; right = green, wrong = red struck-through with the right word under it; 💡 glows the next right block (or shakes the first wrong one); ↺ 다시 resets; the round button is ✓ check → → next.
  - ⌨️ 키보드 입력 (v3.17, `T[qi]` = {slots, vals, ok, bad, done}): one `<input class="tin">` per answer word (`typeSlots`: punctuation stays outside the blank, width grows with the text). Enter / Tab / space (also a space typed on mobile) → next blank still to do (empty or red), Shift+Tab back; Backspace in an empty blank moves to the previous unlocked blank **keeping its text** (cursor at the end, `tKeep`) so further Backspaces delete it from the end, and so on backwards (v3.18.1). As soon as every blank is non-empty and the word being typed is as long as its answer (or already right) it checks by itself (Enter also checks) (`checkTyped`: ignores case, apostrophes, typed punctuation): right words turn green, `readonly` and stay locked; wrong ones turn red. Focusing a blank clears it and lifts its red mark (owner: touching it again leaves check mode, the rest stays as typed). Round button: ✓ = check / jump to the first blank still to do, → = next once all green. 💡 cycles placeholders: first letter → whole word. ↺ 다시 clears the question. The first open blank is focused on every question (choosing ⌨️ or starting the test renders inside the tap, without the view transition, so iOS opens the keyboard). Red boxes never reveal the answer — the learner fixes them.
  - CSS: never use the class name `pop` (the 📋 prompt popover's `.pop` is `display:none`).
  - Sounds: chime on 100%, thud on a wrong block answer, tick on placing; haptics via `navigator.vibrate`.
- Flow: STEP 1 steps → 응용 → STEP 2 in one run; when the section changes a banner shows ("🎉 STEP 1 · 문장 늘려가기 끝! 이제 응용").
- **Skipped questions** (v3.17, `nextStop` in sxcore, tested in tests/sx2.test.mjs): › goes in order until the last question; from there it visits the still-unanswered questions (`S.sweep`, toast "빠진 N문제로 갈게요"), cycling, until none is left → result. Free-speaking questions without an answer are optional (never block the finish). 유지 turns the mic off when nothing is left to answer.
- **No scores shown anywhere in 문장만들기** (owner, v3.17: "점수가 목적이 아니야, 즐겁게 학습하고 넘기는거지"). Scores are still computed internally (best per question, progress colours) but never displayed as numbers: result pill = a word (Perfect! 🎉 / 빨간 칸을 …), item-page rows ✓ (all right once) / • (tried), stats = questions + answered, rings = answered/total progress with ✓ when complete, segbar/grid colours green (all right) / orange (tried).
- **Run memory**: every page change and score saves `{pos, res:{qi: score}, start}` per unit; ✕ leaves it; ⏯ 이어서 restores the scores (shown as colours / pills) and the position. A complete round-1 run deletes it.
- **Result**: only when every question is answered — 🏆 유닛 완료 + item title + "모든 문제를 다 풀었어요" + fanfare + confetti, buttons 처음부터 / 완료. No average, no per-question list, no retry-misses round (removed in v3.17).
- **Data**: `speakup.sx.v1` `{trainings:[{id,title,created,parts:[{id,no,title,created,chapters:[{id,no,title,file,size,created}]}]}]}` · `speakup.sxbest.v1` `{"chapterId|itemIndex|questionKey": best}` (keys `s1:i`, `var:i`, `s2:i`, `st:i`) · `speakup.sxsess.v1` `{"chapterId|itemIndex": {pos, res:{questionIndex: score}, start}}` (unfinished run; `speakup.sxpos.v1` from v3.14 is unused) · IndexedDB files. Not included in 전체 내보내기 (the owner keeps the JSON files).
- **Chapter JSON** (`parseChapter`): `{book_title, units:[{unit, grammar_focus, main_sentence_ko, main_sentence_en, core_structure, step1:{steps:[{step,ko,hint}], variations:[{type,prompt,hint,word_hint?,answer,steps?}]}, step2:[{no,ko,chunk_ko,hint,answer}]}, {type:"WRITING TIPS", topic, sections:[{title,points|examples}] | description + scale_order:[{level,example,meaning}]}, {type:"LET'S WRITE A STORY", title, prompts:[{ko,hint,en_template?,answer}]}]}`. Anything else is ignored; a file without units is refused.

## Owner preferences / decisions so far
- Korean shown, English hidden is the core mode (not reading practice). Korean must be a literal translation to help recall the English word order.
- Neighbouring sentences faded for continuity; past sentences scroll up, next ones below. Never show the English of a non-current line, solved or not.
- Hint only fills blanks, never re-hides correct words.
- After scoring, show the correct word in place of each mistake — readable like the 정답 hint, marked wrong only by the red slot — with the heard word underneath.
- Notify (toast) when Chrome drops recognition rather than silently ending.
- Lists: newest first with countdown numbers, multi-select delete/export, edit inside the dialogue, big textarea for adding, floating ＋ for add/import.
- Give every screen generous bottom space (owner found the bottoms cramped): player dock `40px + safe-area`, sheets `32px`, library bottom padding leaves room for the FAB, info `48px`, finish `44px`.

- Info page: no "perfect sentences" progress box and no unique-word / average-length stats (owner removed them); Start sits where the progress box was.
- No login/auth: data never leaves the browser, so others visiting the site can't see it. Owner agreed (2026/11/19) to stay login-free; only revisit if server sync is added.
- Player dock: chips row **above** the mic row (owner taps them a lot): 💡 힌트 · 🔊 듣기 · ⏭ 자동 · ✅ 완료 (one non-wrapping row), then ‹ mic 유지 ›. About 170 px tall with ~30 px bottom padding so the mic isn't glued to the bottom edge — not cramped, not the original ~200 px. No slow-TTS, no pause chip, no engine/hint text lines.

## Versioning
Bump on every change: patch = fix/style, minor = new user-facing feature. Update `package.json` version, the `?v=` cache-busters in `public/index.html`, and add a changelog line.
- **Current version: v3.18.1 — 2026/11/22** (also `VERSION` in app.js, shown in Settings)

## Changelog
- v3.18.1 (2026/11/22): 키보드 입력 — checks as soon as every blank is filled (no Enter needed); Backspace in an empty blank walks back into the previous one and keeps deleting from its end.
- v3.18.0 (2026/11/22): 문장만들기 test — ⌨️ 키보드 입력 is the default and focuses the first blank (also when picked); picker order 🎤 ⌨️ 🧩; 🔊 듣기 became a speaker button beside the question; 💡 힌트 and ↺ 다시 are floating round buttons above the dock.
- v3.17.0 (2026/11/22): 문장만들기 — ⌨️ 키보드 입력 mode (type each word into its blank, Enter/Tab/space → next, checks when all filled, right = green + locked, wrong = red, touching a blank clears it and lifts check mode); answer-mode picker 🎤 / 🧩 / ⌨️ replaces the 단어 입력 switch; no score numbers anywhere (pills, rows, rings, result); › after the last question goes round the skipped ones, and the result (🏆 + confetti, no score) comes only when all are answered.
- v3.16.0 (2026/11/22): 단어 입력 drag & drop like Word Story — hold a block 150 ms and drag: drop into the tray at any position (insert), reorder placed blocks, drop a placed block outside the tray to send it back; ghost + blue insertion bar; haptic on pick-up/drop (iOS 18 switch trick added to fx.haptic). Swipe ignores block drags.
- v3.15.1 (2026/11/22): fix — the newest placed word block was invisible (class `pop` collided with the prompt popover's `.pop{display:none}`; now `landed`). Questions whose file entry has no English answer (variations / STEP 2 / story) are no longer dropped: they are asked as unscored "정답 없이 말하기" (speak freely, the transcript is kept, excluded from averages/best; word blocks and 듣기 unavailable). Answer field also read from answer_en / en / english / model_answer / sample_answer / example.
- v3.15.0 (2026/11/22): 문장만들기 — 유지 (mic stays on across questions); trophy only when the whole unit is answered, else 중간 결과 + 남은 문제 풀기; section banner STEP 1 → 응용 → STEP 2; unfinished run remembered with ⏯ 이어서 next to 테스트; question rows of every section open the test (delegated handler).
- v3.14.0 (2026/11/22): 문장만들기 mode — 대화 | 문장만들기 tabs; trainings → parts → chapters (JSON import, IndexedDB); unit/tips/story pages without answers; unit test one question per page with speaking (default) or 단어 입력 word blocks, TTS, swipe, jump grid, result screen with retry of misses. Sound/confetti/TTS moved to fx.js.
- v3.13.0 (2026/11/20): library sorted newest first with countdown numbers (manual reorder removed); floating ＋ with 새 대화 / 가져오기; 전체 내보내기 moved to Settings; bigger SVG gear; more bottom space on every screen.
- v3.12.0 (2026/11/19): filled words stay filled across retries of a line (session); zoom disabled (pinch, double-tap, focus) with text selection still allowed.
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
