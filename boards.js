/* 칠판틀_내보내기.py 가 바흐브 templates/칠판 에서 만든 파일 — 손으로 고치지 말 것 */
window.BARBE_BOARDS = {
 "레미콘": {
  "desc": "레미콘 현장 시험 칠판 (물성시험 또는 공시체 압축강도)",
  "fields": [
   {
    "key": "종류",
    "label": "종류",
    "type": "enum",
    "values": [
     "물성",
     "압축강도"
    ]
   },
   {
    "key": "공종",
    "label": "공종",
    "type": "enum",
    "values": [
     "건축",
     "토목",
     "조경"
    ]
   },
   {
    "key": "규격",
    "label": "규격",
    "type": "text"
   },
   {
    "key": "타설위치",
    "label": "타설위치",
    "type": "text"
   },
   {
    "key": "슬럼프",
    "label": "슬럼프",
    "type": "number",
    "dec": 0,
    "unit": "㎜",
    "range": [
     0.0,
     300.0
    ]
   },
   {
    "key": "공기량",
    "label": "공기량",
    "type": "number",
    "dec": 1,
    "unit": "%",
    "range": [
     0.0,
     15.0
    ]
   },
   {
    "key": "염화물1",
    "label": "염화물 1차",
    "type": "number",
    "dec": 3,
    "unit": "㎏/㎥",
    "range": [
     0.0,
     1.0
    ]
   },
   {
    "key": "염화물2",
    "label": "염화물 2차",
    "type": "number",
    "dec": 3,
    "unit": "㎏/㎥",
    "range": [
     0.0,
     1.0
    ]
   },
   {
    "key": "단위수량",
    "label": "단위수량",
    "type": "number",
    "dec": 2,
    "range": [
     0.0,
     250.0
    ]
   },
   {
    "key": "콘크리트온도",
    "label": "콘크리트온도",
    "type": "number",
    "dec": 1,
    "unit": "℃",
    "range": [
     -10.0,
     50.0
    ]
   },
   {
    "key": "외기온도",
    "label": "외기온도",
    "type": "number",
    "dec": 1,
    "unit": "℃",
    "range": [
     -30.0,
     45.0
    ]
   },
   {
    "key": "공시체",
    "label": "공시체",
    "type": "enum",
    "values": [
     "수중",
     "현장",
     "수직",
     "수평",
     "동바리해체"
    ]
   },
   {
    "key": "조1_1",
    "label": "1조-1",
    "type": "number",
    "dec": 1,
    "group": "1조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조1_2",
    "label": "1조-2",
    "type": "number",
    "dec": 1,
    "group": "1조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조1_3",
    "label": "1조-3",
    "type": "number",
    "dec": 1,
    "group": "1조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조2_1",
    "label": "2조-1",
    "type": "number",
    "dec": 1,
    "group": "2조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조2_2",
    "label": "2조-2",
    "type": "number",
    "dec": 1,
    "group": "2조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조2_3",
    "label": "2조-3",
    "type": "number",
    "dec": 1,
    "group": "2조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조3_1",
    "label": "3조-1",
    "type": "number",
    "dec": 1,
    "group": "3조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조3_2",
    "label": "3조-2",
    "type": "number",
    "dec": 1,
    "group": "3조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "조3_3",
    "label": "3조-3",
    "type": "number",
    "dec": 1,
    "group": "3조",
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "평균",
    "label": "평균(칠판)",
    "type": "number",
    "dec": 1,
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "품질기준",
    "label": "품질기준",
    "type": "number",
    "dec": 1,
    "unit": "MPa",
    "range": [
     0.0,
     80.0
    ]
   },
   {
    "key": "납품사",
    "label": "납품사",
    "type": "text"
   },
   {
    "key": "타설일자",
    "label": "타설일자",
    "type": "date"
   },
   {
    "key": "시험일자",
    "label": "시험일자",
    "type": "date"
   }
  ]
 },
 "BSCW_JSP": {
  "desc": "흙막이 공시체 압축강도 칠판 (S1~S3, F7/F28)",
  "fields": [
   {
    "key": "제작일",
    "label": "제작일",
    "type": "date"
   },
   {
    "key": "단계",
    "label": "재령",
    "type": "enum",
    "values": [
     "F7",
     "F28"
    ]
   },
   {
    "key": "S1",
    "label": "S-1",
    "type": "number",
    "dec": 2,
    "group": "S",
    "unit": "MPa",
    "range": [
     0.0,
     10.0
    ]
   },
   {
    "key": "S2",
    "label": "S-2",
    "type": "number",
    "dec": 2,
    "group": "S",
    "unit": "MPa",
    "range": [
     0.0,
     10.0
    ]
   },
   {
    "key": "S3",
    "label": "S-3",
    "type": "number",
    "dec": 2,
    "group": "S",
    "unit": "MPa",
    "range": [
     0.0,
     10.0
    ]
   },
   {
    "key": "일자",
    "label": "시험일자",
    "type": "date"
   },
   {
    "key": "업체",
    "label": "업체",
    "type": "text"
   },
   {
    "key": "품명",
    "label": "품명",
    "type": "text"
   }
  ]
 }
};
window.BARBE_READ = {"models": ["claude-opus-4-5", "claude-sonnet-5"], "maxEdge": 1600};
window.BARBE_STD = {"슬럼프25": 10, "슬럼프50": 15, "슬럼프80": 25, "공기량기준": 4.5, "공기량허용": 1.5, "염화물상한": 0.3, "온도하한": 10, "온도상한": 35, "한중하한": 5, "한중상한": 20};
