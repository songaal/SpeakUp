// UI strings. Korean (ko) and English (en). Values are strings or functions of arguments.
// Static markup uses data-i18n / data-i18n-html / data-i18n-title / data-i18n-ph / data-i18n-aria attributes (applied by applyStatic).
// Choice: localStorage "speakup.lang.v3" = "system" | "ko" | "en"; "system" follows navigator.language (ko* → ko, else en).

export const STR = {
  ko: {
    prompt: "📋 프롬프트", promptTitle: "AI에게 대화문 변환 요청하기", copied: "복사됨 ✓", copyManually: "직접 복사해 주세요", copyAgain: "다시 복사",
    promptCopiedToast: "프롬프트를 복사했어요",
    edit: "✎ 편집", done: "완료", settings: "설정", fabNew: "새 대화", addMenu: "추가", dataLabel: "데이터", exportAll: "전체 내보내기",
    storeWarn: "이 브라우저에서는 저장이 안 돼요. 창을 닫으면 대화가 사라지니 내보내기로 백업하세요.",
    addNew: "＋ 새 대화", import: "가져오기", export: "내보내기", selectAll: "전체 선택", deselectAll: "선택 해제",
    del: "삭제", delN: n => `${n}개 삭제`, exportN: n => `${n}개 내보내기`,
    moveUp: "위로", moveDown: "아래로",
    empty: "아직 대화가 없어요.", addSample: "샘플 대화 추가",
    cardMeta: (n, cnt, last) => `${n}문장 · ` + (cnt ? `연습 ${cnt}문장` + (last ? ` · 마지막 ${last}` : "") : "아직 연습 안 함"),
    today: "오늘", yesterday: "어제", daysAgo: n => `${n}일 전`,
    dateMD: d => `${d.getMonth() + 1}월 ${d.getDate()}일`, dateYMD: d => `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`,
    confirmDeleteN: n => `대화 ${n}개를 삭제할까요? 되돌릴 수 없어요.`, confirmDeleteOne: t => `"${t}" 대화를 삭제할까요?`, cancel: "취소",
    deletedN: n => `${n}개 삭제했어요`, deleted: "삭제했어요",
    addTitle: "새 대화 추가", editTitle: "대화 수정",
    editorHelp: "첫 줄은 <b># 제목</b>, 그다음부터 <b>영어 한 줄 → 한글 직역 한 줄</b>이 한 쌍이에요. 줄 앞의 <b>- </b>와 <b>이름:</b>은 있어도 없어도 돼요. <b>---</b>로 나누면 여러 대화를 한 번에 추가해요.",
    editorPh: "여기에 붙여 넣으세요", save: "저장",
    noEnglish: "영어 문장을 하나도 찾지 못했어요. 형식을 확인해 주세요.",
    addedN: n => `대화 ${n}개를 추가했어요`, addedOne: t => `"${t}" 추가했어요`,
    editedPlus: n => `수정했고, 대화 ${n}개를 새로 추가했어요`, edited: "수정했어요",
    importFailed: n => ` (실패 ${n})`, nothingToImport: "가져올 대화를 찾지 못했어요",
    exportTitle: "내보내기", exportInfo: (all, n, s) => `${all ? "전체" : "선택한"} 대화 ${n}개 · ${s}문장`, nothingToExport: "내보낼 대화가 없어요",
    close: "닫기", copy: "복사", saveFile: "파일로 저장", copiedToast: "복사했어요", selectedCopy: "선택됐어요. 직접 복사해 주세요",
    savedFile: "저장했어요", saveCancelled: "저장이 취소됐어요",
    back: "‹ 목록", editInfo: "✎ 수정",
    stSentences: "문장", stWords: "단어", stPracticed: "연습한 문장",
    fromStart: "처음부터", resumeAt: n => `▶ ${n}번째부터 이어서`, start: "▶ 시작",
    sayIt: "한글 직역을 보고 영어로 말해 보세요.", noTranslation: "(번역 없음)",
    hint0: "💡 힌트", hint1: "💡 첫 글자", hint2: "👀 정답", listen: "🔊 듣기", auto: "⏭ 자동", doneChip: "✅ 완료",
    keep: "유지", keepTitle: "마이크를 계속 켜 두기",
    keepOnToast: "마이크를 계속 켜 둬요. 끄려면 마이크를 누르세요", keepOffToast: "문장마다 마이크를 켜고 꺼요",
    listening: "LISTENING…", listeningPh: "듣고 있어요…", youSaid: "YOU SAID", nothingHeard: "아무 말도 인식되지 않았어요. 다시 해 볼까요?",
    blanks: (a, b) => `빈칸 ${a}/${b}`, wrongN: n => `틀림 ${n}`, missedN: n => `빠짐 ${n}`,
    micIdle: "탭해서 말하기", micKeep: "계속 듣는 중… 탭하면 마이크 끔", micTalk: "말하는 중… 탭하면 채점",
    errMic: "마이크 권한이 막혀 있어요. 주소창 왼쪽 아이콘에서 마이크를 허용해 주세요.",
    errNetwork: "음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
    errOther: e => "음성 인식 오류: " + e, errDictDenied: "마이크 사용이 허용되지 않았어요.", errDictStart: e => "받아쓰기를 시작하지 못했어요: " + e,
    errStart: "음성 인식을 시작하지 못했어요.", errUnsupported: "이 브라우저는 음성 인식을 지원하지 않아요. Chrome·Edge·Safari에서 열어 주세요.",
    resumed: "🔄 인식이 잠깐 끊겨서 다시 듣는 중이에요",
    prevLine: "이전 문장", nextLine: "다음 문장", toInfo: "정보로", editDialog: "대화 수정",
    langLabel: "앱 언어", langSystem: "시스템 설정 따르기", langKo: "한국어", langEn: "English",
    finTitle: "끝까지 해냈어요!", finAvg: "평균 점수", finPerfect: "완벽한 문장", finSpoken: "말한 문장", finTime: "걸린 시간",
    minSec: (m, s) => m ? `${m}분 ${s}초` : `${s}초`, finDone: "완료",
  },
  en: {
    prompt: "📋 Prompt", promptTitle: "Ask an AI to convert a script", copied: "Copied ✓", copyManually: "Please copy it manually", copyAgain: "Copy again",
    promptCopiedToast: "Prompt copied",
    edit: "✎ Edit", done: "Done", settings: "Settings", fabNew: "New dialogue", addMenu: "Add", dataLabel: "Data", exportAll: "Export everything",
    storeWarn: "This browser can't save data. Your dialogues disappear when you close it — back them up with Export.",
    addNew: "＋ New", import: "Import", export: "Export", selectAll: "Select all", deselectAll: "Deselect",
    del: "Delete", delN: n => `Delete ${n}`, exportN: n => `Export ${n}`,
    moveUp: "Move up", moveDown: "Move down",
    empty: "No dialogues yet.", addSample: "Add the sample dialogue",
    cardMeta: (n, cnt, last) => `${n} sentence${n === 1 ? "" : "s"} · ` + (cnt ? `${cnt} practised` + (last ? ` · last ${last}` : "") : "not practised yet"),
    today: "today", yesterday: "yesterday", daysAgo: n => `${n} days ago`,
    dateMD: d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), dateYMD: d => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    confirmDeleteN: n => `Delete ${n} dialogue${n > 1 ? "s" : ""}? This can't be undone.`, confirmDeleteOne: t => `Delete "${t}"?`, cancel: "Cancel",
    deletedN: n => `Deleted ${n}`, deleted: "Deleted",
    addTitle: "New dialogue", editTitle: "Edit dialogue",
    editorHelp: "First line <b># Title</b>, then pairs of <b>one English line → one literal Korean line</b>. A leading <b>- </b> and <b>Name:</b> are optional. Separate several dialogues with <b>---</b>.",
    editorPh: "Paste here", save: "Save",
    noEnglish: "No English sentences found. Please check the format.",
    addedN: n => `Added ${n} dialogues`, addedOne: t => `Added "${t}"`,
    editedPlus: n => `Saved, and added ${n} new dialogue${n > 1 ? "s" : ""}`, edited: "Saved",
    importFailed: n => ` (${n} failed)`, nothingToImport: "No dialogues found to import",
    exportTitle: "Export", exportInfo: (all, n, s) => `${all ? "All" : "Selected"}: ${n} dialogue${n > 1 ? "s" : ""} · ${s} sentences`, nothingToExport: "Nothing to export",
    close: "Close", copy: "Copy", saveFile: "Save file", copiedToast: "Copied", selectedCopy: "Selected — please copy it manually",
    savedFile: "Saved", saveCancelled: "Save cancelled",
    back: "‹ List", editInfo: "✎ Edit",
    stSentences: "sentences", stWords: "words", stPracticed: "practised",
    fromStart: "From the start", resumeAt: n => `▶ Resume at #${n}`, start: "▶ Start",
    sayIt: "Read the Korean and say it in English.", noTranslation: "(no translation)",
    hint0: "💡 Hint", hint1: "💡 First letter", hint2: "👀 Answer", listen: "🔊 Listen", auto: "⏭ Auto", doneChip: "✅ Done",
    keep: "Keep", keepTitle: "Keep the mic on",
    keepOnToast: "The mic stays on. Tap the mic to turn it off", keepOffToast: "The mic turns on and off for each sentence",
    listening: "LISTENING…", listeningPh: "Listening…", youSaid: "YOU SAID", nothingHeard: "Nothing was recognised. Try again?",
    blanks: (a, b) => `Blanks ${a}/${b}`, wrongN: n => `${n} wrong`, missedN: n => `${n} missed`,
    micIdle: "Tap to speak", micKeep: "Listening… tap to turn the mic off", micTalk: "Listening… tap to score",
    errMic: "Microphone access is blocked. Allow it from the icon at the left of the address bar.",
    errNetwork: "Couldn't reach the speech recognition server. Check your connection.",
    errOther: e => "Speech recognition error: " + e, errDictDenied: "Microphone access wasn't allowed.", errDictStart: e => "Couldn't start dictation: " + e,
    errStart: "Couldn't start speech recognition.", errUnsupported: "This browser doesn't support speech recognition. Please use Chrome, Edge or Safari.",
    resumed: "🔄 Recognition dropped for a moment — listening again",
    prevLine: "Previous sentence", nextLine: "Next sentence", toInfo: "Back to info", editDialog: "Edit dialogue",
    langLabel: "App language", langSystem: "Follow system", langKo: "한국어", langEn: "English",
    finTitle: "You made it to the end!", finAvg: "Average", finPerfect: "Perfect", finSpoken: "Spoken", finTime: "Time",
    minSec: (m, s) => m ? `${m}m ${s}s` : `${s}s`, finDone: "Done",
  },
};

// Perseverance quotes for the finish screen (public-domain sayings and proverbs).
export const QUOTES = [
  { en: "It does not matter how slowly you go as long as you do not stop.", by: "Confucius", ko: "멈추지 않는 한, 얼마나 천천히 가는지는 중요하지 않다.", byKo: "공자" },
  { en: "Great works are performed not by strength but by perseverance.", by: "Samuel Johnson", ko: "위대한 일은 힘이 아니라 인내로 이루어진다.", byKo: "새뮤얼 존슨" },
  { en: "Energy and persistence conquer all things.", by: "Benjamin Franklin", ko: "열정과 끈기는 모든 것을 이긴다.", byKo: "벤저민 프랭클린" },
  { en: "The drops of rain make a hole in the stone, not by violence, but by oft falling.", by: "Lucretius", ko: "빗방울이 돌에 구멍을 내는 것은 힘이 아니라 끊임없이 떨어지기 때문이다.", byKo: "루크레티우스" },
  { en: "Slow and steady wins the race.", by: "Aesop", ko: "느려도 꾸준하면 경주에서 이긴다.", byKo: "이솝" },
  { en: "A journey of a thousand miles begins with a single step.", by: "Laozi", ko: "천 리 길도 한 걸음부터.", byKo: "노자" },
  { en: "Little by little, a little becomes a lot.", by: "Tanzanian proverb", ko: "조금씩 조금씩, 작은 것이 큰 것이 된다.", byKo: "탄자니아 속담" },
  { en: "Rome was not built in a day.", by: "Proverb", ko: "로마는 하루아침에 이루어지지 않았다.", byKo: "속담" },
  { en: "Patience is bitter, but its fruit is sweet.", by: "Jean-Jacques Rousseau", ko: "인내는 쓰지만 그 열매는 달다.", byKo: "장 자크 루소" },
];

const LANG_KEY = "speakup.lang.v3";
export function langChoice() { try { return localStorage.getItem(LANG_KEY) || "system"; } catch (e) { return "system"; } }
export function setLangChoice(v) { try { localStorage.setItem(LANG_KEY, v); } catch (e) {} }
export function resolveLang(choice = langChoice()) {
  if (choice === "ko" || choice === "en") return choice;
  return /^ko\b/i.test(navigator.language || "") ? "ko" : "en";
}
let cur = resolveLang();
export const lang = () => cur;
export function setLang(l) { cur = l; document.documentElement.lang = l; }
export function t(key, ...args) {
  const v = (STR[cur] && STR[cur][key]) ?? STR.ko[key];
  return typeof v === "function" ? v(...args) : (v ?? key);
}
export function applyStatic(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}
