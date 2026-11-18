# SpatialFlex

**Build spatial layouts. Detach what matters. Compose your workspace.**

> 개발자는 공간형 UI와 제약 조건을 정의하고, 사용자는 필요한 웹 요소를 독립시켜 자신만의 작업 공간을 구성합니다.

**Status:** P0 Detach + P1 Cross-Context XR Mirror — P1-06B Spatial Panel Manipulation (Experimental, desktop)

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

- [x] **P0 — Same-Host Detach:** Registry, 원본 React mount 보존, Detach/Move/Resize/Attach 및 Live 상태·액션 검증
- [x] **P1-00 / P1-02 — Same-Context XR Mirror:** Three.js/Babylon.js의 별도 3D 표현과 desktop/IWER 검증
- [x] **P1-03 — Cross-Context XR Mirror:** same-origin iframe의 versioned 상태·액션 브리지, 중복 방지와 재연결
- [x] **P1-04 — Declarative Spatial View (Experimental):** 컴포넌트 근처의 명시적 `SpatialItem xr` 선언과 실제 등록 수명주기
- [x] **P1-05 — Interactive Detachment Strategies (Experimental):** Move + Placeholder/Collapse, Mirror + Visible 비교와 명시적 거부
- [x] **P1-06 — Spatial Web Surface (Experimental, desktop):** 3D 월드에 고정된 실제 React 웹사이트 위에서 등록 컴포넌트를 선택·추출·복원
- [x] **P1-06A — Presentation Strategies (Experimental, desktop):** 원본 DOM 그대로의 Native DOM 추출과 XR Adaptive 표현을 SDK에서 선택
- [x] **P1-06B — Spatial Panel Manipulation (Experimental, desktop):** Native DOM·XR Adaptive 패널을 공통 엔진으로 마우스·키보드 이동·회전·크기 조절
- [ ] **Future — Generalized Detach to XR:** 런타임 capability에 따른 더 폭넓은 presentation 재사용; 자동 DOM 변환을 뜻하지 않음
- [ ] **Future — Adaptive Layout / Persistence:** 자동 배치, 충돌 방지, 레이아웃 저장·복원
- [ ] **Future — Open-Source Release:** API 안정화, 기기 호환성 검증, 문서 및 npm 배포

### Initial Proof of Concept (implemented)

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

**Current stage: P1-06B Spatial Panel Manipulation (Experimental, desktop)**

P0([#1](https://github.com/ppsssj/SpatialFlex/issues/1)–[#5](https://github.com/ppsssj/SpatialFlex/issues/5))에서 **같은 브라우저 페이지 안의 2D 개념 증명(PoC)** 을 구현하고 자동화 테스트로 검증했습니다. 이는 위에서 설명한 SpatialFlex 비전의 첫 단계이며, XR 환경에서의 동작이나 SDK 전체의 완성을 뜻하지 않습니다. 실행 방법과 세부 동작은 [13. Local Development](#13-local-development)에 있습니다.

### 구현되어 검증된 기능 (Same-Host P0)

- **SpatialItem 등록과 Registry:** 개발자가 `<SpatialItem>`으로 명시적으로 등록한 컴포넌트만 다루는 Workspace 범위 Registry. 중복 ID 거부, 언마운트 시 정리, 불변·직렬화 가능한 레코드, SSR/하이드레이션 지원.
- **Same-Host Detach / Move / Resize / Attach:** 등록된 컴포넌트를 같은 페이지에서 떠 있는 패널로 분리하고, 포인터로 이동·크기 조절한 뒤 원래 레이아웃으로 되돌립니다. 원래 자리는 placeholder가 유지하며, 기능(`detachable`·`movable`·`resizable`)과 뷰포트 경계를 강제합니다.
- **React 로컬 상태 보존:** 분리·이동·크기 조절·복귀 중에 컴포넌트를 재마운트하지 않으므로 내부 `useState`, Context, 이벤트 핸들러, 포커스가 유지됩니다. 동일 인스턴스와 mount 횟수로 검증합니다.
- **앱 소유 Live 상태와 양방향 액션:** 분리된 뷰는 원본 앱의 상태를 그대로 표시하고, 분리된 뷰의 버튼은 원본 앱의 같은 액션을 호출합니다. 클릭당 액션 1회, 중복 구독 없음을 계측으로 확인합니다. 도메인 상태와 로직의 소유자는 계속 원본 앱입니다.
- **브라우저 E2E:** Playwright로 production 빌드를 **Chromium과 Firefox**에서 테스트하며, CI에서도 두 엔진 모두 실행합니다.

### 구현된 P1 XR Mirror

- **두 XR 엔진:** Three.js와 Babylon.js의 renderer-neutral Host 계약, desktop 3D 및 기존 same-context IWER 검증.
- **P1-03 Cross-Context Mirror:** 별도 JavaScript realm의 same-origin iframe에 검증된 데이터와 semantic action ID만 전달하며, 앱이 상태와 액션을 소유합니다. [Live Bridge](docs/live-bridge.md).
- **P1-04 선언형 View (실험적):** `SpatialItem xr`로 컴포넌트 근처에서 representation과 허용 액션을 선언합니다. 실제 등록·해제와 최신 handler를 추적하며 앱별 XR adapter entry 없이 발견합니다. [API / DX 비교](docs/declarative-spatial-view.md).
- **P1-05 Interactive Detachment (실험적):** XR Lab에서 실제 Counter·Live Chart·Image를 선택하고 Move + Placeholder, Move + Collapse, Mirror + Visible을 비교합니다. Move는 원래 React/DOM 인스턴스를 유지하고, XR Mirror는 별도로 선언된 3D 표현입니다. 지원하지 않는 조합은 이유와 함께 거부합니다. [전략 API / 시연 / 검증](docs/detachment-strategies.md).
- **P1-06 Spatial Web Surface (실험적, 데스크톱):** 원래 React 대시보드(같은 mounted 인스턴스)를 3D 카메라에 맞춘 원근 CSS 변환으로 월드에 고정해 보여 줍니다. 네이티브 HTML 입력이 그대로 동작하며, 표면 위에서 등록된 컴포넌트만 선택해 별도의 live XR 패널로 추출하고(원본 유지 또는 공간 예약) 복원합니다. HTML 표면은 WebGL 지오메트리가 아니고 몰입형 WebXR 세션에는 표시되지 않습니다. Three.js·Babylon.js same-context만 지원하며 iframe Host는 이유와 함께 비활성화됩니다. [아키텍처 / 시연 / 검증](docs/spatial-web-surface.md).
- **P1-06A Presentation Strategies (실험적, 데스크톱):** `SpatialItem presentation="native" | "adaptive"`. **Native DOM**은 원래 React 컴포넌트의 실제 DOM 노드(같은 인스턴스·디자인·이벤트·로컬 상태)를 재부모화 없이 3D 공간의 독립 위치에 합성하며, 원본 자리는 예약하거나 collapse합니다. **XR Adaptive**는 기존 `SpatialItem xr` 기반 3D Semantic Mirror입니다. Native DOM은 데스크톱 CSS 3D 합성이며 몰입형 WebXR 세션에는 표시되지 않습니다. [아키텍처 / 증거](docs/native-dom-spatial-extraction.md).
- **P1-06B Spatial Panel Manipulation (실험적, 데스크톱):** 추출된 패널(Native DOM과 XR Adaptive 모두)을 렌더러 중립 `SpatialManipulator`(`@spatialflex/core`)로 이동(Move)·회전(Yaw)·균일 공간 스케일 조절합니다. Host는 핸들 입력을 월드 Ray로만 보고하고, Native DOM은 같은 노드·React 인스턴스를 유지한 채 CSS 레이아웃 크기 변경 없이 공간 pose만 바뀝니다. 핸들 드래그 중 카메라 조작은 중지되고, Escape·pointercancel·blur는 조작 전 pose로 되돌립니다. [아키텍처 / 검증](docs/spatial-panel-manipulation.md).

### 아직 구현되지 않은 것

- **실제 XR 렌더링 (물리 기기):** SDK의 분리는 같은 문서 안의 CSS 위치 변경이며 XR 렌더링과 같지 않습니다. P1 [XR Lab](docs/xr-lab.md)은 등록된 아이템의 **별도 3D 미러 뷰**를 WebXR 장면에 그리고 데스크톱 3D와 IWER 에뮬레이터에서만 검증했습니다. 물리 헤드셋에서는 검증하지 않았습니다.
- **범용 Cross-Origin / 외부 XR Host:** P1-03의 same-origin iframe 브리지는 구현되어 있습니다. Cross-origin 인증과 임의 외부 런타임 지원은 구현하지 않았습니다.
- **범용 DOM → XR 변환:** 임의의 웹 페이지나 등록되지 않은 DOM을 XR 콘텐츠로 바꾸는 기능은 없으며, 초기 범위도 아닙니다.
- **npm 배포:** 패키지는 `private`이며 배포되지 않았습니다. 공개 API는 바뀔 수 있습니다.
- **프로덕션 수준의 브라우저 호환성:** 데스크톱 Chromium·Firefox에서 마우스로만 검증했습니다. Safari/WebKit, 모바일, 터치·펜·키보드 조작, React 18은 검증하지 않았고, `transform` 등이 있는 조상 요소 아래에서는 동작하지 않는 것으로 알려져 있습니다([알려진 제한](#알려진-제한)).

### 앞으로 공개할 자료

- API Reference
- Supported Platforms
- Performance Benchmarks
- Contributing Guide

오픈소스 라이선스는 최초 코드 공개 전에 확정합니다.

## 13. Local Development

P0의 Registry, 원본 React mount를 보존하는 같은 페이지의 2D Detach/Attach·이동·크기 조절·Live 동작이 구현되어 있습니다. P1에서는 Three.js/Babylon.js의 별도 XR 미러, same-origin iframe Live Bridge와 실험적 선언형 `SpatialItem xr` 바인딩을 추가했습니다. [선언형 API와 DX 검증](docs/declarative-spatial-view.md), [브리지 계약](docs/live-bridge.md)을 참고하세요. 패키지는 npm에 배포하지 않았습니다.

### Quick Start

```bash
pnpm install
pnpm dev            # http://localhost:5173 에서 Playground 실행
```

### 3-Image Demo Walkthrough

Playground 상단의 **What to try** 안내와 같은 순서입니다.

1. Image A·B·C가 갤러리에 표시됩니다. Image B 안의 **Local count**를 몇 번 누릅니다(Image B 내부의 React 로컬 상태).
2. **Detach Image B**를 누릅니다. Image B가 떠 있는 패널이 되고, 원래 자리에는 점선 placeholder가 같은 크기로 남아 Image A·C가 움직이지 않습니다.
3. 패널 제목 바를 끌어 이동하고, 오른쪽 아래 모서리를 끌어 크기를 바꿉니다. Registry 표의 **Panel position**·**Panel size**가 함께 바뀝니다.
4. 원본 UI 또는 패널 안의 **Increment**를 누릅니다. 두 곳의 **Shared count**가 같이 바뀌고, **Domain diagnostics**의 `increment() calls`는 클릭당 1씩만 늘어납니다. **Image B data**에서 variant·caption을 바꾸면 분리된 Image B가 그대로 갱신됩니다.
5. 패널의 **Attach**(또는 **Attach Image B**)를 누릅니다. Image B가 원래 자리·크기로 돌아오고, **Local count**·**Instance**·**Mounts / unmounts**는 그대로입니다.
6. **Detach Image C**: Image C는 `detachable`만 허용하므로 이동·크기 조절 핸들이 없습니다.

알려진 CSS 제한은 `http://localhost:5173/#containing-block-fixture`에서 재현할 수 있습니다(아래 "알려진 제한" 참조).

### API 요약 (v0.1)

| 패키지 | API | 설명 |
| --- | --- | --- |
| `@spatialflex/core` | `new SpatialRegistry()` | Workspace 범위 Registry |
| | `register(definition)` → handle(`update`, `unregister`) | 등록, 기능 갱신, 해제 |
| | `get` · `has` · `list` · `subscribe` · `unregister(id)` | 조회·구독 |
| | `detach(id, { position?, size? })` · `attach(id)` | 표시 상태 전환 |
| | `move(id, position)` · `resize(id, size)` | 분리된 패널의 위치·크기 |
| | `SpatialFlexError`(`code`) | 계약 위반 오류 |
| `@spatialflex/react` | `<SpatialWorkspace registry?>` | Registry 제공 |
| | `<SpatialItem id detachable movable resizable label?>` | 등록과 attached/detached 표시 |
| | `useSpatialController()` → `detach` · `attach` · `move` · `resize` | DOM 측정·뷰포트 제한을 포함한 동작 |
| | `useSpatialItems()` · `useSpatialItem(id)` · `useSpatialRegistry()` | 조회(SSR 안전) |
| | `MIN_PANEL_SIZE` | 크기 조절 최소값(160 × 120) |

### SpatialItem Registry (v0.1)

```tsx
import { SpatialItem, SpatialWorkspace, useSpatialItems } from "@spatialflex/react";

<SpatialWorkspace>
  <SpatialItem id="image-a" detachable movable resizable>
    <ImageA />
  </SpatialItem>
</SpatialWorkspace>;
```

- **개발자 정의 등록:** `<SpatialItem>`으로 명시적으로 감싼 컴포넌트만 등록됩니다. DOM을 자동으로 탐색하지 않습니다.
- **Workspace 범위:** 각 `<SpatialWorkspace>`가 자신의 `SpatialRegistry`를 소유합니다. 전역 싱글턴은 없으며, 서로 다른 Workspace는 같은 ID를 사용해도 격리됩니다.
- **생명주기:** 마운트 시 등록, 언마운트 시 해제됩니다. React StrictMode의 이중 effect 실행에서도 등록이 남거나 중복 오류가 발생하지 않습니다.
- **중복 ID:** 같은 Workspace에서 중복 ID는 덮어쓰지 않고 `SpatialFlexError`(`DUPLICATE_ITEM_ID`)를 발생시키며, 가장 가까운 Error Boundary가 이를 받습니다.
- **렌더링:** 자식은 원래 위치에서 렌더링되며, `<SpatialItem>`은 두 개의 `div`(`data-spatialflex-item` 슬롯과 `data-spatialflex-panel` 패널)로 감쌉니다. Detach에 필요한 고정 구조로, 상태와 관계없이 항상 같은 요소를 렌더링합니다. (P0-02에서는 래퍼가 없었습니다.)
- **Registry가 다루는 것:** 아이템 ID, 기능 메타데이터(`detachable`·`movable`·`resizable`), 연결 상태(`attached`/`detached`), 직렬화 가능한 레이아웃(`position`·`size`·`visible`). 레코드는 불변이며 JSON으로 직렬화할 수 있습니다.
- **Registry가 다루지 않는 것:** 애플리케이션 도메인 상태, 비즈니스 로직, 액션. 이는 원본 앱이 계속 소유합니다. 레코드에는 DOM 요소, React 인스턴스, 콜백이 들어가지 않습니다.
- **조회:** `useSpatialItems()`, `useSpatialItem(id)`, `useSpatialRegistry()` 또는 core의 `registry.get/list/subscribe`.
- **서버 렌더링(SSR):** 지원합니다. 등록은 effect에서 일어나고 서버에서는 effect가 실행되지 않으므로, 서버 렌더링과 하이드레이션 중에는 `useSpatialItems()`가 항상 빈 목록, `useSpatialItem(id)`가 `undefined`를 반환합니다. 주입한 Registry에 이미 아이템이 있어도 마찬가지이며, 이 덕분에 서버 마크업과 클라이언트 하이드레이션 결과가 항상 일치합니다. 등록된 아이템은 하이드레이션 직후 재렌더링에서 나타납니다. 서버에서는 `<SpatialItem>`이 Registry에 등록하지 않고 항상 attached 상태로 렌더링하며, `window`·`document` 등 브라우저 API를 사용하지 않습니다.

### Detach / Attach (v0.1, 2D Same-Host)

```tsx
import { useSpatialController, useSpatialItem } from "@spatialflex/react";

function DetachButton() {
  const controller = useSpatialController();
  const detached = useSpatialItem("image-b")?.status === "detached";
  return (
    <button onClick={() => (detached ? controller.attach("image-b") : controller.detach("image-b"))}>
      {detached ? "Attach" : "Detach"}
    </button>
  );
}
```

- **Core:** `registry.detach(id, { position?, size? })`, `registry.attach(id)`, `registry.move(id, position)`, `registry.resize(id, size)`. `detachable`·`movable`·`resizable` 기능을 강제하고(`NOT_DETACHABLE`·`NOT_MOVABLE`·`NOT_RESIZABLE`), 모르는 ID(`UNKNOWN_ITEM_ID`), 분리되지 않은 아이템의 이동·크기 조절(`NOT_DETACHED`), 유한하지 않은 값이나 0 이하의 크기(`INVALID_LAYOUT`)를 거부합니다. 이미 분리/부착된 아이템에 같은 호출을 반복하면 `false`를 반환하고 구독자에게 알리지 않습니다. 레이아웃은 Attach 후에도 유지되어 다시 Detach하면 마지막 위치·크기로 열립니다. `detachable`을 끄면 분리된 아이템은 자동으로 Attach됩니다.
- **React:** `useSpatialController()`는 Workspace 범위의 `detach`·`attach`·`move`·`resize`를 제공합니다. `detach`는 원래 자리의 크기를 측정해 placeholder 크기로 쓰고, 처음에는 원래 위치 위에 자연 크기로, 이후에는 마지막 위치·크기로 패널을 엽니다. 분리된 패널에는 제목과 `Attach` 버튼이 있는 바가 표시되며, `movable` 아이템은 이 바를, `resizable` 아이템은 오른쪽 아래 핸들(`data-spatialflex-resize-handle`)을 포인터로 끌어 이동·크기 조절할 수 있습니다. 한 번에 하나의 포인터 동작만 진행되며(드래그 중에는 크기 조절이 시작되지 않고 그 반대도 마찬가지), 포인터 캡처를 사용하고 놓을 때 해제합니다. 놓는 이벤트를 놓친 경우(창 밖에서 놓기 등)에도 버튼이 눌리지 않은 다음 이동에서 동작을 끝냅니다. 동작 중에는 패널 안 콘텐츠의 네이티브 드래그 앤 드롭을 막습니다(Chromium에서 이미지가 누른 위치 아래로 지나가면 포인터가 취소되던 문제 방지).
- **기능 소유권:** Detach는 표현과 배치만 바꿉니다. 도메인 상태, 비즈니스 로직, API 호출, 액션은 계속 원본 앱이 소유합니다.

#### 렌더링 메커니즘: 같은 요소의 CSS 위치 변경

분리 시 React 트리나 DOM 위치를 바꾸지 않고, 패널 요소에 `position: fixed`만 적용합니다. 자식 컴포넌트는 한 번만 마운트된 채 그대로 유지됩니다. 선택 근거는 [`rendering-strategies.test.tsx`](packages/react/src/rendering-strategies.test.tsx)의 비교 실험입니다(카운터를 5로 올린 뒤 Detach → 클릭 → Attach).

| 방식 | 재마운트 | useState | Context·클릭 핸들러 | 포커스 | 비고 |
| --- | --- | --- | --- | --- | --- |
| Portal 대상 컨테이너 변경 | 발생 (mount 3 / unmount 2) | 초기화 (5 → 0) | 새 인스턴스 | 소실 | React 문서의 경고와 일치 |
| 다른 부모 요소로 조건부 렌더링 | 발생 (3 / 2) | 초기화 | 새 인스턴스 | 소실 | |
| 고정 Portal 호스트를 `appendChild`로 이동 | 없음 (1 / 0) | 유지 | 유지 | **소실** | 서버 렌더링 불가(`document`로 만든 호스트), DOM 이동 시 iframe 재로드(브라우저 동작, 테스트로 측정하지 않음) |
| **같은 요소의 CSS 위치 변경 (채택)** | 없음 (1 / 0) | 유지 | 유지 | 유지 | SSR 호환, DOM 이동 없음 |

**React 로컬 상태는 실제로 보존됩니다.** 부모 상태가 아닌 컴포넌트 내부 `useState` 값, 동일 DOM 노드, mount/unmount 횟수로 검증하며 StrictMode에서도 마찬가지입니다([`detach.test.tsx`](packages/react/src/detach.test.tsx)).

#### 좌표계와 Placeholder 정책

- **좌표:** CSS 픽셀, 뷰포트 왼쪽 위가 원점(`position: fixed`의 기준), x는 오른쪽, y는 아래쪽. `position`은 패널의 왼쪽 위 모서리, `size`는 패널의 border-box 크기입니다. 값은 정수로 반올림됩니다.
- **뷰포트 경계:** Detach·이동 시 패널이 뷰포트 안에 들어가도록 위치를 제한합니다. 패널이 뷰포트보다 크면 왼쪽 위에 맞춥니다. 크기 조절은 최소 `MIN_PANEL_SIZE`(160 × 120), 최대 패널 위치에서 뷰포트 오른쪽 아래까지입니다. 창 크기가 바뀌면 `movable` 아이템의 위치와 `resizable` 아이템의 크기를 다시 제한합니다.
- **아주 작은 뷰포트(160 × 120 CSS 픽셀 미만):** 최소 크기와 "뷰포트 안에 완전히 들어감"을 동시에 만족할 수 없으므로 **최소 크기가 우선**합니다. 크기 조절된 패널은 160 × 120 아래로 줄어들지 않고 왼쪽 위(0, 0)에 붙어 오른쪽·아래로 뷰포트를 벗어나며, 벗어난 부분은 보이지 않습니다(`position: fixed`라 스크롤로도 볼 수 없음). 크기를 조절하지 않은 자연 크기 패널도 뷰포트보다 크면 같은 방식으로 왼쪽 위에 맞춰집니다. 이런 뷰포트는 지원 대상이 아닙니다.
- **Placeholder:** 분리된 아이템의 원래 자리는 측정한 크기를 유지하므로 다른 아이템의 위치가 바뀌지 않습니다(reflow 없음). 슬롯과 패널에는 `data-status="attached|detached"`가 있어 앱이 스타일을 지정할 수 있습니다. SDK는 기능에 필요한 인라인 스타일(위치·크기)만 적용하며, `z-index`·배경·핸들 모양 등은 앱이 정합니다.

#### Resize와 레이아웃: Placeholder 크기 ≠ 패널 크기

두 크기는 소유자가 다르며 서로 덮어쓰지 않습니다.

| | 원래 자리(placeholder) 크기 | 분리된 패널 크기 |
| --- | --- | --- |
| 소유자 | React 호스트(`<SpatialItem>` 내부 상태) | Registry `layout.size` |
| 정해지는 시점 | 매 Detach 때 원래 자리를 측정 | Resize할 때. `null`이면 자연 크기(원래 너비, 높이 자동) |
| Attach 후 | 사용하지 않음(원래 레이아웃 그대로) | 유지 → 다음 Detach에서 복원 |

- 패널을 아무리 크게/작게 조절해도 원래 자리의 크기와 Image A·C의 위치는 바뀌지 않고, Attach하면 원래 페이지 레이아웃으로 돌아갑니다.
- 다시 Detach하면 원래 자리는 다시 측정하고(그 사이 페이지 레이아웃이 바뀌었을 수 있음), 패널은 마지막 위치·크기로 열립니다.
- 크기를 지정한 패널은 `overflow: hidden`입니다. 패널보다 큰 콘텐츠는 잘리므로, 분리될 콘텐츠는 패널 크기에 맞춰 반응형으로 만드는 것이 좋습니다(Playground는 이미지 너비를 패널에 맞춥니다). 자식을 감싸는 스크롤 요소를 분리할 때만 추가하면 자식이 재마운트되므로 이 방식을 택했습니다.
- **API 변경(P0-03 대비):** `layout.size`는 이제 원래 자리의 크기가 아니라 분리된 패널의 크기입니다.

#### 알려진 제한

- **해결되지 않은 제한:** 패널은 원래 DOM 위치에 남아 있으므로 조상 요소의 CSS 영향을 받습니다. `transform`·`filter`·`perspective`·`contain`·`will-change`가 있는 조상은 `position: fixed`의 기준이 되어 패널 위치가 어긋나고, `overflow: hidden`이나 쌓임 맥락(stacking context)에 의해 잘리거나 가려질 수 있습니다. `#containing-block-fixture` 페이지가 이를 재현하며, E2E 테스트가 "알려진 제한"으로 위치 어긋남과 잘림을 확인합니다. **지원 범위:** SpatialItem의 조상에 이런 속성이 없는 레이아웃만 지원합니다.
- 래퍼 `div` 때문에 `<tr>`·`<li>` 내부나 인라인 문맥처럼 `div`가 올 수 없는 위치에서는 사용할 수 없습니다.
- 이동·크기 조절은 포인터(마우스)로만 검증했습니다. 키보드 이동·크기 조절, 터치·펜 입력 검증, 여러 패널의 쌓임 순서 관리는 아직 없습니다. 크기 조절 핸들은 오른쪽 아래 하나뿐입니다.
- `registry.detach()`를 직접 호출하면 DOM을 측정하지 않으므로 placeholder 크기가 없어 reflow가 발생하고, `registry.move()`·`resize()`는 뷰포트 제한을 적용하지 않습니다. React에서는 `useSpatialController()`를 사용하세요.
- 같은 브라우저 페이지 안에서만 동작합니다. 별도 XR 호스트로의 이동은 [#7](https://github.com/ppsssj/SpatialFlex/issues/7) 범위입니다.

### XR Lab (P1-00, P1-02)

[`apps/xr-lab`](apps/xr-lab)은 SpatialFlex가 일반적인 WebXR 애플리케이션과 통합되는지 평가하는 **벤더 중립 테스트 환경**입니다. 같은 앱 상태·테스트로 SpatialFlex 없는 `baseline` 통합과 `spatialflex` 통합을 비교하며, 렌더러 중립 Host 계약을 통해 **서로 독립된 두 XR 엔진**(Three.js, Babylon.js)에서 같은 시나리오를 검증합니다. 3D 패널은 원본 컴포넌트를 옮긴 것이 아니라 같은 앱 상태에 연결된 별도 미러 뷰입니다. 실행 방법과 아키텍처는 [docs/xr-lab.md](docs/xr-lab.md), 엔진 간 호환성과 4가지 조합 비교 결과는 [docs/xr-host-compatibility.md](docs/xr-host-compatibility.md)에 있습니다.

```bash
pnpm dev:xr-lab     # http://localhost:5173/?engine=three|babylon&integration=baseline|spatialflex
```

**P1-05 interactive demo:** `http://localhost:5173/?integration=spatialflex&engine=three&bridge=iframe&xr-emulator=off`. Use **Interactive detachment** to select an existing widget, reserve or collapse its source space during Move, then attach it and show a live XR mirror. The header switches engines and execution contexts. See the [complete demonstration and supported matrix](docs/detachment-strategies.md).

### Same-Host Live 동작 (v0.1)

분리된 SpatialItem은 원본 React 앱과 **같은 페이지, 같은 React 트리** 안에 남아 있습니다. 따라서 앱의 Context, 상태 저장소, 이벤트 핸들러를 별도 장치 없이 그대로 사용하며, SDK에 Live Binding 전용 코드는 없습니다.

**두 가지 보장은 별도로 검증합니다.** 하나가 성립한다고 다른 하나가 증명되지는 않습니다. 실제로 Detach 시 컴포넌트를 강제로 재마운트하도록 바꿔도 도메인 상태 동기화 테스트는 통과하고, 인스턴스·구독 테스트만 실패합니다.

| | React 로컬 상태 | 공유 도메인 상태 |
| --- | --- | --- |
| 위치 | Image B 내부 컴포넌트의 `useState` | 원본 앱의 저장소(Context로 전달) |
| 보장 | Detach·이동·Attach 후에도 값과 컴포넌트 인스턴스가 유지됨(재마운트 없음) | 원본 UI와 분리된 뷰가 항상 같은 값을 표시하고, 어느 쪽에서든 같은 액션으로 변경됨 |
| 근거 | 동일 인스턴스 번호·mount 횟수·DOM 노드 | 액션 실행 횟수, 활성 구독 수, 두 뷰의 값 일치 |

- **소유권:** 도메인 상태, 비즈니스 액션, API 요청과 부수 효과는 원본 앱이 소유합니다. 분리된 뷰의 버튼도 원본 앱의 같은 액션 함수를 호출하고, 앱이 이를 처리합니다. SpatialFlex Registry에는 ID, 기능, 상태, 레이아웃만 저장되며 도메인 데이터는 들어가지 않습니다.
- **중복 없음:** 클릭 한 번은 액션 한 번입니다. Detach·Attach·이동은 재렌더링만 일으키고 재구독하지 않으므로, 20회 반복 후에도 활성 구독 수와 누적 구독 횟수가 변하지 않습니다. 언마운트하면 구독과 등록이 모두 해제됩니다. 개발 모드 StrictMode는 마운트 시 구독을 한 번 더 했다가 해제하므로, 검증은 누적 횟수가 아닌 활성 구독 수로 합니다.
- **Playground 시연:** 원본 UI와 Image B 안에 각각 `Shared count`와 `Increment` 버튼이 있고, 둘 다 앱 저장소의 `increment()`를 호출합니다. 원본 UI의 `Image B data` 컨트롤로 이미지 변형·캡션을 바꾸면 분리된 Image B가 같은 `<img>` 요소에서 갱신됩니다. `Domain diagnostics`에서 액션 호출 수와 활성 구독 수를, Image B의 `Local count`·`Instance`·`Mounts / unmounts`에서 로컬 상태와 인스턴스 유지를 확인할 수 있습니다. 진단용 저장소 계측은 Playground에만 있으며 SDK API가 아닙니다.
- **검증:** [`apps/playground/src/live.test.tsx`](apps/playground/src/live.test.tsx)가 실제 Playground `App`을 렌더링해 위 내용을 확인합니다.

**한계:** 이 보장은 CSS 위치 변경으로 같은 문서 안에서 분리하는 현재 방식에서만 성립합니다. 임의의 호스트(별도 창, iframe, XR 런타임)로 독립해도 기능이 유지된다는 뜻이 아닙니다. 별도 호스트 사이의 상태 스냅샷·액션 요청·승인/오류·연결 단절·재동기화를 다루는 Cross-Host Live Bridge는 구현되지 않았으며 [#7](https://github.com/ppsssj/SpatialFlex/issues/7)에서 다룹니다. 원본 앱이 종료되면 분리된 뷰의 기능도 유지되지 않습니다.

```text
packages/
├── core/        @spatialflex/core — 프레임워크·렌더러 독립 TypeScript 패키지
└── react/       @spatialflex/react — React 통합 (core를 workspace 의존성으로 사용)
apps/
└── playground/  Vite + React 개발/검증 앱 (Image A/B/C, Image B Detach/이동/크기 조절/Attach, 공유 도메인 상태·액션 진단, Registry 디버그 뷰; e2e/ 브라우저 테스트)
```

**요구 사항:** Node.js 22 이상, pnpm (`package.json`의 `packageManager` 버전; `corepack enable`로 활성화 가능)

```bash
pnpm install        # 의존성 설치
pnpm dev            # playground 개발 서버 (http://localhost:5173)
pnpm typecheck      # 모든 workspace 타입 검사
pnpm build          # packages/* → dist, playground → dist
pnpm test           # Vitest 단위·통합 테스트 (core, react, playground)
pnpm test:e2e       # Playwright 브라우저 E2E (Chromium, Firefox; playground와 XR Lab)
pnpm lint           # ESLint
pnpm format:check   # Prettier 검사 (pnpm format으로 자동 수정)
```

workspace 패키지는 `source` export 조건으로 TypeScript 소스를 직접 가리키므로, `pnpm dev`·`pnpm typecheck`·`pnpm test`는 패키지를 먼저 빌드하지 않아도 동작합니다. `pnpm build`는 의존 순서대로(core → react → playground) 실행됩니다.

**브라우저 E2E:** 처음 한 번 `pnpm --filter @spatialflex/playground exec playwright install chromium firefox`로 브라우저를 설치합니다. `pnpm test:e2e`는 Playground를 production 빌드한 뒤 `vite preview`(`127.0.0.1:4179`, `--strictPort`)로 띄워 테스트합니다. 기존 서버를 재사용하지 않으므로 포트가 사용 중이면 실패합니다. 실패 시 trace와 스크린샷이 `apps/playground/test-results/`에 남습니다.

CI(`.github/workflows/ci.yml`)는 PR과 `main` push에서 `check` job(install → lint → format check → typecheck → build → test)과 별도의 `e2e` job(Chromium·Firefox 설치 → `pnpm test:e2e`, 실패 시 리포트 업로드)을 실행합니다.

---

## Beyond Fixed Pages

XR 시대의 웹은 기존 페이지를 공간에 그대로 옮기는 것만으로 충분하지 않을 수 있습니다.

사용자는 개발자가 정해 놓은 페이지 구조를 그대로 따르는 것이 아니라, 자신에게 필요한 요소를 선택하고 원하는 위치에 배치해 자신만의 작업 공간을 구성할 수 있어야 합니다.

SpatialFlex는 **개발자가 제공한 웹 요소를 사용자가 필요한 만큼 독립시켜 자신에게 맞는 공간형 레이아웃으로 재구성하는 방법**을 탐구합니다.

**Build spatial layouts. Detach what matters. Compose your workspace.**

## Cross-context XR bridge

The opt-in P1-03 iframe mirror connects the original app to an independent
Three.js or Babylon.js Host via a validated state/action protocol. See
[Live Bridge](docs/live-bridge.md) for usage, security, reliability and limitations.
