# LiveFragment

**Detach the element. Keep it alive.**

> 웹페이지에서 필요한 요소만 분리하고, 원본과의 연결을 유지한 채 나만의 작업 공간에 배치하는 기술.

**Status: Concept / Pre-implementation**

**Focus:** Web Fragmentation · Live Synchronization · User-defined Layouts

LiveFragment는 웹페이지를 하나의 고정된 화면으로 소비하는 방식에서 벗어나, 사용자가 원하는 **웹 요소(Fragment)**를 선택하고 독립적인 인터페이스로 재구성할 수 있도록 하는 오픈소스 프로젝트를 지향합니다.

최초 구현은 일반 브라우저에서 시작합니다. 장기적으로는 동일한 요소를 XR 공간에서도 사용할 수 있는 환경 독립적인 구조를 목표로 합니다.

> **핵심 원칙: 레이아웃에서 분리하되, 원본과의 연결은 끊지 않는다.**

---

## 1. From CLI to GUI, and Beyond

컴퓨터 인터페이스는 새로운 하드웨어와 상호작용 방식의 등장에 따라 진화해 왔습니다.

- **CLI:** 키보드로 명령을 입력하고 텍스트 결과를 해석하는 방식이 중심이었습니다.
- **GUI:** 창, 아이콘, 메뉴, 포인터를 통해 화면의 객체를 직접 조작하는 방식이 보편화되었습니다.
- **Mobile:** 터치, 센서, 작은 화면에 대응하며 반응형 레이아웃과 모바일 중심 UX가 발전했습니다.
- **XR:** 3차원 공간, 손동작, 시선, 음성, 현실 환경 등의 정보를 인터페이스에 활용할 가능성이 열리고 있습니다.

이것은 이전 기술이 완전히 사라지는 일방적인 교체 과정이 아닙니다. CLI와 GUI는 지금도 함께 사용됩니다. 마찬가지로 XR에서도 2D UI는 여전히 유용할 수 있습니다.

그럼에도 한 가지 질문은 남습니다.

**상호작용할 수 있는 공간이 화면 밖으로 확장된다면, 왜 정보의 배치는 여전히 웹페이지의 고정된 구조에 종속되어야 할까요?**

## 2. The Problem — Pages Define Our Layouts

오늘날의 웹에서 콘텐츠는 대개 개발자가 정의한 페이지 구조 안에 놓입니다.

반응형 디자인은 화면 크기에 맞춰 그 구조를 조정하지만, **사용자가 필요한 요소만 선택해 페이지 밖에서 계속 사용하는 일**까지 일반적으로 해결하지는 않습니다.

### Case A. 이미지 세 장 중 한 장만 보고 싶다면

웹페이지에 이미지 세 장이 나란히 있습니다. 사용자는 가운데 이미지만 필요합니다.

현재는 이미지가 포함된 페이지를 계속 보거나, 별도 이미지 주소를 열거나, 저장해야 할 수 있습니다. 우리가 원하는 동작은 다릅니다.

**가운데 이미지 하나를 선택 → 페이지에서 시각적으로 분리 → 원하는 크기와 위치에 배치 → 원본 이미지가 변경되면 갱신.**

### Case B. GitHub 저장소에서 README만 보고 싶다면

GitHub 저장소에는 파일 목록, 탐색 메뉴, 여러 작업 버튼과 README가 함께 표시됩니다.

사용자가 README만 집중해서 보고 싶다면 어떨까요?

**README 영역 선택 → 독립 패널로 분리 → 다른 작업 공간에 배치 → README가 변경되면 업데이트.**

우리가 추구하는 것은 스크린샷을 잘라내는 기능이 아닙니다.

**원본과 연결된 콘텐츠를 독립적으로 사용하는 방식**입니다.

## 3. Our Vision — From Pages to Fragments

> **The web shouldn't be confined to predefined layouts.**

웹사이트는 콘텐츠와 기능을 제공하는 원천으로 남고, 최종적으로 무엇을 어디에 보여줄지는 사용자가 결정할 수 있어야 합니다.

LiveFragment가 지향하는 다섯 가지 동작은 다음과 같습니다.

1. **Select:** 웹페이지에서 필요한 요소를 선택합니다.
2. **Detach:** 원본 레이아웃과 분리된 독립 패널로 표시합니다.
3. **Preserve:** 콘텐츠의 출처, 가능한 범위의 표현 및 동작을 보존합니다.
4. **Synchronize:** 원본의 변경을 감지하거나 재조회해 갱신합니다.
5. **Arrange:** 여러 사이트의 요소를 하나의 작업 공간에 자유롭게 배치합니다.

### What is a Live Fragment?

**Live Fragment**는 단순한 DOM 복사본이 아니라, 원본을 다시 찾고 갱신할 수 있는 정보를 갖는 독립적인 웹 UI 단위입니다.

개념적으로 하나의 Fragment는 다음 정보를 갖습니다.

- **Source:** 원본 URL 또는 데이터 출처
- **Identity:** 원본에서 같은 요소를 다시 찾기 위한 식별 정보
- **Content:** 현재 표시할 콘텐츠와 안전한 표현 정보
- **Sync Policy:** 변경 감지·주기적 재조회·수동 새로고침 등의 갱신 방식
- **Workspace State:** 위치, 크기, 가시성 등 사용자별 배치 정보

**Detach the UI, not the connection.**

## 4. How It Works — Proposed Architecture

기본 아키텍처는 다음과 같습니다.

```text
Source Website
  HTML · DOM · API
          |
          | select / observe / refetch
          v
    Fragment Engine
    ├─ Element Selector
    ├─ Fragment Identity & Registry
    ├─ Extraction / Safe Rendering
    └─ Synchronization Adapters
          |
          | fragment + updates
          v
   Personal Workspace
   move · resize · save · view
          |
     Rendering Adapters
       /         \
  2D Browser    XR Spatial UI
    (first)       (future)
```

초기 구현은 **TypeScript, React, Chrome Extension (Manifest V3)**을 검토합니다.

DOM 선택·식별·동기화 로직은 UI에서 분리해, 이후 라이브러리로 재사용할 수 있도록 설계할 계획입니다.

### 'Live'는 어떻게 유지할까요?

| 상황 | 동기화 방식 | 조건 |
|---|---|---|
| 원본 탭이 열려 있음 | `MutationObserver` 등으로 DOM 변경 감지 | 접근 가능한 DOM 변경 |
| 원본 탭이 닫힘 | API 또는 허용된 재조회 | 원본 접근 경로와 권한 필요 |
| 원본 구조가 바뀜 | 식별 정보로 대상 재탐색 | 재식별 실패 가능 |
| 갱신 경로가 없음 | 마지막 콘텐츠와 갱신 불가 상태 표시 | 실시간 갱신 미보장 |

**모든 웹사이트의 실시간 동기화를 보장하는 것은 목표가 아닙니다.**

지원 가능한 연결을 유지하고, 불가능한 경우에는 연결 상태를 명확하게 표시하는 것을 우선합니다.

## 5. Design Principles

- **User-defined Layout:** 개발자가 정한 페이지 배치와 사용자의 작업 공간 배치를 분리합니다.
- **Source-connected:** 가능한 한 원본의 최신 콘텐츠를 반영합니다.
- **Progressive Enhancement:** 정적 이미지·텍스트에서 시작해 동적 UI로 확장합니다.
- **Device-agnostic Core:** 선택·식별·동기화 기능을 2D 또는 XR 렌더러와 분리합니다.
- **Explicit Permissions:** 원본 접근, 인증, 데이터 갱신에 필요한 권한을 존중합니다.
- **Graceful Degradation:** 갱신이나 기능 보존이 불가능하면 실패 상태를 감추지 않습니다.

## 6. Roadmap

계획 단계의 로드맵이며, 아래 기능은 아직 구현 완료를 의미하지 않습니다.

- [ ] **Phase 0 — Element Selection:** 테스트 페이지에서 DOM 요소를 선택하고 강조 표시
- [ ] **Phase 1 — Fragment Extraction:** 이미지·텍스트를 독립 패널로 안전하게 렌더링
- [ ] **Phase 2 — Live DOM Sync:** 원본 탭의 콘텐츠 변경을 감지하고 분리된 패널 갱신
- [ ] **Phase 3 — Source Sync:** GitHub README 등 지원 가능한 소스를 API로 재조회하여 탭 종료 후에도 업데이트
- [ ] **Phase 4 — Personal Workspace:** 여러 Fragment의 이동·크기 조절·배치 저장 및 복원
- [ ] **Phase 5 — Persistent Identity:** DOM 구조 변경 후에도 같은 요소를 재식별하는 방법 탐색
- [ ] **Phase 6 — Interactive Fragments:** 가능한 범위에서 버튼·입력·상태·이벤트 연동
- [ ] **Phase 7 — XR Workspace:** 동일한 Fragment를 공간 패널로 배치하고 XR 입력 지원

### First Milestone: Proof of Concept

처음 검증할 시나리오는 단순합니다.

1. 이미지 세 장이 있는 테스트 페이지를 엽니다.
2. 가운데 이미지를 선택해 별도 패널로 표시합니다.
3. 원본 페이지에서 해당 이미지의 `src`를 변경합니다.
4. 독립 패널의 이미지도 갱신되는지 확인합니다.

이 네 가지가 첫 번째 성공 기준입니다.

이후 GitHub README로 대상을 확장합니다.

## 7. Research Directions

LiveFragment는 사용 가능한 도구를 만드는 프로젝트이면서, 다음 연구 문제를 탐구할 수 있는 기반이 되고자 합니다.

**Research Question:**

> 원본 DOM의 구조가 변경되더라도, 사용자가 선택한 웹 요소를 안정적으로 재식별하고 동기화할 수 있는가?

검토할 평가 지표:

- 요소 재식별 정확도 및 성공률
- 콘텐츠 동기화 정확도와 지연 시간
- DOM 구조 변경에 대한 내구성
- CPU·메모리·렌더링 오버헤드
- 선택·배치 작업에 대한 사용자 경험

연구적 신규성은 기존 방법과의 정량 비교 및 선행 연구 검토를 통해 판단합니다.

### Related Work

- [MineXR (CHI 2024)](https://github.com/Augmented-Perception-Lab/MineXR) — 사용자가 앱 화면에서 위젯을 구성하고 XR 공간에 배치하는 연구.
- [Break the Window (CHI EA 2026)](https://arxiv.org/abs/2603.02471) — 동작 중인 웹페이지를 여러 XR 공간 패널로 분해하는 연구.
- [Webstrates](https://github.com/Webstrates/Webstrates) — DOM 변경의 지속성과 클라이언트 간 실시간 동기화를 다루는 연구 플랫폼.

이 프로젝트들은 중요한 선행 사례입니다.

LiveFragment의 차별점은 **일반 웹페이지에서 사용자가 선택한 요소의 출처·식별·지속적 갱신을 재사용 가능한 엔진으로 다루는 것**에 두고 검증할 계획입니다.

## 8. Scope & Limitations

초기 버전에서 **지원하지 않거나 보장할 수 없는 영역**도 명확히 합니다.

- 모든 웹사이트에서 임의 요소를 100% 정확히 추출하는 기능
- DOM을 복사하는 것만으로 React 이벤트나 애플리케이션 상태를 완전히 보존하는 기능
- 인증·CORS·CSP·iframe·서비스 약관 등 원본의 접근 제한을 우회하는 기능
- 원본 서버가 변경 통지를 제공하지 않는데도 즉시 업데이트를 보장하는 기능
- 외부 HTML과 스크립트를 신뢰 없이 실행하는 방식

콘텐츠 추출 시에는 안전한 렌더링, 권한 최소화, 개인정보 보호를 우선합니다. 원본 서비스의 접근 정책과 저작권도 고려합니다.

## 9. Project Status & Contributing

이 저장소는 현재 **아이디어 및 아키텍처 설계 단계**를 전제로 문서화되었습니다.

설치 가능한 패키지, 배포된 확장 프로그램, 검증된 데모는 아직 없습니다.

추후 PoC 공개 이후 기술적 피드백, 버그 리포트, 구현 제안을 받을 계획입니다.

우선순위는 **작동하는 최소 구현과 재현 가능한 테스트**입니다.

## 10. License

오픈소스 공개를 목표로 하며, 라이선스는 첫 코드 공개 전에 확정할 예정입니다.

---

### Beyond the Page

**From page-defined layouts to user-defined workspaces.**

우리가 바꾸고 싶은 것은 웹사이트의 존재가 아닙니다.

**웹사이트가 정의한 레이아웃만이 웹을 사용하는 유일한 방식이라는 전제**입니다.

모니터에서는 자유롭게 배치한 패널로, XR에서는 공간에 놓인 객체로.

사용자는 자신에게 필요한 웹의 일부를 가져와 자신만의 인터페이스를 만들 수 있어야 합니다.

**필요한 요소만 분리하고, 연결은 살아 있게.**
