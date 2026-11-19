// Built-in content: the sample dialogue and the "make a script with AI" prompt.

export const SAMPLE_MD = `# 카페에서 커피 주문하기
- Barista: Hi there! What can I get for you today?
- 안녕하세요! 오늘 제가 당신을 위해 무엇을 가져다 드릴 수 있을까요?
- Customer: Hi, can I get an iced americano, please?
- 안녕하세요, 제가 아이스 아메리카노 하나를 얻을 수 있을까요, 부탁합니다?
- Barista: Sure. What size would you like?
- 물론이죠. 당신은 어떤 사이즈를 원하시나요?
- Customer: A medium, please.
- 중간 것 하나, 부탁합니다.
- Barista: Would you like an extra shot of espresso?
- 당신은 에스프레소의 추가 샷 하나를 원하시나요?
- Customer: No, thanks. But could I get it with less ice?
- 아니요, 감사합니다. 하지만 제가 그것을 더 적은 얼음과 함께 얻을 수 있을까요?
- Barista: No problem. Is that for here or to go?
- 문제없습니다. 그것은 여기를 위한 것인가요 아니면 가지고 가는 것인가요?
- Customer: To go, please.
- 가지고 가는 것으로, 부탁합니다.
- Barista: Can I get you anything else?
- 제가 당신에게 다른 무언가를 가져다 드릴 수 있을까요?
- Customer: Yes, I'll also have a blueberry muffin.
- 네, 저는 또한 블루베리 머핀 하나를 먹겠습니다.
- Barista: Would you like me to warm it up?
- 당신은 제가 그것을 데우기를 원하시나요?
- Customer: Yes, please. How much is it all together?
- 네, 부탁합니다. 그것은 모두 합쳐서 얼마인가요?
- Barista: That comes to eight dollars and fifty cents.
- 그것은 8달러 그리고 50센트가 됩니다.
- Customer: Can I pay by card?
- 제가 카드로 지불할 수 있나요?
- Barista: Of course. Just tap your card here.
- 물론이죠. 그냥 당신의 카드를 여기에 대세요.
- Barista: Your order will be ready in a few minutes.
- 당신의 주문은 몇 분 안에 준비될 것입니다.
- Customer: Great, thank you so much!
- 좋아요, 정말 많이 감사합니다!`;

// The sample shipped before v3.4.0. Browsers that still hold it unedited get it swapped for SAMPLE_MD (see app.js).
export const OLD_SAMPLE = { title: "검색인프라팀 주간회의", firstEn: "Good morning, everyone. Let's get started with our weekly meeting.", lines: 19 };

// Shown by the 📋 프롬프트 button in the library and copied to the clipboard.
export const CONVERT_PROMPT = `아래 영어 텍스트(대화문, 뉴스, 아티클 등 — 텍스트 또는 이미지)를 영어 말하기 연습 앱에 넣을 수 있는 형식으로 변환해 줘.

[출력 형식]
- 첫 줄은 "# 제목". 제목은 내용을 요약한 짧은 한국어나 영어.
- 그다음 줄부터는 영어 문장 한 줄, 바로 아래 그 문장의 한국어 직역 한 줄을 번갈아 써.
- 한 줄에는 반드시 한 문장만. 문단이나 한 사람의 긴 대사는 문장 단위로 나눠서 각각 영어/한국어 쌍으로 만들어.
- 말하기 연습용이니, 25단어가 넘는 아주 긴 문장은 의미 단위(쉼표, 접속사, 관계사 앞)로 나눠서 각각 한 줄로 만들어도 돼.
- 대화문처럼 화자가 있으면 영어 줄 맨 앞에만 "이름: "을 붙여(한국어 줄에는 붙이지 마). 뉴스나 아티클처럼 화자가 없으면 이름 없이 문장만 써.
- 글이나 대화가 여러 개면 사이에 "---" 한 줄을 넣고, 각각 "# 제목"을 따로 달아.
- 빈 줄, 번호, 글머리 기호, 굵은 글씨, 설명 없이 결과만 코드 블록 하나에 담아 출력해.

[한국어 직역 규칙]
- 자연스러운 의역이 아니라, 영어의 단어와 어순을 최대한 살린 직역으로 써. 한국어만 보고 원래 영어 문장을 떠올리는 연습용이야.
- 영어의 시제, 단수/복수, 전치사 의미가 한국어에 드러나게 해. (예: "We expect to finish it by the end of next week." → "우리는 그것을 다음 주의 끝까지 끝낼 것을 예상합니다.")
- 고유명사, 약어, 제품명(RCA, API 등)은 영어 그대로 둬.

[영어 원문 규칙]
- 원문 표현은 바꾸지 마. 명백한 오타만 고쳐.
- 이미지라면 글자를 정확히 옮기고, 읽을 수 없는 부분은 추측하지 말고 [?]로 표시해.
- 본문과 상관없는 머리말, 기자 이름, 날짜, 사진 설명, 페이지 번호, 광고 문구는 빼.

[예시 — 대화문]
# 카페에서 주문하기
Barista: What size would you like?
당신은 어떤 사이즈를 원하시나요?
Customer: A medium, please.
중간 것 하나, 부탁합니다.

[예시 — 뉴스/아티클]
# 금리 동결
The central bank kept interest rates unchanged on Thursday.
중앙은행은 목요일에 금리들을 변하지 않은 채로 유지했습니다.
Officials said inflation is still too high.
관계자들은 인플레이션이 여전히 너무 높다고 말했습니다.

[변환할 텍스트]
(여기에 붙여 넣거나 이미지를 첨부)`;

// English-UI version of the prompt. The output format is the same (the app is for practising English from Korean).
export const CONVERT_PROMPT_EN = `Convert the English text below (a dialogue, news story, article — given as text or an image) into the format of my English-speaking practice app.

[Output format]
- First line: "# Title" — a short title summarising the content.
- Then alternate: one English sentence on a line, and directly below it a literal Korean translation of that sentence on one line.
- Exactly one sentence per line. Split paragraphs and long turns into sentences, each with its own English/Korean pair.
- For speaking practice, very long sentences (over ~25 words) may be split at natural points (commas, conjunctions, before relative clauses).
- If it is a dialogue with speakers, put "Name: " at the start of the English line only (not the Korean line). If there are no speakers (news, articles), write the sentence without a name.
- If there are several texts or dialogues, put a line with "---" between them and give each its own "# Title".
- Output only the result in a single code block: no blank lines, numbering, bullets, bold or explanations.

[Korean translation rules]
- Translate literally, not naturally: keep the English words and word order as much as possible. The learner reads only the Korean and recalls the original English.
- Make tense, singular/plural and prepositions visible in the Korean. (e.g. "We expect to finish it by the end of next week." → "우리는 그것을 다음 주의 끝까지 끝낼 것을 예상합니다.")
- Keep proper nouns, acronyms and product names (RCA, API …) in English.

[English source rules]
- Don't change the wording; only fix obvious typos.
- For images, transcribe exactly; mark unreadable parts as [?] instead of guessing.
- Drop anything that isn't the body text: headers, bylines, dates, photo captions, page numbers, ads.

[Example — dialogue]
# Ordering at a café
Barista: What size would you like?
당신은 어떤 사이즈를 원하시나요?
Customer: A medium, please.
중간 것 하나, 부탁합니다.

[Example — news / article]
# Rates on hold
The central bank kept interest rates unchanged on Thursday.
중앙은행은 목요일에 금리들을 변하지 않은 채로 유지했습니다.
Officials said inflation is still too high.
관계자들은 인플레이션이 여전히 너무 높다고 말했습니다.

[Text to convert]
(paste it here or attach an image)`;
