# Changelog

## 0.1.1

### Added

- Home Assistant 애드온 저장소 및 애드온 패키지 구조를 추가했습니다.
- Supervisor MQTT 서비스 자동 검색을 추가했습니다.
- MQTT 서버 URL, 사용자 ID, 비밀번호 수동 설정 옵션을 추가했습니다.
- MQTT 자동 검색 실패 시 수동 설정으로 전환하는 폴백을 추가했습니다.
- Home Assistant ingress 관리 화면을 추가했습니다.
- 영어 및 한국어 애드온 설정 설명을 추가했습니다.
- 브라우저 언어를 감지하는 한국어 관리 UI 번역을 추가했습니다. 애드온 이름 `Rethink`은 번역하지 않습니다.
- 인증서, 브리지 상태 및 생성된 런타임 설정을 `/data`에 영구 보관하도록 구성했습니다.

### Changed

- 관리 화면의 홈 링크가 ingress 하위 경로에서도 동작하도록 수정했습니다.
- 루트 README를 Home Assistant 애드온 설치와 MQTT 설정 중심으로 개편했습니다.
- GHCR 패키지 공개 여부에 의존하지 않고 공개 GitHub `dev` 소스를 직접 빌드하도록 애드온 Dockerfile을 변경했습니다.

### Security

- MQTT 비밀번호를 로그에 출력하지 않습니다.
- 생성된 런타임 설정 파일 권한을 `0600`으로 제한합니다.
