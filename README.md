# Rethink Home Assistant Add-on

LG ThinQ 가전을 LG 클라우드 대신 로컬 Rethink 서버에 연결하고, MQTT Discovery를 통해 Home Assistant 기기로 등록하는 애드온입니다.

> 현재 애드온 패키지는 `dev` 브랜치에서 개발·검증 중입니다.

## Home Assistant 애드온 주요 기능

- Home Assistant 애드온으로 Rethink 서비스 실행 및 자동 시작
- Supervisor에 등록된 MQTT 서비스 정보 자동 검색
- MQTT 자동 검색 실패 또는 비활성화 시 서버·사용자 ID·비밀번호 수동 설정
- 인증서, 브리지 상태 및 런타임 설정을 `/data`에 영구 보관
- Home Assistant ingress를 통한 관리 화면 접근
- ThinQ 1 및 ThinQ 2 로컬 엔드포인트 제공

## 설치 및 설정

1. Home Assistant 애드온 스토어에 `https://github.com/plplaaa2/rethink` 저장소를 추가합니다.
2. **Rethink** 애드온을 설치합니다.
3. MQTT 자동 검색을 사용하거나 수동 MQTT 옵션을 입력합니다.
4. 공유기 또는 로컬 DNS에서 설정한 호스트 이름(기본값 `rethink.lan`)이 Home Assistant 호스트를 가리키도록 구성합니다.
5. 애드온을 시작하고 **웹 UI 열기**에서 연결 상태를 확인합니다.

MQTT 자동 검색이 활성화되어 있으면 Supervisor가 제공하는 MQTT 연결 정보를 우선 사용합니다. MQTT 서비스가 없거나 정보를 가져오지 못하면 수동으로 입력한 `mqtt_server`, `mqtt_username`, `mqtt_password` 값으로 전환합니다.

필수 포트와 상세 옵션은 [애드온 사용 설명서](rethink-addon/DOCS.md)를 참고하십시오. 가전 및 관리 포트를 인터넷에 직접 공개하지 마십시오.

## 원본 Rethink 프로젝트

The goal of this project is to de-cloud LG ThinQ-branded appliances, meaning to communicate with them without using the official LG app and cloud service.
The project is developed by reverse engineering various components of the ThinQ ecosystem.

## Status

A working version of `rethink-cloud` is now available. This is a service which emulates the cloud part of ThinQ and translates the protocol to
HomeAssistant-compatible MQTT.

An optional "bridge" mode is also supported, in which the messages are forwarded to the actual LG ThinQ cloud. This can be used as a reverse-engineering
aid, or simply to allow the user to still use the original LG app alongside HomeAssistant.

The following appliances are currently supported in rethink:

- Air Conditioners:
    - 👍 LG DualCool family (Standard 2, Deluxe with and without air purifier, etc.) wall-mounted Air Conditioner IDUs - high level of support. What's missing are mostly some features of higher-end models and more diagnostic coverage,
    - 👍 LW1822HRSM, Smart Window Air Conditioner - mostly working,
    - 👍 LP1022FVSM Portable Air Conditioner - mostly working,
- Fridges:
    - 🫤 LF28H8330S, Standard-Depth 4-Door French Door Refrigerator - preliminary support,
    - 🫤 GSJV70PZTE, LG Side by Side Refrigerator - preliminary support,
    - 🫤 GSB470BASZ, American Style Side by Side Refrigerator - preliminary support,
    - 🫤 GA-B509CMUM - preliminary support,
- Washing Machines:
    - 🫤 (model name unknown) Washing Machine - preliminary support
    - 👍 F2J7HG1W, Washing Machine - mostly working,
    - 🫤 F4WV508S2E, Front-Loading Washing Machine - preliminary support
    - 🫤 F4WV709P1E, Front-Loading Washing Machine - preliminary support
    - 🫤 TW4V9RW9W - preliminary support
    - 👍 F4X7511TWS (VCDWL2QEUK), Front-Load Washing Machine - mostly working
    - 🫤 WT7300CW - preliminary support
    - 👍 WM3900HBA (F3L2CYU\_\_), Front-Load Washing Machine - mostly working
- Dryers:
    - 🫤 DLE7300WE - preliminary support
    - 👍 DLEX3900B (RV13B6BSD_D_US_WIFI), Electric Dryer - mostly working
- WashTowers (combined washer+dryer):
    - 👍 WKEX200HBA (WTL_FXU_BDV_NA_01), WashTower - mostly working

The supported appliances can be used "out of the box" with HomeAssistant or another compatible MQTT consumer.  
Appliances not listed above can still be used with the bridge mode, but they will not be translated to MQTT. Contributions are welcome!

Most of the findings from the reverse engineering process are available on the [project wiki](https://github.com/anszom/rethink/wiki) as well.

## Installation

See the [instructions](https://github.com/anszom/rethink/wiki/Installing-rethink‐cloud).

## Management

A simple web interface is available on a user-defined port (default: 44401). The interface supports:

- listing the devices connected to rethink
- monitoring their communications (with packet injection)
- configuring the bridge mode

## Code

The following code is currently available:

- [rethink-setup](rethink-setup.ts) - a simple tool to perform the "initial setup" from a Wi-Fi connected PC, without using the official LG app
- [rethink-cloud](rethink-cloud.ts) - a server that replaces LG's cloud service. It's meant to be installed on your local network and hosts its own simplistic MQTT broker.

Miscelanneous utilities:

- [packet-parser](tools/packet-parser.ts) - an utility to interpret TLV-formatted packets received from the appliance via MQTT. It connects to rethink-cloud
- [packet-sender](tools/packet-sender.ts) - an utility to create TLV-formatted packets & send them via MQTT to the appliance. It connects to rethink-cloud
- [appliance simulator](tools/appliance-simulator) - a program which allows the Wi-Fi module to be operated without connection to an appliance. It simulates a minimum set of UART responses to activate the Wi-Fi module.
- [lgcloud-monitor](tools/lgcloud-monitor.ts) - connects to the official LG cloud just like the official app would and displays real-time notifications about your devices straight from the MQTT feed. Useful for understanding how the LG cloud processes device updates.
- [rethink-capture](tools/rethink-capture.ts) - records a device's live wire traffic (and optionally the time-aligned LG cloud notifications) to a JSONL capture file, with inline annotations, for offline reverse-engineering in an LLM-friendly format.
- [mcp-server](tools/mcp-server.ts) - an [MCP](https://modelcontextprotocol.io) server that exposes the reverse-engineering toolkit (decode/encode packets, enumerate devices, capture device & cloud traffic, inject and probe packets) to an LLM agent.

## Notice

LG ThinQ is likely a registered trademark, or whatever, I don't care. The name is used here for identification purposes only. I'm not in any way affiliated with LG.

## Warning

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

This means that if your device breaks, you get to fix it yourself or keep both pieces.
