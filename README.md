# Speak Up — 영어 말하기 연습

한글 직역만 보고 영어 문장을 말하면, 실시간으로 인식된 텍스트와 함께 정답과 단어별로 비교해 일치율을 보여주는 웹앱이에요.

- 주소: https://speakup.kappy.app
- 서버·로그인 없음. 대화문은 브라우저(localStorage)에만 저장돼요. 백업은 **내보내기**로 해 주세요.
- 음성 인식: Chrome·Edge·Safari (Firefox 미지원). 크롬은 인식에 인터넷이 필요해요.

## 사용법
1. 목록에서 대화를 고르면 정보 화면(문장 수, 단어 수, 전체 대본)이 나오고, **시작**을 누르면 연습이 시작돼요.
2. 마이크를 누르고 한글을 보며 영어로 말해요. 맞힌 단어는 바로 초록색으로 드러나요.
3. 💡 힌트는 빈칸에만 첫 글자 → 정답 순으로 보여줘요. 위아래로 스와이프하면 가운데 문장이 선택돼요.

## 문장만들기
목록 위 탭에서 **문장만들기**를 고르면 교재 훈련 모드예요. 직접 입력은 없고 JSON 파일을 가져와요.
1. **훈련 만들기** → 안에서 **파트 만들기**(번호·제목) → 파트 안에서 **챕터 만들기**(JSON 파일 선택, 번호·제목). 파일 이름이 `Part1-Chapter2.json`이면 번호가 자동으로 채워져요.
2. 챕터를 열면 UNIT, WRITING TIPS, LET'S WRITE A STORY가 보여요. 하나를 누르면 정답 없이 내용이 나오고 **테스트**로 시작해요.
3. 테스트는 한 페이지에 한 문제: STEP 1 문장 늘려가기 → 응용 → STEP 2. 기본은 말하기, 위의 **단어 입력**을 켜면 단어 블록을 탭해 문장을 만들어요.

## 대화문 형식 (.md)
```
# 제목
- Sammy: Good morning, everyone.
- 좋은 아침입니다, 여러분.
- The market rose today.
- 시장이 오늘 올랐습니다.
---
# 다음 대화
...
```
영어 한 줄 + 한글 직역 한 줄이 한 쌍이에요. `- `와 `이름:`은 선택이에요. 텍스트나 이미지를 이 형식으로 바꾸려면 앱의 **📋 프롬프트**를 AI에게 붙여 넣으세요.

## 개발
```
npm run dev     # http://localhost:8000
npm test        # core.js · sxcore.js 단위 테스트
```
`main`에 푸시하면 Cloudflare Workers Builds가 배포해요. 구조와 규칙은 [CLAUDE.md](CLAUDE.md)에 있어요.

### 최초 배포 (한 번만)
Cloudflare 대시보드 → Workers & Pages → Create → *Import a repository* → `songaal/SpeakUp`. 프로젝트 이름 `speakup`, 빌드 명령 비움, 배포 명령 `npx wrangler deploy`. `speakup.kappy.app`은 `wrangler.jsonc`의 `routes`로 자동 연결돼요(kappy.app 존이 같은 계정에 있어야 함).
