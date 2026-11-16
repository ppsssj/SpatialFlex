# LiveFragment

**Picture-in-Picture, beyond video.**

> 웹페이지에서 원하는 요소만 꺼내, 원본과 연결된 상태로 나만의 작업 공간에 배치합니다.

**Status:** Concept · Pre-implementation  
**Focus:** Web Element Extraction · Live Synchronization · User-defined Layouts · Spatial Computing

LiveFragment는 웹사이트가 정해 놓은 레이아웃에서 필요한 요소만 **선택(Select)**하고, **분리(Detach)**하고, **계속 갱신(Synchronize)**하여 자신만의 공간에 배치할 수 있도록 하는 오픈소스 프로젝트입니다.

현재는 아이디어와 기술 검증 계획을 정리하는 단계입니다. 아래의 기능과 API는 구현 완료된 제품을 설명하는 것이 아니라, 앞으로 검증할 목표입니다.

---

## 1. From CLI to GUI — 인터페이스는 계속 변화해 왔습니다

컴퓨터를 사용하는 방식은 기술과 장치의 발전에 따라 달라져 왔습니다.

| 환경 | 정보 표현 | 주요 상호작용 | 인터페이스 구조 |
| --- | --- | --- | --- |
| CLI | 텍스트와 명령 | 키보드 | 명령과 출력 중심 |
| GUI | 창, 아이콘, 메뉴 | 마우스·키보드 | 2D 화면의 시각적 객체 |
| Mobile | 터치 중심 화면 | 터치·센서 | 작은 화면에 적응하는 레이아웃 |
| XR | 현실과 디지털 객체의 결합 | 손·시선·음성 등 | 공간을 활용하는 인터페이스 |

CLI에서 GUI로의 확산은 단순한 외형 변경이 아니었습니다. 사람들이 정보를 찾고, 작업을 실행하고, 객체를 조작하는 방식이 달라졌습니다.

마우스와 GUI는 함께 발전했고, 터미널이 사라지지 않았듯 기존 2D 화면도 앞으로 계속 유용할 것입니다.

이제 XR은 화면의 바깥까지 인터페이스를 확장할 수 있는 새로운 환경을 제공합니다.

**그렇다면 레이아웃도 여전히 개발자가 미리 정한 페이지에 묶여 있어야 할까요?**

## 2. A Familiar Example — YouTube Picture-in-Picture

우리는 이미 비슷한 변화를 경험했습니다.

과거에는 모바일에서 영상을 보려면 대개 전체 화면 또는 앱 내부의 작은 플레이어를 사용했습니다.

이제 Picture-in-Picture(PIP)를 지원하는 환경에서는 **영상만 독립된 창으로 띄워 놓고, 다른 앱에서 작업을 이어갈 수 있습니다.**

```text
이전: YouTube 화면 → 영상 시청

PIP:  YouTube 영상 ── 분리 ──▶ 작은 독립 플레이어
                                   │
                                   └─ 다른 작업을 하면서 계속 재생
```

PIP의 핵심은 영상을 작게 만드는 데 있지 않습니다.

- 영상이 **원래 페이지 또는 앱의 배치에서 벗어납니다.**
- 사용자는 영상의 **위치와 크기를 어느 정도 직접 결정**할 수 있습니다.
- 영상은 **독립된 상태에서도 재생을 이어갑니다.**

즉, **콘텐츠가 원본 레이아웃에서 독립해도 살아 있을 수 있다**는 경험을 보여줍니다.

### What if PIP worked for more than video?

**동영상뿐 아니라 이미지, 문서, README, 차트 등 원하는 웹 요소도 이렇게 분리할 수 있다면 어떨까요?**

LiveFragment는 이 질문에서 출발합니다.

## 3. The Problem — 웹페이지가 정한 배치가 전부일 필요는 없습니다

### Case A. 이미지 세 장 중 하나만 보고 싶은 경우

세 장의 이미지가 나열된 웹페이지에서 가운데 이미지만 필요하다고 가정해 보겠습니다.

```text
[ 이미지 A ]  [ 이미지 B ]  [ 이미지 C ]
                    │
                    └─ 선택 및 분리 ──▶ [ 이미지 B ]
                                          자유롭게 배치·확대
```

필요하지 않은 두 이미지는 계속 볼 이유가 없습니다. 그렇다고 가운데 이미지를 매번 다운로드하거나 스크린샷으로 저장하고 싶지도 않습니다.

**원본 이미지가 변경되면 분리된 이미지도 갱신되는 것.** 이것이 목표입니다.

### Case B. GitHub에서 README만 읽고 싶은 경우

GitHub 저장소에는 파일 목록, 탐색 메뉴, 버튼, README가 함께 존재합니다. 하지만 사용자가 지금 필요한 것은 README 하나일 수 있습니다.

```text
GitHub Repository
├─ Navigation
├─ Files / Folders
├─ Actions
└─ README.md ── 선택 및 분리 ──▶ [ Live README Panel ]
                                   원본 변경 시 다시 갱신
```

우리가 원하는 것은 README의 스크린샷이 아닙니다.

**원본 저장소의 README가 업데이트되면, 분리해 둔 README도 업데이트되는 연결된 문서**입니다.

## 4. Our Vision — From Pages to Live Fragments

> **From page-defined layouts to user-defined workspaces.**

기존 웹에서는 개발자가 페이지의 구조와 배치를 결정하고 사용자는 그 안에서 콘텐츠를 사용합니다.

LiveFragment는 콘텐츠의 출처와 기능은 존중하되, **어떤 요소를 어디에 놓고 볼지는 사용자가 결정**할 수 있는 인터페이스를 지향합니다.

| 원칙 | 의미 |
| --- | --- |
| **Select** | 원본 페이지에서 필요한 요소만 고릅니다. |
| **Detach** | 해당 요소를 독립 패널로 표시합니다. |
| **Preserve** | 출처·표현과 지원 가능한 동작을 유지합니다. |
| **Synchronize** | 원본 변경을 감지하거나 재조회해 콘텐츠를 갱신합니다. |
| **Arrange** | 여러 웹사이트의 요소를 원하는 위치에 배치합니다. |

### What is a Live Fragment?

**Live Fragment**는 원본 웹 요소의 출처(Source), 식별 정보(Identity), 표시 내용(Content), 갱신 방법(Sync Policy) 및 배치 상태(Layout State)를 갖는 독립적인 UI 단위입니다.

```ts
// 개념을 표현하기 위한 예시 타입이며, 확정된 API가 아닙니다.
interface LiveFragment {
  sourceUrl: string;
  identity: FragmentIdentity;
  content: FragmentContent;
  syncPolicy: SyncPolicy;
  layout: LayoutState;
}
```

**Detach the element. Keep the connection.**

## 5. How It Works — 기술적 접근

```text
원본 웹사이트 / 데이터 소스
         │
         ▼
  Element Selection
  원하는 요소 선택
         │
         ▼
  Fragment Extraction
  콘텐츠·출처·식별 정보 추출
         │
         ▼
  Live Sync Engine ◀──────── 원본 DOM 변화 / API 재조회
         │
         ▼
  Personal Workspace
  이동 · 크기 변경 · 저장 · 복원
         │
         ├──────── 2D Browser Workspace (우선 구현)
         │
         └──────── XR Spatial Workspace (장기 확장)
```

초기 기술 스택 후보는 **TypeScript · React · Chrome Extension (Manifest V3)**입니다.

요소 추출·식별·갱신 로직은 브라우저 확장 UI와 분리해 재사용 가능한 패키지로 개발하는 것을 목표로 합니다.

### What does “Live” mean?

원본 요소를 복사해 표시하는 것만으로는 충분하지 않습니다. 연결 가능한 범위에서 **원본의 최신 상태를 다시 반영할 수 있어야** 합니다.

| 상황 | 고려하는 방식 | 제약 |
| --- | --- | --- |
| 원본 탭이 열려 있음 | `MutationObserver` 등으로 DOM 변경 관찰 | DOM에 접근할 수 있어야 함 |
| 원본 탭이 닫혀 있음 | 공식 API 또는 허용된 원본 재조회 | 인증·접근 권한·갱신 주기에 의존 |
| DOM 구조가 변경됨 | 저장한 특징을 이용해 요소 재식별 | 잘못된 요소를 선택하거나 실패할 수 있음 |
| 원본에 접근할 수 없음 | 마지막 콘텐츠와 연결 상태 표시 | 최신 데이터 보장 불가 |

`MutationObserver`는 현재 열린 페이지의 DOM 변경을 관찰하는 기술이지, 원격 서버의 모든 변경을 자동으로 알려주는 기술은 아닙니다.

또한 원본 탭이 닫힌 상황의 갱신은 별도 접근 경로가 필요합니다.

동영상 PIP와 달리 임의의 React 버튼이나 복잡한 웹 앱은 DOM 복사만으로 이벤트와 상태가 유지되지 않습니다.

초기에는 **읽기 중심의 콘텐츠**를 지원하고, 상호작용 가능한 컴포넌트는 별도 단계에서 검증합니다.

## 6. First Experience — 초기 사용자 흐름

1. 사용자가 웹사이트에서 **LiveFragment 선택 모드**를 활성화합니다.
2. 원하는 이미지 또는 문서 영역을 클릭합니다.
3. 해당 영역이 독립 패널로 생성됩니다.
4. 패널을 이동하거나 크기를 변경합니다.
5. 원본에서 변경이 발생하면 지원되는 동기화 방식으로 패널을 갱신합니다.
6. 여러 사이트에서 가져온 패널을 하나의 작업 공간에 저장합니다.

**첫 PoC에서는 이미지 세 장이 있는 테스트 페이지에서 가운데 이미지 하나만 분리하고, 원본의 `src` 변경이 패널에 반영되는지 확인합니다.**

## 7. Roadmap

- [ ] **P0 · Element Selector** — DOM 요소 호버 강조 및 클릭 선택
- [ ] **P1 · Fragment Panel** — 이미지·텍스트의 독립 표시
- [ ] **P2 · Live DOM Sync** — 원본 탭에서 발생한 DOM 변경 반영
- [ ] **P3 · GitHub README Adapter** — README를 분리하고 공식 API로 재조회
- [ ] **P4 · Personal Workspace** — 다중 패널 이동·크기 변경·배치 저장
- [ ] **P5 · Persistent Identity** — DOM 구조 변경 후 대상 재식별
- [ ] **P6 · Interactive Fragments** — 지원 가능한 이벤트·상태 연결
- [ ] **P7 · Spatial Workspace** — XR 공간에 Fragment 배치 및 입력 지원

### 첫 번째 검증 기준

- [ ] 이미지 세 장 중 가운데 이미지 선택 가능
- [ ] 가운데 이미지만 독립 패널에 표시
- [ ] 원본 이미지 변경 시 패널 갱신
- [ ] 원본 페이지의 나머지 요소와 기능은 그대로 유지

## 8. Research Questions

LiveFragment는 우선 동작하는 오픈소스 도구를 목표로 합니다. 동시에 다음 문제를 연구할 수 있습니다.

> **DOM 구조와 콘텐츠가 변해도, 사용자가 선택한 웹 요소를 얼마나 안정적으로 다시 식별하고 갱신할 수 있을까?**

검증 후보: **요소 재식별 성공률, 오인식률, 콘텐츠 갱신 정확도, 동기화 지연, CPU·메모리 비용**.

관련 선행 작업:

- [MineXR](https://github.com/Augmented-Perception-Lab/MineXR) — 기존 앱의 일부 UI를 XR 위젯으로 활용하는 연구
- [Break the Window](https://arxiv.org/abs/2603.02471) — 웹페이지를 XR 공간의 여러 패널로 분해하는 연구
- [Webstrates](https://github.com/Webstrates/Webstrates) — DOM 변경의 지속성과 동기화에 관한 연구 플랫폼

연구적 신규성은 이 선행 작업들과의 구체적인 기능·알고리즘 비교 및 재현 실험 이후 판단할 수 있습니다.

## 9. Scope & Limitations

- **현재 구현된 기능은 없습니다.** 이 README는 프로젝트 비전과 기술 검증 계획입니다.
- 모든 웹사이트에서 임의의 요소를 완전하게 분리하거나 즉시 동기화할 수 있다고 가정하지 않습니다.
- 원본 애플리케이션의 이벤트·인증·상태·라우팅을 자동 복제한다고 주장하지 않습니다.
- 교차 출처 iframe, CORS, CSP, 브라우저 확장 권한 및 서비스 정책을 우회하는 구현을 목표로 하지 않습니다.
- 외부 HTML은 안전하게 렌더링하고, 사용자 동의 없는 정보 수집이나 인증 정보 노출을 방지해야 합니다.
- XR은 장기적인 출력 환경 중 하나입니다. 기본 엔진은 2D 환경에서도 유용해야 합니다.

## 10. Project Status & Contributing

**Current stage: Concept / Proof-of-Concept planning.**

첫 PoC와 지원 범위가 검증되면 설치 방법, 실행 데모, 패키지 API, 테스트 결과 및 기여 가이드를 추가할 예정입니다.

오픈소스 라이선스 역시 첫 공개 전에 확정합니다.

---

## Beyond the Page

YouTube의 PIP는 하나의 영상이 원래 앱의 레이아웃을 벗어나도 계속 작동할 수 있다는 경험을 보여줬습니다.

**그렇다면 웹의 다른 요소도 원하는 곳으로 가져와 사용할 수 있지 않을까요?**

모니터에서는 자유롭게 배치한 패널로, XR에서는 현실 공간에 놓인 객체로.

LiveFragment는 웹페이지를 없애려는 프로젝트가 아닙니다.

**웹페이지가 정의한 배치만이 웹을 사용하는 유일한 방법이라는 전제를 다시 생각하려는 프로젝트입니다.**

**Picture-in-Picture, beyond video.**
