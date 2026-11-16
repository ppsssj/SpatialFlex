SpatialFlex
Build spatial layouts. Detach what matters. Compose your workspace.
개발자는 공간형 UI와 제약 조건을 정의하고, 사용자는 필요한 웹 요소를 독립시켜 자신만의 작업 공간을 구성합니다.

Status: Concept / Pre-implementation
Type: Open-source, framework-oriented spatial layout & element detachment SDK
Focus: Adaptive Layout · Element Detachment · Live Components · User Composition · Layout Persistence

SpatialFlex는 기존 웹 애플리케이션에 공간형 레이아웃과 살아 있는 요소 분리 기능을 추가하기 위한 오픈소스 SDK를 지향합니다. 개발자는 기존 컴포넌트를 독립적으로 배치할 수 있는 단위로 선언하고, 사용자는 필요한 요소만 선택해 XR 공간으로 꺼내고 이동·확대·축소·숨김·복원할 수 있습니다.

SpatialFlex는 3D 그래픽 엔진이 아닙니다. 웹 요소의 배치(Layout), 독립화(Detachment), 상태 연결(Liveness), **사용자 재구성(Composition)**을 담당하며 실제 XR 렌더링은 별도 런타임/어댑터가 처리하도록 설계합니다.
기본 원칙: Detach the view, preserve the behavior.
보이는 위치는 분리하되, 데이터와 기능의 연결은 유지합니다.

1. From CLI to GUI — and Beyond the Screen
컴퓨팅 인터페이스는 입력 장치와 표현 환경이 바뀌면서 발전했습니다. CLI에서 GUI로 넘어오며 사용자는 명령을 입력하는 것뿐 아니라 화면의 객체를 직접 선택하고 조작할 수 있게 되었습니다. 모바일 환경은 터치와 반응형 레이아웃을 보편화했습니다.
환경	대표 입력	표현 공간	대표 레이아웃
CLI	키보드	문자 흐름	명령·출력 중심
GUI	키보드·마우스	2D 화면	창·패널·아이콘
Mobile	터치·센서	작은 2D 화면	반응형 UI
XR	손·시선·음성·컨트롤러	사용자 주변의 3D 공간	공간 패널·객체·앵커


이 구분은 이전 기술이 사라진다는 뜻이 아닙니다. 2D UI는 XR에서도 유용할 수 있습니다. 다만 새로운 질문이 생깁니다.

인터페이스가 화면의 경계를 벗어난다면, 레이아웃도 개발자가 고정한 페이지 안에만 머물러야 할까요?
2. The Problem — Fixed Pages in a Flexible Space
현재 웹에서 화면의 구조는 대체로 개발자가 정의합니다. Flexbox와 Grid는 주어진 뷰포트에 맞춰 요소를 정렬하지만, 사용자가 당장 필요한 요소만 꺼내 다른 공간에 배치하는 경험까지 일반화하지는 않습니다.

XR에서는 사용자가 README를 정면에, 차트를 오른쪽에, 동영상을 위쪽에 놓을 수 있습니다. 그동안 필요하지 않은 메뉴나 파일 목록은 숨기고 필요할 때 다시 불러올 수 있습니다.

핵심 문제는 단순히 2D UI를 3D에 그리는 것이 아니라, UI 요소가 기존 레이아웃으로부터 독립하면서도 동작을 유지하도록 만드는 것입니다.
3. A Familiar Example — Picture-in-Picture, Beyond Video
동영상 PIP는 원래 화면 밖에서도 콘텐츠가 계속 작동하는 경험을 보여줬습니다. SpatialFlex는 이 아이디어를 일반화해 봅니다.
기존:   [ 웹페이지: 메뉴 | 동영상 | 댓글 ]

PIP:    [ 동영상 ]  +  다른 작업

SpatialFlex가 지향하는 경험:
        [ 이미지 ] [ README ] [ 실시간 차트 ]
          ↑ 각각 필요한 요소만 독립적으로 배치
동영상을 단순히 작게 복사하는 것이 아니라 재생이 유지되는 것처럼, 분리된 웹 요소도 원본 애플리케이션의 데이터·상태·지원되는 상호작용과 연결되어야 합니다.
4. Example Scenarios — 실제로 어떤 경험을 만들까요?
아래 예시는 SpatialFlex SDK를 도입한 웹 애플리케이션을 전제로 합니다. 아직 구현 결과가 아닌 목표 시나리오입니다.
Scenario A. Image Gallery — 이미지 세 장 중 하나만 필요하다면
사용자는 사진 세 장이 나란히 있는 페이지에서 가운데 이미지만 보고 싶습니다.
웹페이지:    [ Image A ]  [ Image B ]  [ Image C ]
                              │
                 선택 → Detach → 공간으로 이동
                              ▼
사용자 공간:                 [ Image B ]
                            확대 / 이동 / 고정
- 사용자는 Image B만 선택해 독립 패널로 배치합니다.
- Image A, Image C와 원래 갤러리는 기존 웹 레이아웃에 남거나 사용자의 선택에 따라 숨겨집니다.
- 애플리케이션이 Image B의 소스를 업데이트하면 분리된 패널에도 새 이미지가 반영됩니다.
- 이 동작은 스크린샷을 만드는 것이 아니라 동일한 데이터에 연결된 뷰를 공간에 제공하는 것입니다.
Scenario B. Repository Workspace — README만 집중해서 읽고 싶다면
개발자가 SpatialFlex를 적용한 GitHub 유사 저장소 관리 앱이 있다고 가정합니다.
Repository Page
├── Navigation
├── File Explorer
├── Commit History
└── README ────────────────┐
                           ▼
XR Workspace         [ Live README ]
                  [ Commits ]
- 사용자는 파일 목록이나 탐색 메뉴 없이 README만 정면에 배치합니다.
- README는 원래 애플리케이션의 문서 데이터에 계속 연결됩니다.
- README를 갱신하면 독립 패널에도 변경 사항이 적용됩니다.
- 커밋 기록이 필요해지면 별도 요소로 추가할 수 있습니다.
범위 구분: 이것은 SDK를 도입한 앱에서 가능한 목표 경험입니다. SDK를 설치하지 않은 실제 GitHub 페이지에서 임의로 README를 추출하는 기능은 별도 연구 대상이며 본 프로젝트의 초기 범위가 아닙니다.

Scenario C. Monitoring Dashboard — 실시간 차트만 꺼내고 싶다면
서버 모니터링 웹 앱을 XR로 활용하는 상황입니다.
Dashboard
├── CPU Chart ────────▶ [ CPU 실시간 차트 ]
├── Memory Chart
├── Request Logs
└── Alert Controls ──▶ [ 알림 제어 ]
- 사용자는 CPU 차트와 알림 제어만 분리해 시야 근처에 배치합니다.
- CPU 데이터 스트림은 원본 앱의 상태 관리·구독 경로를 통해 계속 업데이트됩니다.
- 원래 차트의 범례·필터·선택 상태 등 지원되는 상호작용도 유지되도록 설계합니다.
- 이동·크기 변경이 불필요한 데이터 재요청이나 상태 초기화를 유발하지 않는지 검증합니다.
Scenario D. Personal Workspace — 사용자마다 다른 레이아웃
같은 애플리케이션을 사용해도 사용자별 목적은 다릅니다.
사용자	정면	주변	숨김
개발자	코드·README	커밋·로그	불필요한 탐색 패널
운영자	알림·모니터링 차트	이벤트 기록	설정 메뉴
학습자	강의 영상·문서	실습 체크리스트	부가 정보


개발자는 기본 위치와 최소 크기 등 안전한 배치 제약을 제공합니다. 사용자는 공간 내 위치와 중요도를 직접 변경하고, 레이아웃을 저장해 다음 세션에서 복원합니다.
5. Our Vision — Developers Provide, Users Compose
SpatialFlex가 제안하는 상호작용 모델은 네 역할로 구성됩니다.
1. Developer: 어떤 UI 요소를 독립화할 수 있는지와 허용 크기·입력·상태 연결 규칙을 선언합니다.
2. Layout Engine: 초기 위치, 거리, 충돌·시야·가독성 등 배치 제약을 계산합니다.
3. User: 요소를 선택·분리·이동·크기 조절·숨김·고정해 작업 공간을 구성합니다.
4. Runtime: 분리된 뷰가 원래 컴포넌트의 데이터와 기능에 연결되도록 유지하고 사용자 배치를 저장합니다.
Adaptive by default. Detachable by design. Composable by users.
6. Core Concepts
개념	역할
Spatial Item	개발자가 공간형 사용을 허용한 컴포넌트 단위
Detachment	원래 페이지 배치에서 독립적인 렌더링 영역으로 전환
Live Binding	원본 앱의 데이터·상태·이벤트와 연결 유지
Spatial Constraints	최소 크기, 거리, 충돌, 시야, 고정 조건
Adaptive Layout	제약과 사용자 선호를 반영하는 초기 배치·재배치
Workspace Persistence	사용자 배치, 가시성, 크기, 고정 상태 저장·복원
Renderer Adapter	2D 프리뷰 또는 지원 XR 런타임에서 표현


Detachment ≠ DOM 복제. 복제만으로 React 상태, 이벤트 핸들러, 미디어 재생 상태가 보존되지는 않습니다. SpatialFlex는 컴포넌트의 논리적 식별자, 공유 상태 소스, 렌더링 호스트를 분리하는 방식을 검토합니다. 요소 이동 과정에서 재마운트와 상태 초기화가 발생하는지 테스트해야 합니다.
7. Proposed Developer API
아래 코드는 실제 배포된 API가 아니라 설계 목표를 표현한 예시입니다.
import { SpatialWorkspace, SpatialItem } from "@spatialflex/react";

function Gallery() {
  return (
    <SpatialWorkspace layout="adaptive" persistenceKey="my-gallery">
      <SpatialItem id="image-a" detachable movable resizable>
        <GalleryImage id="a" />
      </SpatialItem>
      <SpatialItem id="image-b" detachable movable resizable>
        <GalleryImage id="b" />
      </SpatialItem>
      <SpatialItem id="image-c" detachable movable resizable>
        <GalleryImage id="c" />
      </SpatialItem>
    </SpatialWorkspace>
  );
}
예상 사용자 동작: Image B 선택 → Detach → 공간에 놓기 → 크기 조절 → 원본 이미지 데이터 변경 시 갱신 → 작업 공간 저장.

SDK는 개발자가 기존 컴포넌트를 가능한 한 재사용하도록 설계합니다. 다만 실제 XR에서 HTML을 공간 패널로 표현할 수 있는지는 렌더러와 기기 지원 범위에 따라 달라집니다.
8. Architecture — Layout & Detachment Core
Application Components / Data / State
                  │
                  ▼
          Spatial Item Registry
          (ID, constraints, bindings)
                  │
        ┌─────────┴───────────┐
        ▼                     ▼
  Detachment Manager     Layout Engine
  - select / detach      - adaptive placement
  - attach / restore     - spatial constraints
  - lifecycle            - user overrides
        │                     │
        └─────────┬───────────┘
                  ▼
        Workspace State Model
        - live bindings
        - placement / visibility
        - persistence
                  │
                  ▼
            Renderer Adapter
              /         \
        2D Playground   XR Runtime
핵심은 렌더링을 교체해도 Item, 배치 제약, 사용자 선호와 데이터 연결 개념을 재사용하는 것입니다. 초기에는 일반 브라우저에서 작동하는 2D/3D 시뮬레이터를 구현하고, XR 런타임 연동은 별도 어댑터로 연결합니다.
Planned packages
spatialflex/
├── packages/
│   ├── core/             # Item registry, layout model, lifecycle
│   ├── layout/           # Placement & constraint solver
│   ├── detach/           # Detach / attach / state binding contracts
│   ├── react/            # React integration
│   ├── renderer-web/     # Browser playground / fallback
│   └── adapter-xr/       # XR runtime integrations (later)
├── apps/playground/      # Reproducible scenarios
├── examples/             # Gallery, Repository, Dashboard
└── docs/
9. Scope — What SpatialFlex Is and Is Not
포함할 목표: SDK를 채택한 웹 앱의 공간 레이아웃, 사용자가 선택한 UI 컴포넌트의 독립화, 원본 앱과의 상태·데이터 연결, 재배치, 저장·복원.

초기 범위 제외: 아무 외부 웹사이트에서나 DOM 강제 추출, 브라우저 보안 정책 우회, 모든 HTML/React 컴포넌트의 무조건적 기능 보존, 직접 3D 그래픽 엔진 개발, 모든 XR 디바이스 지원 보장.

기존 HTML이 공간에 어떻게 렌더링되는지는 WebSpatial 또는 별도 XR 렌더러와의 통합으로 해결할 수 있습니다. SpatialFlex의 독립적 가치는 **'요소가 무엇이고, 분리 후 어떻게 동작하며, 공간에서 어디에 놓일지'**에 있습니다.
10. Roadmap
- [ ] P0 — Spatial Item Contract: 독립 가능한 요소의 ID, 제약, 상태 연결 인터페이스 정의
- [ ] P1 — 2D Detachment PoC: 이미지 3개 중 1개를 분리해 독립 패널로 이동·확대
- [ ] P2 — Live Component: 원본 데이터 변경이 독립 요소에 반영되고 상태 초기화가 없는지 검증
- [ ] P3 — Adaptive Layout: 자동 배치, 충돌·가독성 제약, 사용자 이동 우선순위 구현
- [ ] P4 — Workspace Persistence: 사용자별 레이아웃 저장·복원, 다시 붙이기(Attach) 지원
- [ ] P5 — Multi-Component Examples: README·실시간 차트·버튼 사례 및 기능 보존 테스트
- [ ] P6 — XR Adapter: 지원 XR 런타임에서 공간 패널과 입력 연동
- [ ] P7 — Open-Source Release: npm 배포, API 문서, 호환성 매트릭스, 성능 결과
First proof of concept
테스트 페이지에 세 이미지와 '이미지 B 변경' 버튼을 둡니다. 사용자가 Image B를 Detach하여 별도 패널로 이동한 뒤 원본 데이터의 이미지 주소를 변경하면, 분리한 이미지에도 같은 변경이 반영되어야 합니다. 이후 Attach를 누르면 다시 원래 레이아웃으로 돌아와야 합니다.

성공 기준: 선택한 요소만 독립 표시 / 변경 동기화 / 이동·크기 조절 / 재부착 / 나머지 페이지 정상 동작.
11. Research & Evaluation
후속 연구 질문은 다음과 같습니다.
기존 웹 컴포넌트를 독립적으로 배치하면서도 상태를 유지하고, 사용자 선호와 공간 제약을 만족하는 레이아웃을 효율적으로 계산할 수 있는가?

평가 대상	측정 지표
Detachment	재마운트·상태 초기화 발생률, 기능 보존율
Liveness	분리 전후 데이터 업데이트 정확도·지연
Layout	충돌률, 제약 만족률, 배치 계산 시간
User Composition	이동·숨김·복원 성공률, 수동 배치 유지율
Compatibility	2D 브라우저·XR 어댑터별 기능 지원 매트릭스


관련 기반 기술: WebSpatial SDK, React Three Fiber, @react-three/xr. 연구적 신규성은 이들과 관련 선행 연구를 비교한 뒤 판단해야 합니다.
12. Project Status
현재는 개념 및 PoC 설계 단계입니다. 작동하는 SDK, npm 배포본, XR 기기 지원을 아직 제공하지 않습니다. 예시 API는 검증과 함께 변경될 수 있습니다. 라이선스는 최초 공개 전에 확정합니다.
Beyond Fixed Pages
XR 시대의 웹은 기존 페이지를 공간에 그대로 옮기는 것만으로 충분하지 않을 수 있습니다.

SpatialFlex는 개발자가 제공한 웹 요소를 사용자가 필요한 만큼 독립시켜 자신에게 맞는 공간 레이아웃으로 재구성하는 방법을 탐구합니다.

Build spatial layouts. Detach what matters. Compose your workspace.
