# Rethink Home Assistant Add-on

LG ThinQ 가전을 로컬 Rethink 서버에 연결하고 MQTT Discovery를 통해 Home Assistant 기기로 등록합니다.

## 주요 기능

- Supervisor MQTT 서비스 자동 검색
- MQTT 서버, 사용자 ID, 비밀번호 수동 폴백
- Home Assistant ingress 관리 화면
- 인증서와 브리지 상태 영구 보관
- ThinQ 1 및 ThinQ 2 로컬 기기 지원
- 공식 LG 호스트명을 유지하는 라우터 DNAT 모드
- 기존 LG 계정 등록을 삭제하지 않는 안전한 ThinQ 2 bridge

가전의 고정 IP에서 나가는 TCP 443/8883만 Home Assistant 호스트의 같은 포트로 DNAT하고, 응답 경로에는 masquerade를 적용해야 합니다. LG 도메인을 Home Assistant IP로 DNS 재작성하지 마십시오.

설정 옵션과 필수 포트는 [전체 사용 설명서](DOCS.md)를 참고하십시오.
