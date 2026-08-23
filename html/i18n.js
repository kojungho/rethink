// Browser-language translations for the management UI.
// Related files: index.html, monitor.html, panel.js, monitor.js.
;(function () {
    const ko = {
        'Rethink management panel': 'Rethink 관리 패널',
        Connectivity: '연결 상태',
        Browser: '브라우저',
        'Connected devices': '연결된 기기',
        Model: '모델',
        Platform: '플랫폼',
        Bridge: '브리지',
        Monitor: '모니터',
        'Follow the': '새 기기를 연결하려면',
        'wiki instructions': '위키 안내',
        'to connect new devices.': '를 따르세요.',
        'Bridge mode': '브리지 모드',
        'Status:': '상태:',
        'Log into your LG account': 'LG 계정 로그인',
        logout: '로그아웃',
        'Log into your LG ThinQ account': 'LG ThinQ 계정 로그인',
        'Make sure to enter a country code that matches your account. The LG login page will open in a window. Please proceed with the login, then copy the URL from the final blank page.':
            '계정과 일치하는 국가 코드를 입력하세요. LG 로그인 페이지가 새 창에서 열립니다. 로그인을 완료한 뒤 마지막 빈 페이지의 URL을 복사하세요.',
        'Country code': '국가 코드',
        'Log in': '로그인',
        'Paste the final URL below.': '마지막 URL을 아래에 붙여 넣으세요.',
        Continue: '계속',
        Close: '닫기',
        'Logout confirmation': '로그아웃 확인',
        'Logging out will disable bridge mode for all your devices.':
            '로그아웃하면 모든 기기의 브리지 모드가 비활성화됩니다.',
        'Log out': '로그아웃',
        Cancel: '취소',
        'Select device type': '기기 유형 선택',
        'Please select the appropriate type for this device. This value usually consists of three digits and can be obtained during the setup process. The device will only register with the ThinQ cloud if the device type is set correctly.':
            '이 기기에 맞는 유형을 선택하세요. 일반적으로 설정 과정에서 확인할 수 있는 세 자리 숫자입니다. 기기 유형이 올바르게 설정되어야 ThinQ 클라우드에 등록됩니다.',
        'Device type': '기기 유형',
        'Device status': '기기 상태',
        'Device ID:': '기기 ID:',
        'Device model:': '기기 모델:',
        Messages: '메시지',
        'Auto-scroll': '자동 스크롤',
        Off: '끔',
        On: '켬',
        'Send to device': '기기로 보내기',
        Send: '보내기',
        'Inject from device': '기기에서 보낸 것으로 주입',
        'Mapping capture': '맵핑 캡처',
        Stopped: '중지됨',
        Start: '시작',
        Stop: '중지',
        'Annotation (for example: Auto Dry turned on)': '메모 (예: 자동건조 켬)',
        'Add note': '메모 추가',
    }

    const keyedKo = {
        'device.refrigerator': '냉장고',
        'device.washer': '세탁기',
        'device.dryer': '건조기',
        'device.dishwasher': '식기세척기',
        'device.washtower': '워시타워',
        'device.gas_range': '가스레인지',
        'device.microwave': '전자레인지',
        'device.air_conditioner': '에어컨',
        'devices.unsupported': 'Rethink가 지원하지 않는 기기이므로 Home Assistant에 등록되지 않습니다.',
        'common.off': '끔',
        'common.on': '켬',
        'status.unknown': '알 수 없음',
        'status.ok': '정상',
        'status.not_configured': '설정되지 않음',
        'status.waiting': 'Rethink 연결을 기다리는 중...',
        'status.online': '온라인',
        'status.offline': '오프라인',
        'error.http': 'HTTP 오류',
        'error.fetch': '통신 오류',
        'capture.stopped': '중지됨',
        'capture.recording': '기록 중',
        'capture.error': '오류',
    }

    const useKorean = (navigator.language || '').toLowerCase().startsWith('ko')

    function t(key, fallback) {
        if (useKorean && Object.prototype.hasOwnProperty.call(keyedKo, key)) return keyedKo[key]
        return fallback ?? key
    }

    function apply(root = document.body) {
        if (!useKorean) return
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
            const node = walker.currentNode
            if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue
            const normalized = node.nodeValue.trim().replace(/\s+/g, ' ')
            if (normalized.startsWith('Browser') && normalized.endsWith('Rethink')) {
                node.nodeValue = node.nodeValue.replace('Browser', '브라우저')
                continue
            }
            if (!Object.prototype.hasOwnProperty.call(ko, normalized)) continue
            node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), ko[normalized])
        }
        root.querySelectorAll('[data-tooltip]').forEach((element) => {
            if (element.dataset.tooltip === 'This will disable bridge mode for all your devices.')
                element.dataset.tooltip = '모든 기기의 브리지 모드가 비활성화됩니다.'
        })
        document.documentElement.lang = 'ko'
    }

    window.rethinkI18n = { apply, t }
})()
