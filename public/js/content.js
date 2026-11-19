// Built-in content: the sample dialogue and the "make a script with AI" prompt.

export const SAMPLE_MD = `# 검색인프라팀 주간회의
- Sammy: Good morning, everyone. Let's get started with our weekly meeting.
- 좋은 아침입니다, 여러분. 우리의 주간 회의를 시작합시다.
- Sammy: First, let's go over the action items from last week.
- 먼저, 지난주로부터의 액션 아이템들을 검토합시다.
- Jin: The indexing pipeline migration is about eighty percent done.
- 인덱싱 파이프라인 마이그레이션은 약 80퍼센트 완료되었습니다.
- Jin: We expect to finish it by the end of next week.
- 우리는 그것을 다음 주의 끝까지 끝낼 것을 예상합니다.
- Sammy: Great. Were there any issues during the rollout?
- 좋습니다. 롤아웃 동안에 어떤 문제들이 있었나요?
- Jin: We had one incident on Tuesday, but it was resolved within an hour.
- 우리는 화요일에 하나의 장애를 가졌지만, 그것은 한 시간 이내에 해결되었습니다.
- Sammy: Please share the RCA document with the team by Friday.
- 금요일까지 RCA 문서를 팀과 공유해 주세요.
- Mina: Moving on to cost, we saw a spike in compute usage last Thursday.
- 비용으로 넘어가서, 우리는 지난 목요일에 컴퓨트 사용량에서 급증을 보았습니다.
- Mina: It was caused by a full reindex of the Eats corpus.
- 그것은 Eats 코퍼스의 전체 재색인에 의해 야기되었습니다.
- Sammy: Can we schedule full reindexes during off-peak hours from now on?
- 우리가 지금부터 전체 재색인들을 피크가 아닌 시간들 동안에 예약할 수 있을까요?
- Mina: Sure, I'll talk to the Eats team and set it up.
- 물론이죠, 제가 Eats 팀에게 이야기하고 그것을 설정하겠습니다.
- Kevin: From the Taiwan side, query latency has improved by fifteen percent.
- 대만 쪽으로부터, 쿼리 지연 시간이 15퍼센트만큼 개선되었습니다.
- Sammy: That's impressive. What made the biggest difference?
- 그것은 인상적입니다. 무엇이 가장 큰 차이를 만들었나요?
- Kevin: We tuned the cache settings and removed some unused fields from the index.
- 우리는 캐시 설정들을 조정했고 인덱스로부터 몇몇 사용되지 않는 필드들을 제거했습니다.
- Sammy: Nice work. Let's apply the same changes to the other corpora.
- 좋은 작업입니다. 같은 변경들을 다른 코퍼스들에 적용합시다.
- Sammy: Also, the Reco team asked for a new field in the product index.
- 또한, Reco 팀이 상품 인덱스 안에 새로운 필드를 요청했습니다.
- Jin: I can take that one. Do we have a deadline?
- 제가 그것을 맡을 수 있습니다. 우리는 마감일을 가지고 있나요?
- Sammy: They need it before the end of the month.
- 그들은 그것을 그 달의 끝 전에 필요로 합니다.
- Sammy: Okay, I think that covers everything. Thanks for your hard work, everyone.
- 좋아요, 저는 그것이 모든 것을 다룬다고 생각합니다. 여러분의 힘든 일에 대해 감사합니다.`;

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
# 주간 회의
Sammy: Good morning, everyone.
좋은 아침입니다, 여러분.
Jin: The migration is about eighty percent done.
마이그레이션은 약 80퍼센트 완료되었습니다.

[예시 — 뉴스/아티클]
# 금리 동결
The central bank kept interest rates unchanged on Thursday.
중앙은행은 목요일에 금리들을 변하지 않은 채로 유지했습니다.
Officials said inflation is still too high.
관계자들은 인플레이션이 여전히 너무 높다고 말했습니다.

[변환할 텍스트]
(여기에 붙여 넣거나 이미지를 첨부)`;
