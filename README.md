# SpatialFlex

**Build spatial layouts. Detach what matters. Compose your workspace.**

> 개발자는 공간형 UI와 제약 조건을 정의하고, 사용자는 필요한 웹 요소를 독립시켜 자신만의 작업 공간을 구성합니다.

**Status:** Concept / Pre-implementation  
**Type:** Open-source Spatial Layout & Element Detachment SDK  
**Focus:** Adaptive Layout · Element Detachment · Live Components · User Composition · Layout Persistence

SpatialFlex는 **기존 웹 애플리케이션에 공간형 레이아웃과 살아 있는 요소 분리 기능을 추가하기 위한 오픈소스 SDK**를 지향합니다.

개발자는 기존 컴포넌트를 독립적으로 배치할 수 있는 단위로 선언하고, 사용자는 필요한 요소만 선택해 XR 공간으로 꺼내고 이동·확대·축소·숨김·복원할 수 있습니다.

**SpatialFlex는 3D 그래픽 엔진이 아닙니다.**

웹 요소의 **배치(Layout)**, **독립화(Detachment)**, **상태 연결(Liveness)**, **사용자 재구성(Composition)**을 담당하며 실제 XR 렌더링은 별도 런타임 및 어댑터가 처리하도록 설계합니다.

> **Detach the view, preserve the behavior.**
>
> 보이는 위치는 분리하되, 데이터와 기능의 연결은 유지합니다.

### Design Principle — Render Independently. Function Continuously.

**렌더링과 배치는 원본 페이지로부터 독립할 수 있지만, 기능은 원본 애플리케이션에 Live로 연결되어야 합니다.**

- **Visual Independence:** 분리된 UI의 위치·크기·방향·표현 호스트는 사용자 작업 공간이 관리합니다.
- **Functional Dependence:** 애플리케이션 데이터, 공유 상태, 비즈니스 로직 및 도메인 액션의 **단일 진실 공급원(Single Source of Truth)** 은 원본 앱입니다.
- **Live Synchronization:** 원본 상태 변경은 분리된 뷰에 반영되고, 분리된 뷰의 사용자 액션은 원본 앱에 전달되어 처리됩니다.
- **No Fake Independence:** 독립 패널은 정적 스크린샷이나 기능을 따로 복제한 가짜 앱이 되어서는 안 됩니다.

이것은 **목표 아키텍처의 계약**입니다. 현재 P0에서는 동일한 React 실행 환경 안에서 검증하고, 별도 XR 런타임과의 연결은 후속 단계에서 검증합니다.

---

## 1. From CLI to GUI — and Beyond the Screen

컴퓨팅 인터페이스는 입력 장치와 표현 환경의 변화에 따라 발전해 왔습니다.

CLI에서 GUI로 전환되며 사용자는 명령어를 입력하는 것뿐 아니라, 화면의 객체를 직접 선택하고 조작할 수 있게 되었습니다.

이후 모바일 환경에서는 터치와 반응형 레이아웃이 보편화되었고, 이제 XR은 인터페이스를 물리적 화면 밖의 공간으로 확장하고 있습니다.

| 환경 | 대표 입력 | 표현 공간 | 대표 레이아웃 |
| --- | --- | --- | --- |
| CLI | 키보드 | 문자 흐름 | 명령·출력 중심 |
| GUI | 키보드·마우스 | 2D 화면 | 창·패널·아이콘 |
| Mobile | 터치·센서 | 작은 2D 화면 | 반응형 UI |
| XR | 손·시선·음성·컨트롤러 | 사용자 주변의 3D 공간 | 공간 패널·객체·앵커 |

이 구분은 이전 기술이 사라진다는 뜻이 아닙니다. 2D UI는 XR에서도 여전히 유용할 수 있습니다.

하지만 새로운 질문이 생깁니다.

**인터페이스가 화면의 경계를 벗어난다면, 레이아웃도 개발자가 고정한 페이지 안에만 머물러야 할까요?**

## 2. The Problem — Fixed Pages in a Flexible Space

현재 웹에서 화면의 구조는 대체로 개발자가 정의합니다.

Flexbox와 Grid는 주어진 뷰포트에 맞춰 요소를 정렬하지만, 사용자가 필요한 요소만 선택해 다른 공간에 배치하는 경험까지 일반화하지는 않습니다.

XR 환경에서는 상황이 달라집니다.

사용자는 README를 정면에, 실시간 차트를 오른쪽에, 동영상을 위쪽에 배치할 수 있습니다.

필요하지 않은 메뉴나 파일 목록은 숨겨두고, 필요할 때 다시 불러올 수도 있습니다.

단순히 기존 웹페이지 전체를 3차원 공간으로 옮기는 것은 XR이 제공하는 자유도를 충분히 활용하지 못하는 방식일 수 있습니다.

**핵심 문제는 2D UI를 3D에 그리는 것이 아니라, UI 요소가 기존 레이아웃으로부터 독립하면서도 기능을 유지하도록 만드는 것입니다.**

## 3. A Familiar Example — Picture-in-Picture, Beyond Video

우리는 이미 비슷한 사용자 경험을 알고 있습니다.

바로 YouTube와 같은 동영상 서비스의 **Picture-in-Picture(PIP)** 기능입니다.

PIP를 사용하면 동영상을 기존 애플리케이션의 화면에서 독립시켜 다른 작업을 하면서 계속 시청할 수 있습니다.

```text
기존 웹
┌────────────────────────────┐
│ Navigation                 │
├────────────────────────────┤
│                            │
│       Video Player         │
│                            │
├────────────────────────────┤
│ Comments / Recommendations │
└────────────────────────────┘

            ↓ PIP

┌────────────────────────────┐
│                            │
│       Other Workspace      │
│                            │
│              ┌───────────┐ │
│              │   Video   │ │
│              └───────────┘ │
└────────────────────────────┘
```

여기서 중요한 것은 동영상의 크기가 작아졌다는 점이 아닙니다.

**콘텐츠가 원래 애플리케이션의 레이아웃에서 독립했지만 재생은 유지된다는 점**입니다.

그렇다면 동영상뿐 아니라 다른 웹 요소에서도 비슷한 경험을 제공할 수 있지 않을까요?

```text
SpatialFlex가 지향하는 경험

┌───────────────┐
│  Live README  │
└───────────────┘

                     ┌───────────────┐
                     │  Live Chart   │
                     └───────────────┘

     ┌───────────────┐
     │     Image     │
     └───────────────┘
```

각 요소는 독립된 위치에 존재하지만 원본 애플리케이션의 데이터와 연결되어 계속 동작합니다.

이것이 SpatialFlex가 지향하는 기본 사용자 경험입니다.

## 4. Example Scenarios — 실제로 어떤 경험을 만들까요?

다음 사례들은 SpatialFlex SDK를 도입한 웹 애플리케이션을 전제로 합니다.

아직 구현된 기능이 아닌 **목표 사용자 경험**입니다.

### Scenario A. Image Gallery — 세 장 중 한 장만 보고 싶다면

사진 세 장이 나란히 있는 웹페이지를 생각해 보겠습니다.

```text
Original Web Layout

┌──────────────────────────────────────────┐
│                                          │
│ [ Image A ] [ Image B ] [ Image C ]      │
│                                          │
└──────────────────────────────────────────┘

                   │
              Select B
                   │
                Detach
                   ▼

XR Workspace

                  [ Image B ]

             Move / Resize / Pin
```

사용자는 가운데 이미지 하나만 보고 싶습니다.

SpatialFlex를 지원하는 환경에서는 다음과 같은 동작을 수행할 수 있습니다.

1. `Image B`를 선택합니다.
2. 선택한 요소를 기존 레이아웃에서 독립시킵니다.
3. XR 공간의 원하는 위치로 이동합니다.
4. 이미지의 크기와 방향을 조절합니다.
5. 원본 데이터가 변경되면 독립된 이미지에도 변경 사항이 적용됩니다.
6. 원한다면 이미지를 기존 레이아웃으로 다시 복귀시킵니다.

여기서 중요한 것은 스크린샷을 생성하는 것이 아닙니다.

**동일한 데이터에 연결된 이미지 뷰를 독립적인 공간 객체로 제공하는 것**입니다.

### Scenario B. Repository Workspace — README만 집중해서 읽고 싶다면

GitHub와 유사한 저장소 관리 웹 애플리케이션을 가정해 보겠습니다.

일반적인 웹사이트에서는 파일 목록, 탐색 메뉴, 커밋 기록, README 등이 하나의 레이아웃에 배치됩니다.

```text
Repository Page
├── Navigation
├── File Explorer
├── Commit History
├── Repository Actions
└── README
```

그런데 사용자가 README만 읽고 싶은 상황이라면 어떨까요?

```text
Original Application

Repository Page
├── Navigation
├── File Explorer
├── Commit History
└── README ──────────────┐
                         │ Detach
                         ▼
XR Workspace
                  ┌───────────────┐
                  │  Live README  │
                  │               │
                  │ Project Docs  │
                  └───────────────┘
```

사용자는 README 영역만 선택해 자신의 정면에 배치합니다.

이때 README는 원래 애플리케이션의 데이터와 계속 연결되어야 합니다.

- README 내용이 변경되면 독립 패널에도 반영됩니다.
- 원본 문서의 링크와 콘텐츠 표현을 가능한 범위에서 유지합니다.
- 필요해지면 커밋 기록을 별도 패널로 추가합니다.
- 사용자는 두 패널의 위치와 크기를 자유롭게 조절할 수 있습니다.

**범위 구분:** 이 예시는 SpatialFlex를 도입한 저장소 관리 웹 앱을 전제로 합니다. 라이브러리가 적용되지 않은 실제 GitHub 페이지에서 임의로 README를 추출하는 기능은 초기 개발 범위가 아닙니다.

### Scenario C. Monitoring Dashboard — 실시간 차트만 꺼내고 싶다면

서버 모니터링 대시보드를 XR 환경에서 사용하는 상황입니다.

```text
Original Dashboard
├── CPU Chart ───────────┐
├── Memory Chart         │
├── Request Logs         │
└── Alert Controls ──────┼──────┐
                         │      │
                         ▼      ▼

XR Workspace

       ┌─────────────────────┐
       │   CPU Live Chart    │
       │   ▁▃▂▅▃▇▆▃▅         │
       └─────────────────────┘

                  ┌─────────────────┐
                  │ Alert Controls  │
                  └─────────────────┘
```

사용자는 CPU 차트와 알림 제어 요소만 공간에 배치합니다.

여기서 차트는 단순한 정적 이미지가 아닙니다.

원본 애플리케이션의 데이터 스트림과 연결된 상태로 실시간 업데이트가 유지되어야 합니다.

또한 사용자가 차트를 이동하거나 확대하더라도 다음과 같은 문제가 발생해서는 안 됩니다.

- 데이터 구독이 불필요하게 중단되는 문제
- 컴포넌트 상태가 초기화되는 문제
- 필터나 선택 상태가 사라지는 문제
- 데이터 요청이 중복 발생하는 문제

이러한 문제를 해결하는 것이 SpatialFlex의 중요한 기술적 과제입니다.

### Scenario D. Personal Workspace — 사용자마다 다른 레이아웃

동일한 웹 애플리케이션을 사용하는 사람이라도 목적은 다를 수 있습니다.

| 사용자 | 주요 영역 | 보조 영역 | 숨기는 요소 |
| --- | --- | --- | --- |
| 개발자 | 코드·README | 커밋·로그 | 불필요한 탐색 메뉴 |
| 운영자 | 모니터링 차트 | 이벤트 기록 | 설정 메뉴 |
| 학습자 | 강의 영상·문서 | 실습 체크리스트 | 부가 정보 |

기존 웹에서는 개발자가 이러한 차이를 미리 예상해 여러 화면을 설계해야 합니다.

SpatialFlex에서는 개발자가 컴포넌트와 제약 조건을 제공하고, 사용자가 자신의 작업 목적에 맞는 레이아웃을 구성합니다.

또한 작업 환경을 저장해 다음 실행에서 복원할 수 있도록 합니다.

### Scenario E. Live Counter — XR에서 누른 버튼이 원본 앱을 바꾼다면

개발자가 카운터 컴포넌트를 SpatialItem으로 등록했다고 가정합니다.

```text
Original Application               Detached XR View
   Shared Count: 3   ─── state ───▶  Count: 3
          ▲                               │
          │         action: increment     │
          └───────────────────────────────┘
```

사용자가 XR 패널의 `+` 버튼을 누르면 원본 앱이 `increment` 액션을 처리하고 공유 카운트가 4로 변경됩니다. 변경된 값은 원본 UI와 XR 뷰에 동일하게 반영되어야 합니다. 반대로 원본 앱에서 값이 바뀌어도 독립 뷰가 갱신되어야 합니다.

여기서 **XR 뷰는 비즈니스 로직의 또 다른 소유자가 아닙니다.** 뷰는 상태를 읽고 앱의 명시적인 액션을 요청합니다. 별도 프로세스·런타임을 사용하는 경우에는 이를 위한 브리지와 연결 상태 관리가 필요합니다.

## 5. Our Vision — Developers Provide, Users Compose

SpatialFlex가 지향하는 모델에는 네 가지 역할이 있습니다.

**Developer**

개발자는 어떤 UI 요소를 분리할 수 있는지, 어떤 조건에서 배치할 수 있는지 정의합니다.

**Layout Engine**

레이아웃 엔진은 공간 크기, 시야, 요소 간 거리, 충돌 여부 등을 고려해 초기 레이아웃을 계산합니다.

**User**

사용자는 필요한 요소를 선택하고, 이동·확대·축소·숨김·고정하여 작업 공간을 구성합니다.

**Runtime**

런타임은 분리된 요소가 기존 데이터와 기능을 유지하도록 연결하고, 사용자 레이아웃을 저장·복원합니다.

> **Adaptive by default. Detachable by design. Composable by users.**

## 6. Core Concepts

| 개념 | 역할 |
| --- | --- |
| **Spatial Item** | 공간형 사용이 가능한 웹 컴포넌트 단위 |
| **Detachment** | 기존 레이아웃에서 독립적인 표시 영역으로 전환 |
| **Live Binding** | 원본 앱의 상태 구독 및 액션 호출; 기능의 소유권 유지 |
| **Spatial Constraints** | 크기·거리·충돌·시야·고정 조건 |
| **Adaptive Layout** | 공간 조건을 고려한 자동 배치 |
| **Workspace Persistence** | 사용자 레이아웃 저장·복원 |
| **Renderer Adapter** | 2D 또는 XR 환경에 맞는 UI 표현 |

### The Live Contract — Source of Truth vs Presentation

| 대상 | 소유자 | 분리 후 동작 |
| --- | --- | --- |
| 도메인 데이터·공유 상태 | 원본 웹 애플리케이션 | 분리된 뷰가 구독하고 변경을 반영 |
| API 요청·비즈니스 로직 | 원본 웹 애플리케이션 | 원본 로직을 재사용; 중복 실행 방지 |
| 버튼·폼 등 도메인 액션 | 원본 웹 애플리케이션 | 분리된 뷰의 요청을 원본으로 전달·검증 |
| 위치·크기·회전·고정 | SpatialFlex / 사용자 작업 공간 | 원본 페이지의 레이아웃과 독립적으로 변경 |
| 뷰 전용 임시 상태 | 렌더러 / 뷰 | 도메인 상태와 구분; 호스트 변경 시 보존 범위 별도 정의 |

**Live는 단순히 최신 콘텐츠를 다시 그리는 것이 아닙니다.** 원본 상태 구독, 도메인 액션 전달, 결과 반영을 포함합니다. 외부 렌더러에 전체 React 컴포넌트를 임의로 복사해 기능 보존을 보장하는 방식은 목표로 하지 않습니다.

#### Same-Host vs Cross-Host

- **Same-Host (P0):** 같은 브라우저·React 애플리케이션 안에서 분리된 패널을 표시합니다. 가능한 경우 기존 마운트를 유지하거나 상태 소유권을 상위 앱에 두어 일관성을 테스트합니다.
- **Cross-Host (future):** 별도 XR 렌더러나 실행 환경이 원본 앱의 상태 스냅샷/변경 이벤트를 받고, 사용자 액션을 원본 앱에 전달합니다. 메시지 계약, 인증·권한, 순서, 연결 단절, 재연결이 필요합니다.

**연결 단절은 Live가 아닙니다.** 원본 앱 또는 전송 경로가 중단되면 분리된 뷰는 끊김/오래된 데이터 상태를 명시하고 도메인 변경 액션을 제한해야 합니다. 원본 앱이 닫혀도 기능이 계속된다고 보장하지 않습니다.

### Detachment is not DOM cloning

기존 DOM 요소를 단순히 복제하는 것만으로는 React 상태나 이벤트 핸들러가 온전히 보존되지 않습니다.

따라서 SpatialFlex는 다음 문제를 다루어야 합니다.

- 컴포넌트의 논리적 식별자를 유지하는 방법
- 원본 데이터와 분리된 뷰를 연결하는 방법
- 컴포넌트를 다른 렌더링 호스트로 이동하는 방법
- 이동 과정에서 상태 초기화를 방지하는 방법
- 원본 레이아웃으로 다시 복귀시키는 방법

이러한 기능을 담당하는 계층을 **Detachment Manager**라고 정의합니다.

## 7. Proposed Developer API

아래 코드는 SpatialFlex가 목표로 하는 사용 방식을 표현한 개념적 API입니다.

현재 구현되거나 배포된 패키지는 아닙니다.

```tsx
import {
  SpatialWorkspace,
  SpatialItem,
} from "@spatialflex/react";

function Gallery() {
  return (
    <SpatialWorkspace
      layout="adaptive"
      persistenceKey="my-gallery"
    >
      <SpatialItem
        id="image-a"
        detachable
        movable
        resizable
      >
        <GalleryImage id="a" />
      </SpatialItem>

      <SpatialItem
        id="image-b"
        detachable
        movable
        resizable
      >
        <GalleryImage id="b" />
      </SpatialItem>

      <SpatialItem
        id="image-c"
        detachable
        movable
        resizable
      >
        <GalleryImage id="c" />
      </SpatialItem>
    </SpatialWorkspace>
  );
}
```

예상 사용자 동작은 다음과 같습니다.

```text
Image B 선택
      ↓
Detach
      ↓
XR 공간으로 이동
      ↓
크기 및 위치 조정
      ↓
원본 데이터 갱신
      ↓
독립 요소에 변경 사항 반영
      ↓
Workspace 저장 또는 Attach
```

목표는 개발자가 기존 컴포넌트를 가능한 한 재사용하도록 만드는 것입니다.

실제 XR 환경에서 HTML이 어떻게 렌더링되는지는 사용 가능한 렌더러와 기기의 지원 범위에 따라 달라집니다.

## 8. Architecture — Presentation Independence, Functional Dependence

```text
         Original Web Application
    ┌───────────────────────────────┐
    │ Domain State / Store          │
    │ Business Logic / API          │
    │ Authorized Actions            │
    └───────────────┬───────────────┘
                    │
       state updates│▲ action requests
                    ▼│
    ┌───────────────────────────────┐
    │ SpatialFlex Live Binding      │
    │  - stable item identity       │
    │  - subscribe / read snapshot  │
    │  - dispatch domain actions    │
    │  - lifecycle / connection     │
    └───────────────┬───────────────┘
                    │
    ┌───────────────▼───────────────┐
    │ SpatialFlex Workspace         │
    │  - Detachment Manager         │
    │  - Layout / Constraints        │
    │  - User Overrides / Persistence│
    └───────────────┬───────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
     2D Web Host         XR Renderer Host
     (P0 target)         (future adapter)
         └──────────┬──────────┘
                    │
        Independent presentation
        Shared application behavior
```

**Layout/Detachment와 Live Binding은 별도 책임으로 유지합니다.** SpatialFlex 코어는 레이아웃 의도, 아이템 ID, 사용자 선택을 관리합니다. 렌더러는 표현을 담당하고, 비즈니스 기능은 원본 애플리케이션의 액션과 상태에 연결됩니다.

P0에서는 동일한 React 실행 환경 내에서 검증합니다. 별도 XR 런타임으로 이전할 때에는 전송 계층(예: 허용된 메시징 인터페이스), 식별자·상태 버전, 명시적 도메인 액션, 권한 검증 및 재연결 정책을 설계해야 합니다. 단순히 DOM을 복제하거나 이벤트를 무조건 재전송해서 해결할 수 있는 문제가 아닙니다.

**브라우저 창 밖 표시 여부와 실제 이동 범위는 XR 런타임의 기능에 종속됩니다.** SpatialFlex는 모든 환경에서 독립 시스템 창이나 무제한 공간 배치를 보장하지 않습니다.

### Planned Packages

```text
spatialflex/
├── packages/
│   ├── core/
│   ├── layout/
│   ├── detach/
│   ├── react/
│   ├── renderer-web/
│   └── adapter-xr/
│
├── apps/
│   └── playground/
│
├── examples/
│   ├── gallery/
│   ├── repository/
│   └── dashboard/
│
└── docs/
```

## 9. Scope — What SpatialFlex Is and Is Not

### SpatialFlex가 해결하려는 문제

- XR 환경에 맞는 공간형 레이아웃 제공
- 사용자가 원하는 웹 요소의 독립화
- 분리한 컴포넌트의 원본 앱 데이터·액션·상태 연결
- 공간 제약을 고려한 배치
- 컴포넌트 이동·크기 조절·고정·숨김
- 사용자별 작업 공간 저장 및 복원
- 여러 렌더링 환경에 대응할 수 있는 구조

### 초기 개발 범위에 포함하지 않는 문제

- 모든 외부 웹사이트에서 DOM을 강제로 추출하는 기능
- 브라우저 보안 정책 우회
- 모든 React 컴포넌트의 완전한 상태 보존 보장
- 원본 앱이 종료되거나 연결이 끊긴 뒤에도 분리 UI의 모든 기능이 지속된다는 보장
- 별도 XR 호스트에서 임의의 DOM/React 내부 상태를 그대로 이전하는 범용 기능
- 자체적인 3D 그래픽 엔진 구현
- 모든 XR 기기에 대한 즉각적인 호환성 보장

SpatialFlex는 WebSpatial이나 React Three Fiber와 같은 렌더링 기술을 대체하지 않습니다.

**해당 기술들이 UI를 공간에 표현하는 방법을 제공한다면, SpatialFlex는 어떤 UI 요소를 독립시키고 어디에 배치하며 어떻게 유지할 것인지를 다룹니다.**

## 10. Roadmap

- [ ] **P0 — Spatial Item Contract:** 독립 가능한 요소의 ID, 제약, 상태 연결 인터페이스 정의
- [ ] **P1 — 2D Detachment PoC:** 이미지 세 장 중 하나를 분리해 독립 패널로 이동·확대
- [ ] **P2 — Live Component:** 원본 데이터 변경, 액션의 역방향 전달, 상태 소유권 및 중복 실행 검증
- [ ] **P3 — Adaptive Layout:** 자동 배치, 충돌 방지, 시야·가독성 제약 구현
- [ ] **P4 — Workspace Persistence:** 레이아웃 저장·복원 및 Attach 지원
- [ ] **P5 — Multi-Component Examples:** README·실시간 차트·버튼 사례 검증
- [ ] **P6 — XR Adapter & Live Bridge:** 렌더러 호스트 연결, 상태·액션 전송 계약 및 연결 단절 처리 검증
- [ ] **P7 — Open-Source Release:** npm 배포, 문서화, 성능 측정 및 호환성 테스트

### First Proof of Concept

첫 번째 PoC는 세 장의 이미지가 있는 테스트 페이지에서 시작합니다.

사용자가 가운데 이미지를 선택하고 독립 패널로 이동한 뒤, 원본 데이터가 변경되면 독립 이미지도 업데이트되는지 검증합니다.

**성공 기준**

- 선택한 이미지만 독립적으로 표시
- 독립 패널 이동 및 크기 조절
- 원본 이미지 변경 동기화
- 분리된 뷰에서 실행한 앱 액션이 원본 앱 상태를 변경하고, 그 결과가 반영됨
- 독립 요소의 재부착(Attach)
- 원본 페이지의 나머지 기능 유지

## 11. Research & Evaluation

SpatialFlex는 오픈소스 라이브러리 개발과 함께 다음 연구 문제를 탐구할 수 있습니다.

> **기존 웹 컴포넌트를 독립적으로 배치하면서도 상태를 유지하고, 사용자 선호와 공간 제약을 만족하는 레이아웃을 효율적으로 계산할 수 있는가?**

| 평가 대상 | 측정 지표 |
| --- | --- |
| Detachment | 재마운트·상태 초기화 발생률, 기능 보존율 |
| Liveness | 상태 갱신 정확도·지연, 액션 전달 성공률, 중복 실행·재연결 처리 |
| Layout | 충돌률, 제약 만족률, 배치 계산 시간 |
| User Composition | 이동·숨김·복원 성공률 |
| Compatibility | 브라우저 및 XR 어댑터별 지원 범위 |

### Related Technologies

- [WebSpatial SDK](https://github.com/webspatial/webspatial-sdk) — HTML/CSS/DOM 기반 공간형 웹 개발
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) — React 기반 3D 렌더링
- [React Three XR](https://github.com/pmndrs/xr) — React Three Fiber 기반 XR 통합

SpatialFlex는 기존 렌더링 생태계를 활용하면서 **Adaptive Layout, Element Detachment, Live Component, User Composition** 영역을 중심으로 차별화를 검증합니다.

## 12. Project Status

**Current stage: Concept / Proof-of-Concept Planning**

현재는 프로젝트의 개념과 아키텍처를 정의하는 단계입니다.

동작하는 SDK, 배포된 npm 패키지 및 XR 기기 지원은 아직 제공되지 않습니다.

현재 P0 작업은 [#1](https://github.com/ppsssj/SpatialFlex/issues/1)–[#5](https://github.com/ppsssj/SpatialFlex/issues/5)에서 추적합니다. 별도 XR 호스트 간 Live Bridge는 [#7](https://github.com/ppsssj/SpatialFlex/issues/7)에서 후속 검증 과제로 분리합니다.

향후 첫 번째 PoC와 핵심 기능 검증을 완료한 뒤 다음 자료를 공개할 예정입니다.

- Getting Started
- API Reference
- Interactive Demo
- Supported Platforms
- Performance Benchmarks
- Contributing Guide

오픈소스 라이선스는 최초 코드 공개 전에 확정합니다.

## 13. Local Development

P0-01([#1](https://github.com/ppsssj/SpatialFlex/issues/1))에서 모노레포 개발 기반만 구성했습니다. 아래 패키지는 **빌드·테스트 파이프라인 검증용 최소 export**만 제공하며, SpatialItem 계약과 Registry 등 실제 API는 [#2](https://github.com/ppsssj/SpatialFlex/issues/2) 이후에 구현합니다.

```text
packages/
├── core/        @spatialflex/core — 프레임워크·렌더러 독립 TypeScript 패키지
└── react/       @spatialflex/react — React 통합 (core를 workspace 의존성으로 사용)
apps/
└── playground/  Vite + React 개발/검증 앱 (core, react 사용)
```

**요구 사항:** Node.js 22 이상, pnpm (`package.json`의 `packageManager` 버전; `corepack enable`로 활성화 가능)

```bash
pnpm install        # 의존성 설치
pnpm dev            # playground 개발 서버 (http://localhost:5173)
pnpm typecheck      # 모든 workspace 타입 검사
pnpm build          # packages/* → dist, playground → dist
pnpm test           # Vitest 단위 테스트
pnpm lint           # ESLint
pnpm format:check   # Prettier 검사 (pnpm format으로 자동 수정)
```

workspace 패키지는 `source` export 조건으로 TypeScript 소스를 직접 가리키므로, `pnpm dev`·`pnpm typecheck`·`pnpm test`는 패키지를 먼저 빌드하지 않아도 동작합니다. `pnpm build`는 의존 순서대로(core → react → playground) 실행됩니다.

CI(`.github/workflows/ci.yml`)는 PR과 `main` push에서 install → lint → format check → typecheck → build → test를 실행합니다.

---

## Beyond Fixed Pages

XR 시대의 웹은 기존 페이지를 공간에 그대로 옮기는 것만으로 충분하지 않을 수 있습니다.

사용자는 개발자가 정해 놓은 페이지 구조를 그대로 따르는 것이 아니라, 자신에게 필요한 요소를 선택하고 원하는 위치에 배치해 자신만의 작업 공간을 구성할 수 있어야 합니다.

SpatialFlex는 **개발자가 제공한 웹 요소를 사용자가 필요한 만큼 독립시켜 자신에게 맞는 공간형 레이아웃으로 재구성하는 방법**을 탐구합니다.

**Build spatial layouts. Detach what matters. Compose your workspace.**
