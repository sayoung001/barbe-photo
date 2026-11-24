/*
 * 바흐브 현장사진 — 종류 표
 *
 * folder 는 드라이브 '바흐브_폰사진' 아래 폴더이자, PC 로 가져올 때 '서류투입' 아래 폴더다.
 * 그래서 이름과 하위폴더 문법은 바흐브 config.yaml documents.categories 와 같아야 한다 (2026-11-23 대조).
 *   {MMDD}      찍은 날 1123
 *   {YYYYMMDD}  찍은 날 20261123
 *   {ask}       촬영 전에 적는 말 (회차·내용) — 비우면 촬영 버튼이 막힌다
 *   {sub}       세부 고르기 값 (subs 의 folder 조각)
 * read 가 있는 칸은 찍으면 칠판 숫자를 읽어 평균을 보여 준다 (값 = boards.js 의 칠판 이름 = 바흐브 templates/칠판)
 *
 * 칸을 늘리려면 여기 한 줄만 더 적는다. 바흐브 쪽에 같은 이름의 칸이 없으면 서류투입에서 '보류' 로 남는다.
 */
window.BARBE_CATEGORIES = [
  { id: "material", label: "자재검수", icon: "📦", folder: "자재검수/{MMDD}" },
  // 레미콘 두 칸은 같은 서류투입 '레미콘' 칸으로 간다 — 바흐브가 칠판을 읽어 물성/압축강도를 가른다 (2026-11-24)
  { id: "remiconprop", label: "레미콘 물성", icon: "🌡️", hint: "회차마다 전체 1장 + 칠판 확대 1장 (타설위치 끝에 #1·#2 회차를 적어도 돼요) — 칠판을 찍으면 슬럼프·공기량·염화물·온도를 읽어 합격 여부를 알려 줘요. 슬럼프콘·공기량계·염화물 과정 사진도 이 칸에 이어서", folder: "레미콘/{MMDD}", read: "레미콘" },
  { id: "remicon", label: "레미콘 압축강도", icon: "🚚", hint: "공시체 깨는 날 — 전체 1장 + 칠판 확대 1장. 칠판을 찍으면 조별·전체 평균을 알려 줘요", folder: "레미콘/{MMDD}", read: "레미콘" },
  {
    id: "civil", label: "BSCW·JSP 압축강도", icon: "🧪",
    hint: "시험한 날 찍기 — 칠판을 찍으면 S1~S3 평균을 알려 줘요", read: "BSCW_JSP",
    subs: [
      { label: "BSCW 7일", folder: "BSCW_7일" },
      { label: "BSCW 28일", folder: "BSCW_28일" },
      { label: "JSP 7일", folder: "JSP_7일" },
      { label: "JSP 28일", folder: "JSP_28일" },
    ],
    folder: "토목가시설/{sub}",
  },
  { id: "sample", label: "시료채취", icon: "🧫", folder: "시료채취/{YYYYMMDD}" },
  { id: "phcshape", label: "PHC 겉모양·치수", icon: "📏", folder: "PHC_겉모양/{YYYYMMDD}" },
  { id: "wc", label: "물시멘트비", icon: "💧", ask: { label: "회차", placeholder: "예: 28" }, folder: "물시멘트비/{ask}" },
  { id: "seal", label: "시료봉인", icon: "🔒", folder: "시료봉인/{MMDD}" },
  { id: "plate", label: "평판재하", icon: "⚖️", folder: "평판재하/{MMDD}" },
  { id: "load", label: "재하시험", icon: "🏗️", ask: { label: "내용", placeholder: "예: 1123_103동_재항타" }, folder: "의뢰시험_재하/{ask}" },
  { id: "mt", label: "MT", icon: "🧲", ask: { label: "내용", placeholder: "예: 1123_105동" }, folder: "의뢰시험_MT/{ask}" },
  { id: "unknown", label: "잘 모르겠음", icon: "❔", hint: "PC 에서 사람이 칸을 정한다", folder: "_분류대기/{MMDD}" },
];
