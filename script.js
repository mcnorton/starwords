const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');

const DESIGN_W = 1000;
const DESIGN_H = 700;
const VIEW_PAD = 16;

canvas.width = canvas.parentElement.clientWidth;
canvas.height = canvas.parentElement.clientHeight;

// 초보자용 설명:
// localStorage 값이 손상되면 JSON.parse에서 예외가 발생해 게임 전체가 멈출 수 있습니다.
// 그래서 "안전 파싱" 헬퍼를 만들어 실패 시 기본값으로 복구합니다.
function readJsonFromLocalStorage(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;

    try {
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch (error) {
        console.warn(`[STAR WORDS] localStorage 파싱 실패: ${key}`, error);
        localStorage.removeItem(key);
        return fallback;
    }
}

// UI Elements
const uiChallenge = document.getElementById('challenge-level');
const uiEnergyShield = document.getElementById('energy-shield-gauge');
const uiEnergyShieldValue = document.getElementById('energy-shield-value');
const uiBeamGauge = document.getElementById('beam-gauge');
const uiBeamValue = document.getElementById('beam-value');
const uiTriggeringSkill = document.getElementById('triggering-skill');
const uiMissionPoints = document.getElementById('mission-points');
const msg1 = document.getElementById('console-msg-1');
const msg2 = document.getElementById('console-msg-2');
const msg2Text = document.getElementById('console-msg-2-text');
const beamCodeLabel = document.getElementById('beam-code-label');
const beamCodeText = document.getElementById('beam-code-text');
const typeInput = document.getElementById('type-input');

// Modals
const startOverlay = document.getElementById('start-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const modalChallengeClear = document.getElementById('modal-challenge-clear');
const modalGameOver = document.getElementById('modal-game-over');
const modalSettings = document.getElementById('modal-settings');
const centerBanner = document.getElementById('center-banner');

// Data
// wordsList: 현재 챌린지에서 출제되는 낱말 풀 (학년/언어 + 챌린지 진행도에 따라 갱신)
// beamCodes: POWER BEAM 발사 코드(속담/관용구) 목록
let wordsList = [];
let beamCodes = [];

// Game State
let gameState = 'START'; // START, PREP, COUNTDOWN, PLAYING, BEAM_INPUT, CHALLENGE_CLEAR, GAME_OVER
let battlePrepActive = false; // "Ready for Battle" 창이 게임 시작 전 단계로 열려있는지 여부
let bannerTimeout = null;
let countdownTimeouts = [];
let currentChallenge = 1;
let maxChallenge = 15;
let energyShield = 100;
let beamCharge = 0;
let totalTypedChars = 0;
let failedChars = 0;
let startTime = 0;
let lastTime = 0;
let isPaused = false;
let pauseStartTime = 0;
let enemiesDestroyed = 0;
let challengeEnemiesDestroyed = 0;
let beamFires = 0;
let challengeBeamFires = 0;
let targetEnemy = null;
let missionPoints = 0;
let beamTargetCode = "";
let totalTypingTime = 0;
let currentTypingStartTime = null;

// Settings
let settings = {
    name: "Player",
    lang: "ko",
    grade: 1 // 한글 학년(1~6). 영어(en)에서는 사용하지 않습니다.
};

// 학년 값(1~6)만 허용하고 그 외에는 기본값 1로 보정합니다.
function normalizeGrade(value) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 && n <= 6 ? n : 1;
}

// Load settings
const savedSettings = readJsonFromLocalStorage('starwords_settings', null);
if (savedSettings && typeof savedSettings === 'object') {
    settings.name = typeof savedSettings.name === 'string' && savedSettings.name.trim()
        ? savedSettings.name.trim()
        : "Player";
    settings.lang = savedSettings.lang === 'en' ? 'en' : 'ko';
    settings.grade = normalizeGrade(savedSettings.grade);
}
document.getElementById('setting-name').value = settings.name;
document.getElementById('setting-lang').value = settings.lang;
document.getElementById('setting-grade').value = String(settings.grade);
updateGradeVisibility();
refreshWordPool();

// 현재 언어/학년에 해당하는 레벨 배열과 beamCodes를 반환합니다.
function getActiveWordData() {
    if (settings.lang === 'ko') {
        const grade = WORD_DATA_KO.grades[settings.grade] || WORD_DATA_KO.grades[1];
        return { levels: grade.levels, beamCodes: grade.beamCodes };
    }
    return { levels: WORD_DATA_EN.levels, beamCodes: WORD_DATA_EN.beamCodes };
}

// 챌린지 진행도에 맞춰 출제 낱말 풀을 갱신합니다.
// CHALLENGE N 은 Level 1~N 을 누적해서 사용하며, 11~15 는 전체 Level(1~10)을 사용합니다.
function refreshWordPool() {
    const data = getActiveWordData();
    beamCodes = data.beamCodes;

    const levelCount = Math.min(Math.max(currentChallenge, 1), data.levels.length);
    const pool = [];
    for (let i = 0; i < levelCount; i++) {
        pool.push(...data.levels[i]);
    }
    wordsList = [...new Set(pool)];
}

// 언어 선택 값에 따라 Grade 선택 UI 표시 여부를 토글합니다. (한글일 때만 노출)
// 저장 전 임시 선택 상태를 반영하기 위해 settings 대신 select 값을 직접 읽습니다.
function updateGradeVisibility() {
    const field = document.getElementById('grade-field');
    if (!field) return;
    const langSelect = document.getElementById('setting-lang');
    const lang = langSelect ? langSelect.value : settings.lang;
    field.classList.toggle('hidden', lang !== 'ko');
}

function showBeamCode(code) {
    msg2Text.classList.add('hidden');
    beamCodeLabel.classList.remove('hidden');
    beamCodeText.classList.remove('hidden');
    beamCodeText.textContent = code;
    msg2.classList.add('beam-code-active');
}

function showConsoleMsg2(text) {
    beamCodeLabel.classList.add('hidden');
    beamCodeText.classList.add('hidden');
    msg2Text.classList.remove('hidden');
    msg2Text.textContent = text;
    msg2.classList.remove('beam-code-active');
}

let hitMessageTimeout = null;

function clearHitMessageTimeout() {
    if (hitMessageTimeout !== null) {
        clearTimeout(hitMessageTimeout);
        hitMessageTimeout = null;
    }
}

function showHitMessage(word) {
    clearHitMessageTimeout();
    msg1.classList.remove('attack-missed');
    const hitText = `${word}에 명중하였습니다.`;
    msg1.textContent = hitText;
    hitMessageTimeout = setTimeout(() => {
        hitMessageTimeout = null;
        if (!missileWarningActive && msg1.textContent === hitText) {
            msg1.textContent = '명령을 기다립니다.';
        }
    }, 3000);
}

// 무적(미진입) 적에게 공격이 튕겨 나갔을 때의 오렌지색 통신 메시지
function showAttackMissedMessage() {
    clearHitMessageTimeout();
    const missText = "공격이 빗나갔습니다.";
    msg1.textContent = missText;
    msg1.classList.add('attack-missed');
    hitMessageTimeout = setTimeout(() => {
        hitMessageTimeout = null;
        msg1.classList.remove('attack-missed');
        if (!missileWarningActive && msg1.textContent === missText) {
            msg1.textContent = '명령을 기다립니다.';
        }
    }, 3000);
}

const MISSILE_WARNING_DISTANCE = 220;
const MISSILE_WARNING_TEXT = '[경고] 미사일이 본 함선에 충격합니다. 화살표키를 이용해 회피하십시오.';
let missileWarningActive = false;
let msg1BeforeWarning = '';

function clearMissileWarning(restoreMessage = true) {
    missileWarningActive = false;
    msg1.classList.remove('missile-warning-active');
    msg1.classList.remove('attack-missed');
    if (restoreMessage && msg1BeforeWarning) {
        msg1.textContent = msg1BeforeWarning;
    }
}

function updateMissileProximityWarning() {
    const px = player.x + player.width / 2;
    const py = player.y;
    let isClose = false;

    for (let i = 0; i < missiles.length; i++) {
        const m = missiles[i];
        if (m.delay > 0) continue;

        const dx = px - m.x;
        const dy = py - m.y;
        if (Math.sqrt(dx * dx + dy * dy) < MISSILE_WARNING_DISTANCE) {
            isClose = true;
            break;
        }
    }

    if (isClose) {
        if (!missileWarningActive) {
            msg1BeforeWarning = msg1.textContent;
            missileWarningActive = true;
        }
        msg1.textContent = MISSILE_WARNING_TEXT;
        msg1.classList.add('missile-warning-active');
    } else if (missileWarningActive) {
        clearMissileWarning();
    }
}

// Entities
const player = {
    x: 50,
    y: canvas.height / 2,
    width: 40,
    height: 30,
    speed: 300, // pixels per sec
    dy: 0,
    invincibleTimer: 0
};

let enemies = [];
let missiles = [];
let lasers = [];
let fireQueue = [];
let fireQueueDelay = 0;
let asteroids = [];
let asteroidsSpawnedThisChallenge = false;
const CANNON_FIRE_INTERVAL = 0.4;
const END_SCREEN_DELAY = 2;

// ── 난이도 밸런스 상수 ──
// 적 함선 이동 속도 (원래 30~50 px/s 에서 두 차례 30% 감속)
const ENEMY_SPEED_MIN = 14.7;
const ENEMY_SPEED_RANGE = 9.8;
// 적 미사일 이동 속도 (원래 150 px/s 에서 두 차례 30% 감속)
const MISSILE_SPEED = 73.5;
// 스타디스트로이어 레이저 탄의 뻗어나가는 속도 (원래 600 px/s 에서 두 차례 30% 감속)
const MISSILE_LINE_GROW_SPEED = 294;
// 레이저 함선이 조준(warning)하는 시간 (원래 1.5초에서 두 차례 30% 증가 후 2배)
const LASER_WARNING_DURATION = 5.07;
// 적 함선 위에 표시되는 낱말의 글자 크기 (기본 14px 에서 20% 확대)
const ENEMY_WORD_FONT_SIZE = 16.8;

function randomEnemySpeed() {
    return Math.random() * ENEMY_SPEED_RANGE + ENEMY_SPEED_MIN;
}

// 함선 종류별 이동 속도 배율
//  1: H윙(경전투기, 초록) 3배 / 2: Y윙(노랑) 2배 / 3: 기본 / 'line': 레이저 전함 30% 감속
const ENEMY_SPEED_MULTIPLIER = { 1: 3, 2: 2, 3: 1, line: 0.7 };

function enemySpeedFor(type, laneSpeed) {
    const multiplier = ENEMY_SPEED_MULTIPLIER[type] || 1;
    return laneSpeed * multiplier;
}

// 운석 비행 속도 5단계 (레이저 함선보다 느린 끝 ~ H윙보다 빠른 끝)
const ASTEROID_SPEED_TIERS = [10, 28, 46, 64, 82];
const ASTEROID_COLUMN_SPACING = 55;

// 챌린지(레벨)별 등장 적 함선 수: 10, 12, 14, 16 ...
function enemyCountForChallenge(challenge) {
    return 10 + (Math.max(1, challenge) - 1) * 2;
}

// ── 적 함선 출현 슬롯 ──
// 적 함선이 서로 겹쳐 보이지 않도록 화면을 가로 "레인"으로 나누고,
// 각 레인의 화면 밖 오른쪽에 일정 간격의 출현 지점(슬롯)을 미리 만들어 둡니다.
// 새 함선은 비어 있는 슬롯 중 하나에서 무작위로 출현합니다.
const LANE_EDGE_MARGIN = 30;         // 화면 위/아래 여백
const LANE_MIN_HEIGHT = 76;          // 레인 최소 높이 (함선 + 낱말 글자 + 여유)
const LANE_MAX_COUNT = 8;
const ENEMY_VERTICAL_FOOTPRINT = 60; // 함선과 낱말이 함께 차지하는 세로 크기
const SPAWN_COLUMN_SPACING = 150;    // 같은 레인 안 출현 지점 사이의 가로 간격
const SPAWN_ENTRY_SECONDS = 1;       // 출현 지점을 떠나 화면에 들어오기까지 걸리는 시간

let spawnLanes = [];                 // [{ y, speed }]
let laneHeight = 0;
let maxWaveAmp = 0;
let spawnColumnCount = 1;

// 캔버스 크기에 맞춰 레인을 다시 계산합니다.
// 같은 레인에 있는 함선끼리 간격이 유지되도록 속도를 레인 단위로 고정합니다.
// (속도가 서로 다르면 앞선 함선을 따라잡아 결국 겹치게 됩니다.)
function initSpawnLanes(preserveSpeeds = false) {
    const previous = spawnLanes;
    const usable = Math.max(canvas.height - LANE_EDGE_MARGIN * 2, LANE_MIN_HEIGHT);
    const count = Math.max(1, Math.min(LANE_MAX_COUNT, Math.floor(usable / LANE_MIN_HEIGHT)));

    laneHeight = usable / count;
    maxWaveAmp = Math.max(0, (laneHeight - ENEMY_VERTICAL_FOOTPRINT) / 2);
    spawnColumnCount = Math.max(1, Math.ceil(maxChallenge / count));

    spawnLanes = [];
    for (let i = 0; i < count; i++) {
        const reused = preserveSpeeds && previous[i] ? previous[i].speed : randomEnemySpeed();
        spawnLanes.push({
            y: LANE_EDGE_MARGIN + laneHeight * (i + 0.5),
            speed: reused
        });
    }
}

// 첫 번째 열은 함선 몸통을 화면 밖에 두고 레인 속도에 비례한 거리를 더해,
// 레인 속도나 함선 크기와 무관하게 항상 SPAWN_ENTRY_SECONDS 뒤에 화면에 들어오게 합니다.
function spawnSlotX(column, laneSpeed, shipHalfWidth) {
    const entryDistance = shipHalfWidth + laneSpeed * SPAWN_ENTRY_SECONDS;
    return canvas.width + entryDistance + column * SPAWN_COLUMN_SPACING;
}

function laneSpeedFor(enemy) {
    const lane = spawnLanes[enemy.laneIndex];
    const base = lane ? lane.speed : randomEnemySpeed();
    return enemySpeedFor(enemy.enemyType, base);
}

// 비어 있는 출현 슬롯 중 하나를 무작위로 반환합니다.
// 화면에 가까운 열부터 차례로 확인하므로, 격추 직후 다음 함선이 오래 기다리지 않습니다.
// 먼 열은 가까운 열이 모두 막혔을 때(= 동시 등장 수가 많을 때)만 사용합니다.
function pickSpawnSlot(shipHalfWidth) {
    if (spawnLanes.length === 0) initSpawnLanes();

    for (let col = 0; col < spawnColumnCount; col++) {
        const free = [];

        for (let lane = 0; lane < spawnLanes.length; lane++) {
            const x = spawnSlotX(col, spawnLanes[lane].speed, shipHalfWidth);
            if (laneClearanceAt(lane, x) >= SPAWN_COLUMN_SPACING) {
                free.push({ laneIndex: lane, x: x });
            }
        }

        if (free.length > 0) {
            return free[Math.floor(Math.random() * free.length)];
        }
    }

    // 모든 열이 막힌 경우(격추 속도가 슬롯이 비는 속도보다 빠를 때)에도 겹치게 두지 않고,
    // 각 레인의 맨 뒤에 한 칸 간격을 두고 붙입니다. 그중 화면에 가장 빨리 닿는 레인을 고릅니다.
    let best = null;
    for (let lane = 0; lane < spawnLanes.length; lane++) {
        let rightmost = -Infinity;
        for (const e of enemies) {
            if (e.laneIndex === lane) rightmost = Math.max(rightmost, e.x);
        }

        const x = Math.max(
            spawnSlotX(0, spawnLanes[lane].speed, shipHalfWidth),
            rightmost + SPAWN_COLUMN_SPACING
        );
        if (!best || x < best.x) {
            best = { laneIndex: lane, x: x };
        }
    }
    return best;
}

// 해당 레인에서 주어진 가로 위치와 가장 가까운 함선까지의 거리입니다.
function laneClearanceAt(laneIndex, x) {
    let gap = Infinity;
    for (const e of enemies) {
        if (e.laneIndex !== laneIndex) continue;
        gap = Math.min(gap, Math.abs(e.x - x));
    }
    return gap;
}

// 함선을 지정한 레인에 앉힙니다. (세로 위치와 속도만 조정하고 가로 위치는 건드리지 않습니다.)
function placeEnemyInLane(e, laneIndex) {
    const lane = spawnLanes[laneIndex];
    if (!lane) return;

    e.laneIndex = laneIndex;

    // 조준/발사 중인 레이저 함선은 멈춰 있어야 하므로 속도를 되살리지 않습니다.
    const isAiming = e.enemyType === 'line' && (e.laserState === 'warning' || e.laserState === 'firing');
    const typedSpeed = enemySpeedFor(e.enemyType, lane.speed);
    e.savedSpeed = typedSpeed;
    if (!isAiming) {
        e.speed = typedSpeed;
    }

    if (e.enemyType === 1) {
        e.baseY = lane.y;
        e.waveAmp = Math.min(e.waveAmp, maxWaveAmp);
        e.y = e.baseY + Math.sin(e.waveTimer * e.waveSpeed) * e.waveAmp;
    } else {
        e.y = lane.y;
    }
}

// 화면 왼쪽으로 빠져나간 함선을 비어 있는 출현 슬롯으로 되돌립니다.
function moveEnemyToSpawnSlot(e) {
    const slot = pickSpawnSlot(e.width / 2);
    if (e.enemyType === 1) {
        e.waveTimer = Math.random() * Math.PI * 2;
    }
    placeEnemyInLane(e, slot.laneIndex);
    e.x = slot.x;
}

// 창 크기가 바뀌어 레인 구성이 달라졌을 때, 떠 있는 함선들을 겹치지 않는 레인으로 다시 앉힙니다.
// 레인 수가 줄어들면 한 레인에 여러 대가 몰릴 수 있으므로 자리를 하나씩 확인하며 배치합니다.
function reseatEnemiesIntoLanes() {
    if (spawnLanes.length === 0) return;

    const seated = [];
    // 오른쪽(가장 늦게 등장한 쪽)부터 자리를 잡아 화면 안쪽 함선이 밀려나지 않게 합니다.
    const ordered = [...enemies].sort((a, b) => b.x - a.x);

    for (const e of ordered) {
        // 지금 위치에서 가장 가까운 레인부터 후보로 검사해 이동 거리를 최소화합니다.
        const candidates = spawnLanes
            .map((lane, index) => ({ index: index, dist: Math.abs(lane.y - e.y) }))
            .sort((a, b) => a.dist - b.dist);

        let chosen = -1;
        for (const candidate of candidates) {
            const conflict = seated.some(s =>
                s.laneIndex === candidate.index && Math.abs(s.x - e.x) < SPAWN_COLUMN_SPACING
            );
            if (!conflict) {
                chosen = candidate.index;
                break;
            }
        }

        if (chosen === -1) {
            // 화면 안에 앉힐 자리가 없으면 화면 밖 출현 슬롯으로 되돌립니다.
            moveEnemyToSpawnSlot(e);
        } else {
            placeEnemyInLane(e, chosen);
        }
        seated.push(e);
    }
}
let pendingChallengeClear = false;
let pendingGameOver = false;
let endScreenDelay = 0;
let asteroidBurstScheduled = false;
let stars = [];
let particles = [];

// Init stars
for (let i = 0; i < 100; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: Math.random() * 50 + 10,
        size: Math.random() * 2
    });
}

// 초보자용 설명:
// 창 크기가 바뀌면 캔버스 좌표계도 다시 맞춰야 충돌 판정/렌더링이 어긋나지 않습니다.
function resizeCanvasToContainer() {
    const prevWidth = canvas.width || 1;
    const prevHeight = canvas.height || 1;
    const nextWidth = canvas.parentElement.clientWidth;
    const nextHeight = canvas.parentElement.clientHeight;

    if (nextWidth <= 0 || nextHeight <= 0) return;

    canvas.width = nextWidth;
    canvas.height = nextHeight;

    const scaleX = nextWidth / prevWidth;
    const scaleY = nextHeight / prevHeight;

    stars.forEach(s => {
        s.x *= scaleX;
        s.y *= scaleY;
    });

    player.y = Math.max(20, Math.min(canvas.height - 20, player.y));

    // 레인 위치는 다시 계산하되, 이미 떠 있는 함선이 서로 따라잡지 않도록 속도는 유지합니다.
    initSpawnLanes(true);
    reseatEnemiesIntoLanes();
}

// 1000×700 설계 해상도를 뷰포트에 맞춰 균등 스케일(레터박스). 가로만 늘려 난이도가 쉬워지지 않게 한다.
function fitGameToViewport() {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const scale = Math.min(
        (vw - VIEW_PAD * 2) / DESIGN_W,
        (vh - VIEW_PAD * 2) / DESIGN_H
    );
    gameContainer.style.transform = `scale(${Math.max(scale, 0.1)})`;
}

function handleViewportResize() {
    fitGameToViewport();
    resizeCanvasToContainer();
}

window.addEventListener('resize', handleViewportResize);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', fitGameToViewport);
}
fitGameToViewport();
resizeCanvasToContainer();

function isSettingsOpen() {
    return !modalSettings.classList.contains('hidden');
}

function isModalOpen() {
    return isSettingsOpen() ||
        !modalChallengeClear.classList.contains('hidden') ||
        !modalGameOver.classList.contains('hidden');
}

let wasPausedBeforeSettings = false;
let settingsPausedGame = false;

function isEnterKey(e) {
    return e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13;
}

function proceedChallengeClear() {
    modalChallengeClear.classList.add('hidden');
    nextChallenge();
}

function proceedGameOver() {
    modalGameOver.classList.add('hidden');
    returnToTitle();
}

// 게임 오버 후 모든 상태를 초기화하고 타이틀 화면으로 돌아갑니다.
// (플레이어가 이름/언어를 다시 설정할 수 있도록 START 단계로 복귀)
function returnToTitle() {
    clearBannerTimers();
    hideCenterBanner();
    resetGame();
    battlePrepActive = false;
    gameState = 'START';
    modalSettings.classList.add('hidden');
    disableTypeInput();
    startOverlay.classList.remove('hidden');
}

function pauseGame() {
    if (isPaused) return;
    if (gameState !== 'PLAYING' && gameState !== 'BEAM_INPUT') return;
    if (isModalOpen()) return;

    isPaused = true;
    pauseStartTime = Date.now();
    pauseOverlay.classList.remove('hidden');
    typeInput.blur();
    typeInput.disabled = true;
}

function disableTypeInput() {
    if (typeInput.disabled) return;
    typeInput.disabled = true;
    typeInput.blur();
    typeInput.value = '';
    currentTypingStartTime = null;
}

function enableTypeInput() {
    typeInput.disabled = false;
}

function focusTypeInput() {
    enableTypeInput();
    typeInput.focus();
}

function resumeGame() {
    if (!isPaused) return;

    const paused = Date.now() - pauseStartTime;
    lastTime = Date.now();
    if (currentTypingStartTime) {
        currentTypingStartTime += paused;
    }
    isPaused = false;
    pauseOverlay.classList.add('hidden');
    focusTypeInput();
}

// Input Handling
const keys = {
    ArrowUp: false,
    ArrowDown: false
};

startOverlay.addEventListener('click', () => {
    if (gameState === 'START') startBattlePrep();
});

document.getElementById('btn-resume').addEventListener('click', () => {
    resumeGame();
});

window.addEventListener('blur', pauseGame);

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        pauseGame();
    }
});

window.addEventListener('keydown', e => {
    if (isSettingsOpen()) {
        if (isEnterKey(e)) {
            e.preventDefault();
            saveSettings();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSettingsWithoutSave();
            return;
        }
        return;
    }

    if (isEnterKey(e)) {
        if (!modalChallengeClear.classList.contains('hidden')) {
            e.preventDefault();
            proceedChallengeClear();
            return;
        }
        if (!modalGameOver.classList.contains('hidden')) {
            e.preventDefault();
            proceedGameOver();
            return;
        }
        if (isPaused) {
            e.preventDefault();
            resumeGame();
            return;
        }
        if (gameState === 'START') {
            e.preventDefault();
            startBattlePrep();
            return;
        }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        keys[e.key] = true;
        e.preventDefault();
    }

    if ((gameState === 'PLAYING' || gameState === 'BEAM_INPUT') && !isPaused && !typeInput.disabled) {
        typeInput.focus();
    }
});

window.addEventListener('keyup', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        keys[e.key] = false;
    }
});

typeInput.addEventListener('input', e => {
    if (typeInput.disabled || isPaused) return;

    if (typeInput.value.length > 0 && !currentTypingStartTime) {
        currentTypingStartTime = Date.now();
    }
    if (typeInput.value.length === 0) {
        currentTypingStartTime = null;
    }
});

typeInput.addEventListener('keydown', e => {
    if (typeInput.disabled || isPaused) {
        e.preventDefault();
        return;
    }

    if (isEnterKey(e)) {
        if (isSettingsOpen() ||
            !modalChallengeClear.classList.contains('hidden') ||
            !modalGameOver.classList.contains('hidden') ||
            isPaused) {
            return;
        }

        e.preventDefault();

        if (gameState === 'START') {
            startBattlePrep();
            typeInput.value = '';
            return;
        }

        setTimeout(() => {
            const text = typeInput.value.trim();
            typeInput.value = '';

            if (currentTypingStartTime) {
                totalTypingTime += (Date.now() - currentTypingStartTime) / 1000;
                currentTypingStartTime = null;
            }

            if (text === '') return;

            if (isPaused || pendingChallengeClear || pendingGameOver) {
                return;
            }

            if (gameState === 'PLAYING') {
                processTyping(text);
            } else if (gameState === 'BEAM_INPUT') {
                processBeamTyping(text);
            }
        }, 10);
    }
});

function openSettings() {
    wasPausedBeforeSettings = isPaused;
    settingsPausedGame = (gameState === 'PLAYING' || gameState === 'BEAM_INPUT') && !isPaused;
    if (settingsPausedGame) {
        isPaused = true;
        pauseStartTime = Date.now();
    }

    document.getElementById('setting-name').value = settings.name;
    document.getElementById('setting-lang').value = settings.lang;
    document.getElementById('setting-grade').value = String(settings.grade);
    updateGradeVisibility();
    if (settingsHint) settingsHint.textContent = SETTINGS_HINT_DEFAULT;
    setInstallHint(INSTALL_HINT_DEFAULT);
    refreshInstallButtonState();
    disableTypeInput();
    modalSettings.classList.remove('hidden');
    document.getElementById('setting-name').focus();
}

function resumeAfterSettings() {
    if (settingsPausedGame && !wasPausedBeforeSettings) {
        const paused = Date.now() - pauseStartTime;
        lastTime = Date.now();
        if (currentTypingStartTime) {
            currentTypingStartTime += paused;
        }
        isPaused = false;
    }
    settingsPausedGame = false;
    wasPausedBeforeSettings = false;

    if (isPaused) {
        typeInput.blur();
        typeInput.disabled = true;
        return;
    }

    if (gameState === 'PLAYING' || gameState === 'BEAM_INPUT' || gameState === 'START') {
        focusTypeInput();
    }
}

function closeSettingsWithoutSave() {
    document.getElementById('setting-name').value = settings.name;
    document.getElementById('setting-lang').value = settings.lang;
    document.getElementById('setting-grade').value = String(settings.grade);
    updateGradeVisibility();
    modalSettings.classList.add('hidden');

    // 게임 시작 전 "Ready for Battle" 단계에서 닫으면 타이틀 화면으로 돌아갑니다.
    if (battlePrepActive) {
        battlePrepActive = false;
        gameState = 'START';
        startOverlay.classList.remove('hidden');
        return;
    }

    resumeAfterSettings();
}

function saveSettings() {
    const rawName = document.getElementById('setting-name').value;
    const rawLang = document.getElementById('setting-lang').value;
    const rawGrade = document.getElementById('setting-grade').value;

    // 초보자용 설명:
    // 이름이 공백만 들어오면 점수판이 보기 어려워지므로 기본 이름으로 보정합니다.
    settings.name = rawName.trim() || "Player";
    settings.lang = rawLang === 'en' ? 'en' : 'ko';
    settings.grade = normalizeGrade(rawGrade);

    document.getElementById('setting-name').value = settings.name;
    document.getElementById('setting-lang').value = settings.lang;
    document.getElementById('setting-grade').value = String(settings.grade);
    updateGradeVisibility();
    localStorage.setItem('starwords_settings', JSON.stringify(settings));
    refreshWordPool();
    modalSettings.classList.add('hidden');

    // "Ready for Battle" 단계에서 Deploy 하면 카운트다운 → CHALLENGE 1 순서로 진입합니다.
    if (battlePrepActive) {
        battlePrepActive = false;
        startCountdownSequence();
        return;
    }

    resumeAfterSettings();
}

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-close-settings').addEventListener('click', closeSettingsWithoutSave);
document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

// --- PWA install (settings footer) ---
const btnInstallPwa = document.getElementById('btn-install-pwa');
const settingsHint = document.getElementById('settings-hint');
const installHint = document.getElementById('install-hint');
const SETTINGS_HINT_DEFAULT = '[ENTER] Deploy · [ESC] Close';
const INSTALL_HINT_DEFAULT = 'Install for offline play on this device';
const INSTALL_HINT_IOS = 'Share → Add to Home Screen';
let deferredInstallPrompt = null;

function isPwaInstalled() {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (typeof navigator.standalone === 'boolean' && navigator.standalone) return true;
    return false;
}

function isIosSafari() {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const webkit = /WebKit/.test(ua);
    const notChrome = !/CriOS|FxiOS|EdgiOS/.test(ua);
    return iOS && webkit && notChrome;
}

function setInstallHint(text) {
    if (installHint) installHint.textContent = text;
}

function setInstallButtonInstalled() {
    if (!btnInstallPwa) return;
    btnInstallPwa.textContent = 'INSTALLED';
    btnInstallPwa.disabled = true;
    btnInstallPwa.classList.add('is-installed');
    deferredInstallPrompt = null;
    setInstallHint(INSTALL_HINT_DEFAULT);
}

function setInstallButtonReady() {
    if (!btnInstallPwa) return;
    btnInstallPwa.textContent = 'INSTALL';
    btnInstallPwa.disabled = false;
    btnInstallPwa.classList.remove('is-installed');
}

function setInstallButtonWaiting() {
    if (!btnInstallPwa) return;
    btnInstallPwa.textContent = 'INSTALL';
    // iOS: keep clickable for home-screen hint; otherwise wait for beforeinstallprompt
    if (isIosSafari() && !isPwaInstalled()) {
        btnInstallPwa.disabled = false;
        btnInstallPwa.classList.remove('is-installed');
    } else {
        btnInstallPwa.disabled = true;
        btnInstallPwa.classList.remove('is-installed');
    }
}

function refreshInstallButtonState() {
    if (isPwaInstalled()) {
        setInstallButtonInstalled();
    } else if (deferredInstallPrompt) {
        setInstallButtonReady();
    } else {
        setInstallButtonWaiting();
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    refreshInstallButtonState();
});

window.addEventListener('appinstalled', () => {
    setInstallButtonInstalled();
});

if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
        if (isPwaInstalled()) return;

        if (deferredInstallPrompt) {
            const promptEvent = deferredInstallPrompt;
            deferredInstallPrompt = null;
            promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === 'accepted') {
                setInstallButtonInstalled();
            } else {
                refreshInstallButtonState();
            }
            return;
        }

        if (isIosSafari()) {
            setInstallHint(INSTALL_HINT_IOS);
        }
    });
}

refreshInstallButtonState();

// 언어를 바꾸면 즉시 Grade 선택 UI 표시 여부를 갱신합니다. (한글일 때만 노출)
document.getElementById('setting-lang').addEventListener('change', updateGradeVisibility);

document.getElementById('btn-next-challenge').addEventListener('click', proceedChallengeClear);

document.getElementById('btn-restart').addEventListener('click', proceedGameOver);

function isEnemyOnScreen(e) {
    return e.x <= canvas.width - e.width / 2;
}

// 입력한 낱말과 일치하는 적을 '화면에 완전히 진입한 적'과 '아직 걸친(무적) 적'으로 분류한다.
function resolveTypingTargets(text) {
    const onScreen = [];
    const straddling = [];
    for (const e of enemies) {
        if (e.word !== text) continue;
        (isEnemyOnScreen(e) ? onScreen : straddling).push(e);
    }
    return { onScreen, straddling };
}

function processTyping(text) {
    msg1.classList.remove('attack-missed');
    const { onScreen, straddling } = resolveTypingTargets(text);

    if (onScreen.length > 0) {
        // 정상 명중: 함포 발사 후 격추, 빔 충전
        const strokes = keystrokeCount(text);
        onScreen.forEach(() => {
            totalTypedChars += strokes;
        });
        enqueueCannonFire(onScreen);
        showHitMessage(onScreen[0].word);
        showConsoleMsg2("새로운 목표물 설정하십시오.");
        beamCharge = Math.min(100, beamCharge + 10);
        updateBeamCharge();
    } else if (straddling.length > 0) {
        // 아직 진입하지 않은 적은 무적: 레이저를 90도로 튕겨낸다. (빔/통계 중립)
        straddling.forEach(e => fireDeflectedLaser(e));
        showAttackMissedMessage();
    } else {
        // 매칭 없음: 미스 처리
        clearHitMessageTimeout();
        failedChars += keystrokeCount(text);
        beamCharge = Math.max(0, beamCharge - 10);
        updateBeamCharge();
        msg1.textContent = "목표를 찾을 수 없습니다.";
        showConsoleMsg2("다시 확인하십시오.");
    }

    if (beamCharge === 100 && gameState === 'PLAYING') {
        triggerBeamMode();
    }
}

function processBeamTyping(text) {
    if (text === beamTargetCode) {
        totalTypedChars += keystrokeCount(text);
        fireSuperPowerBeam();
    } else {
        msg1.classList.remove('attack-missed');
        const { onScreen, straddling } = resolveTypingTargets(text);

        if (onScreen.length > 0) {
            const strokes = keystrokeCount(text);
            onScreen.forEach(() => {
                totalTypedChars += strokes;
            });
            enqueueCannonFire(onScreen);
        } else if (straddling.length > 0) {
            // 아직 진입하지 않은 적은 무적: 레이저를 90도로 튕겨낸다. (빔/통계 중립)
            straddling.forEach(e => fireDeflectedLaser(e));
            showAttackMissedMessage();
        } else {
            failedChars += keystrokeCount(text);
            beamCharge = Math.max(0, beamCharge - 10);
            updateBeamCharge();
            gameState = 'PLAYING';
            msg1.textContent = "목표를 찾을 수 없습니다. POWER BEAM 방전. 재충전합니다.";
            showConsoleMsg2("함장님, 새로운 목표물을 설정하십시오.");
        }
    }
}

function triggerBeamMode(isNewChallenge = false) {
    gameState = 'BEAM_INPUT';
    beamTargetCode = beamCodes[Math.floor(Math.random() * beamCodes.length)];
    if (isNewChallenge) {
        msg1.textContent = "새로운 POWER BEAM CODE가 설정되었습니다.";
    } else {
        msg1.textContent = "POWER BEAM 충전 완료. 발사 코드를 입력하십시오.";
    }
    showBeamCode(beamTargetCode);
}

function fireSuperPowerBeam() {
    beamCharge = 0;
    updateBeamCharge();
    challengeBeamFires++;
    beamFires++;
    addMissionPoints(1000);

    fireQueue = [];
    fireQueueDelay = 0;

    // 화면 안 적은 격추, 미진입(무적) 적에게도 빔을 발사하되 90도로 튕겨낸다.
    const onScreen = [];
    const straddling = [];
    for (const e of enemies) {
        (isEnemyOnScreen(e) ? onScreen : straddling).push(e);
    }
    onScreen.forEach(e => destroyEnemy(e));
    straddling.forEach(e => fireDeflectedLaser(e));

    gameState = 'PLAYING';
    msg1.textContent = "SUPER POWER BEAM 발사! 냉각 및 재충전을 시작합니다.";
    showConsoleMsg2("새로운 목표물을 설정하십시오.");
}

// ── 시작 스토리 시퀀스 ──
// 화면 중앙 배너(카운트다운 / CHALLENGE 인트로)를 다루는 헬퍼들입니다.
function clearBannerTimers() {
    if (bannerTimeout !== null) {
        clearTimeout(bannerTimeout);
        bannerTimeout = null;
    }
    countdownTimeouts.forEach(t => clearTimeout(t));
    countdownTimeouts = [];
}

function showCenterBanner(text, variant) {
    centerBanner.textContent = text;
    centerBanner.classList.remove('hidden', 'countdown', 'challenge');
    // 같은 요소를 재사용하므로 reflow를 강제해 CSS 애니메이션을 다시 시작시킵니다.
    void centerBanner.offsetWidth;
    centerBanner.classList.add(variant);
}

function hideCenterBanner() {
    centerBanner.classList.add('hidden');
}

function showChallengeBanner(challengeNum) {
    const text = challengeNum >= maxChallenge ? 'Final Battle' : `CHALLENGE ${challengeNum}`;
    showCenterBanner(text, 'challenge');
    if (bannerTimeout !== null) {
        clearTimeout(bannerTimeout);
    }
    bannerTimeout = setTimeout(() => {
        bannerTimeout = null;
        hideCenterBanner();
    }, 2000);
}

function updateChallengeHud() {
    uiChallenge.textContent = currentChallenge >= maxChallenge ? 'Final' : String(currentChallenge);
}

// 타이틀에서 시작을 누르면 "Ready for Battle" 창(설정 모달)을 띄웁니다.
function startBattlePrep() {
    clearBannerTimers();
    hideCenterBanner();
    startOverlay.classList.add('hidden');
    battlePrepActive = true;
    gameState = 'PREP';
    document.getElementById('setting-name').value = settings.name;
    document.getElementById('setting-lang').value = settings.lang;
    document.getElementById('setting-grade').value = String(settings.grade);
    updateGradeVisibility();
    if (settingsHint) settingsHint.textContent = SETTINGS_HINT_DEFAULT;
    setInstallHint(INSTALL_HINT_DEFAULT);
    refreshInstallButtonState();
    disableTypeInput();
    modalSettings.classList.remove('hidden');
    document.getElementById('setting-name').focus();
}

// "3 > 2 > 1" 카운트다운 후 첫 챌린지를 시작합니다.
function startCountdownSequence() {
    clearBannerTimers();
    gameState = 'COUNTDOWN';
    disableTypeInput();

    showCenterBanner('3', 'countdown');
    countdownTimeouts.push(setTimeout(() => showCenterBanner('2', 'countdown'), 1000));
    countdownTimeouts.push(setTimeout(() => showCenterBanner('1', 'countdown'), 2000));
    countdownTimeouts.push(setTimeout(() => {
        countdownTimeouts = [];
        hideCenterBanner();
        startGame();
        showChallengeBanner(currentChallenge);
    }, 3000));
}

function startGame() {
    resetGame();
    refreshWordPool();
    initSpawnLanes();
    startOverlay.classList.add('hidden');
    startTime = Date.now();
    lastTime = Date.now();
    gameState = 'PLAYING';
    focusTypeInput();
    spawnEnemies();
}

function nextChallenge() {
    currentChallenge++;
    if (currentChallenge > maxChallenge) {
        return;
    }

    // 타자 통계(totalTypedChars / failedChars / totalTypingTime)는 게임 전체 누적이므로 초기화하지 않는다.
    challengeEnemiesDestroyed = 0;
    challengeBeamFires = 0;
    energyShield = 100;
    updateEnergyShield();
    updateChallengeHud();
    enemies = [];
    missiles = [];
    lasers = [];
    fireQueue = [];
    fireQueueDelay = 0;
    particles = [];
    asteroids = [];
    asteroidsSpawnedThisChallenge = false;
    asteroidBurstScheduled = false;
    refreshWordPool();
    initSpawnLanes();
    spawnEnemies();

    if (beamCharge === 100) {
        triggerBeamMode(true);
    } else {
        gameState = 'PLAYING';
        if (currentChallenge >= maxChallenge) {
            msg1.textContent = "FINAL BATTLE 작전을 시작합니다! 모든 대원 전투배치.";
        } else {
            msg1.textContent = `다수의 적대적 함선이 포착되었습니다. CHALLENGE ${currentChallenge} 작전을 시작합니다!`;
        }
        showConsoleMsg2("모든 대원 정위치. 첫 목표물을 말씀하십시오.");
    }

    focusTypeInput();
    lastTime = Date.now();
    updateMissionPoints();
    showChallengeBanner(currentChallenge);
}

function resetHudScores() {
    uiMissionPoints.textContent = '0';
    uiTriggeringSkill.textContent = '0';
    document.getElementById('result-mission-points').textContent = '0';
    document.getElementById('result-skill').textContent = '0';
    document.getElementById('final-mission-points').textContent = '0';
    document.getElementById('result-kpm').textContent = '0';
}

function resetGame() {
    currentChallenge = 1;
    energyShield = 100;
    beamCharge = 0;
    player.invincibleTimer = 0;
    player.y = canvas.height / 2;
    missionPoints = 0;
    enemiesDestroyed = 0;
    challengeEnemiesDestroyed = 0;
    beamFires = 0;
    challengeBeamFires = 0;
    totalTypedChars = 0;
    failedChars = 0;
    totalTypingTime = 0;
    currentTypingStartTime = null;
    startTime = 0;
    typeInput.value = '';
    updateChallengeHud();
    updateEnergyShield();
    updateBeamCharge();
    resetHudScores();
    enemies = [];
    missiles = [];
    lasers = [];
    fireQueue = [];
    fireQueueDelay = 0;
    particles = [];
    asteroids = [];
    asteroidsSpawnedThisChallenge = false;
    clearHitMessageTimeout();
    clearMissileWarning(false);
    isPaused = false;
    pauseStartTime = 0;
    pauseOverlay.classList.add('hidden');
    pendingChallengeClear = false;
    pendingGameOver = false;
    endScreenDelay = 0;
    asteroidBurstScheduled = false;
    enableTypeInput();
    msg1.textContent = "다수의 적 함선 탐지. 전원 전투태세. 함포가 준비되었습니다.";
    showConsoleMsg2("목표물을 설정하십시오.");
}

function enqueueCannonFire(targets) {
    const wasIdle = fireQueue.length === 0;
    for (const enemy of targets) {
        fireQueue.push(enemy);
    }
    if (wasIdle) {
        fireNextInQueue();
    }
}

function fireNextInQueue() {
    if (fireQueue.length === 0) {
        fireQueueDelay = 0;
        return;
    }

    const enemy = fireQueue.shift();
    if (enemies.includes(enemy)) {
        destroyEnemy(enemy);
    }

    if (fireQueue.length > 0) {
        fireQueueDelay = CANNON_FIRE_INTERVAL;
    } else {
        fireQueueDelay = 0;
    }
}

function updateFireQueue(dt) {
    if (fireQueue.length === 0) return;

    fireQueueDelay -= dt;
    if (fireQueueDelay <= 0) {
        fireNextInQueue();
    }
}

// 무적(미진입) 적에게 발사한 레이저: 명중 지점에서 90도로 화면 밖(가까운 상/하)으로 튕겨낸다.
function fireDeflectedLaser(enemy) {
    const goUp = enemy.y < canvas.height / 2;
    lasers.push({
        startX: player.x + player.width,
        startY: player.y,
        endX: enemy.x,
        endY: enemy.y,
        timer: 0.15,
        deflected: true,
        bounceX: enemy.x,
        bounceY: goUp ? -60 : canvas.height + 60
    });
}

function destroyEnemy(enemy) {
    let eIndex = enemies.indexOf(enemy);
    if (eIndex !== -1) {
        lasers.push({
            startX: player.x + player.width,
            startY: player.y,
            endX: enemy.x,
            endY: enemy.y,
            timer: 0.15
        });

        if (enemy.enemyType === 'line') {
            createStarDestroyerExplosion(enemy.x, enemy.y);
        } else {
            let color;
            if (enemy.enemyType === 1) color = '#00ff00';
            else if (enemy.enemyType === 2) color = 'yellow';
            else color = 'orange';
            createExplosion(enemy.x, enemy.y, color, 80);
        }

        enemies.splice(eIndex, 1);
        challengeEnemiesDestroyed++;
        enemiesDestroyed++;
        addMissionPoints(100);

        missiles = missiles.filter(m => m.source !== enemy);

        if (challengeEnemiesDestroyed + enemies.length < enemyCountForChallenge(currentChallenge)) {
            createNewEnemy();
        }
    }
}

function spawnEnemies() {
    // 화면 동시 등장 수 = 레벨(챌린지) 수. (총 격추목표는 enemyCountForChallenge 로 별도 관리)
    let count = currentChallenge;
    for (let i = 0; i < count; i++) {
        createNewEnemy();
    }
}

function createNewEnemy() {
    let word = wordsList[Math.floor(Math.random() * wordsList.length)];
    let types = [1, 2, 3, 'line'];
    let type = types[Math.floor(Math.random() * types.length)];

    let eWidth = 40;
    let eHeight = 30;
    if (type === 1) { eWidth = 30; eHeight = 20; }
    else if (type === 2) { eWidth = 45; eHeight = 35; }
    else if (type === 3 || type === 'line') { eWidth = 60; eHeight = 45; }

    // 미리 배치해 둔 출현 슬롯 중 비어 있는 곳에서 무작위로 등장시킵니다.
    const slot = pickSpawnSlot(eWidth / 2);
    const lane = spawnLanes[slot.laneIndex];
    let speed = enemySpeedFor(type, lane.speed);

    let enemyObj = {
        x: slot.x,
        y: lane.y,
        laneIndex: slot.laneIndex,
        width: eWidth,
        height: eHeight,
        speed: speed,
        word: word,
        enemyType: type,
        // 미진입(무적) 네온 방어막 알파. 완전 진입 후 fade out.
        shieldAlpha: 1
    };

    if (type === 1) {
        enemyObj.waveSpeed = (Math.random() * 2 + 2) / 5;
        // 상하로 흔들려도 자기 레인을 벗어나지 않도록 진폭을 제한합니다.
        enemyObj.waveAmp = Math.min((Math.random() * 50 + 50) / 2, maxWaveAmp);
        enemyObj.baseY = lane.y;
        enemyObj.waveTimer = Math.random() * Math.PI * 2;
        enemyObj.y = enemyObj.baseY + Math.sin(enemyObj.waveTimer * enemyObj.waveSpeed) * enemyObj.waveAmp;
        enemyObj.missileTimer = Math.random() * 7;
    } else if (type === 2) {
        enemyObj.missileTimer = Math.random() * 7;
    } else if (type === 3) {
        enemyObj.missileTimer = Math.random() * 4;
    } else if (type === 'line') {
        enemyObj.laserState = 'moving';
        enemyObj.laserTimer = Math.random() * 3 + 2;
        enemyObj.savedSpeed = speed;
        enemyObj.laserTargetX = 0;
        enemyObj.laserTargetY = 0;
        enemyObj.missileTimer = Math.random() * 3 + 2;
    }

    enemies.push(enemyObj);
}

// ── 회색 운석 (파괴·타자 불가) ──
function maybeSpawnAsteroids() {
    if (asteroidsSpawnedThisChallenge) return;
    if (gameState !== 'PLAYING' && gameState !== 'BEAM_INPUT') return;

    const T = enemyCountForChallenge(currentChallenge);
    const remaining = T - challengeEnemiesDestroyed;
    if (remaining <= (2 * T) / 3 && remaining >= T / 2) {
        spawnAsteroidWave(currentChallenge);
        asteroidsSpawnedThisChallenge = true;
    }
}

function spawnAsteroidWave(count) {
    const yMin = canvas.height / 3;
    const yMax = (canvas.height * 2) / 3;
    const startX = canvas.width + 40;

    for (let i = 0; i < count; i++) {
        const radius = 14 + Math.random() * 12;
        let y;
        if (count === 1) {
            y = yMin + Math.random() * (yMax - yMin);
        } else {
            y = yMin + (i / (count - 1)) * (yMax - yMin);
            y += (Math.random() - 0.5) * 24;
            y = Math.max(yMin, Math.min(yMax, y));
        }

        const sides = 7 + Math.floor(Math.random() * 3);
        const verts = [];
        for (let v = 0; v < sides; v++) {
            const ang = (v / sides) * Math.PI * 2;
            const r = radius * (0.7 + Math.random() * 0.35);
            verts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
        }

        const tier = Math.floor(Math.random() * ASTEROID_SPEED_TIERS.length);
        asteroids.push({
            x: startX + i * ASTEROID_COLUMN_SPACING,
            y: y,
            radius: radius,
            speed: ASTEROID_SPEED_TIERS[tier],
            rotation: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 2.5,
            verts: verts
        });
    }
}

function updateAsteroids(dt) {
    const px = player.x + player.width / 2;
    const py = player.y;

    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        a.x -= a.speed * dt;
        a.rotation += a.spin * dt;

        const dx = px - a.x;
        const dy = py - a.y;
        if (Math.sqrt(dx * dx + dy * dy) < a.radius + 14) {
            if (player.invincibleTimer <= 0) {
                energyShield -= 10;
                updateEnergyShield();
                player.invincibleTimer = 2.0;
                createExplosion(px, py, '#888888', 40);
            }
        }

        if (a.x < -a.radius - 20) {
            asteroids.splice(i, 1);
        }
    }
}

function isAsteroidOnScreen(a) {
    return a.x + a.radius > 0 && a.x - a.radius < canvas.width;
}

// 스테이지 종료 시 운석 불꽃놀이: 네온 팔레트 다색 폭파
const ASTEROID_FIREWORK_COLORS = [
    '#00ffcc', '#c8ff3d', '#ffe066', '#ff7700', '#ff4dff', '#3de8ff', '#ff3366', '#adff2f'
];

function createAsteroidFireworks(x, y) {
    for (let i = 0; i < 55; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 320 + 80;
        const life = Math.random() * 0.7 + 0.5;
        particles.push({
            x: x + (Math.random() - 0.5) * 10,
            y: y + (Math.random() - 0.5) * 10,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: life,
            maxLife: life + 0.6,
            size: Math.random() * 6 + 2,
            color: ASTEROID_FIREWORK_COLORS[Math.floor(Math.random() * ASTEROID_FIREWORK_COLORS.length)]
        });
    }
}

// 종료 연출: 화면 밖 운석은 즉시 제거, 화면 안 운석은 시차 폭파 예약
function burstOnScreenAsteroids() {
    if (asteroidBurstScheduled) return;
    asteroidBurstScheduled = true;

    const onScreen = [];
    for (let i = asteroids.length - 1; i >= 0; i--) {
        if (isAsteroidOnScreen(asteroids[i])) {
            onScreen.push(asteroids[i]);
        } else {
            asteroids.splice(i, 1);
        }
    }

    if (onScreen.length === 0) return;

    // END_SCREEN_DELAY(2초) 안에 들어가게 간격 조절
    const interval = Math.min(0.12, 1.4 / onScreen.length);
    onScreen.forEach((a, i) => {
        a.burstAt = i * interval;
        a.bursting = true;
    });
}

function updateAsteroidBursts(dt) {
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        if (!a.bursting) continue;

        a.burstAt -= dt;
        if (a.burstAt <= 0) {
            createAsteroidFireworks(a.x, a.y);
            asteroids.splice(i, 1);
        }
    }
}

function drawAsteroid(a) {
    const hex = '#8a8a8a';
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.rotation);

    const drawPoly = (ox, oy, scale) => {
        ctx.beginPath();
        a.verts.forEach((v, i) => {
            const x = v.x * scale + ox;
            const y = v.y * scale + oy;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.closePath();
    };

    // 하단/우측 그림자 실루엣
    ctx.fillStyle = shipShade(hex, 'deep');
    drawPoly(a.radius * 0.08, a.radius * 0.1, 1);
    ctx.fill();

    // 본체
    ctx.fillStyle = shipShade(hex, 'mid');
    drawPoly(0, 0, 1);
    ctx.fill();

    // 상단/좌측 하이라이트 (축소 폴리곤)
    ctx.fillStyle = shipShade(hex, 'highlight');
    drawPoly(-a.radius * 0.06, -a.radius * 0.08, 0.72);
    ctx.fill();

    // 능선/균열 (직선)
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(-a.radius * 0.35, -a.radius * 0.15);
    ctx.lineTo(a.radius * 0.1, a.radius * 0.25);
    ctx.moveTo(a.radius * 0.05, -a.radius * 0.4);
    ctx.lineTo(a.radius * 0.35, a.radius * 0.05);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 크레이터 (테두리 하이라이트 + 안쪽 그림자)
    const drawCrater = (cx, cy, r) => {
        ctx.fillStyle = shipShade(hex, 'deep');
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shipShade(hex, 'shadow');
        ctx.beginPath();
        ctx.arc(cx + r * 0.15, cy + r * 0.15, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = shipShade(hex, 'highlight');
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx - r * 0.15, cy - r * 0.15, r * 0.85, -Math.PI * 0.9, Math.PI * 0.15);
        ctx.stroke();
    };
    drawCrater(-a.radius * 0.25, -a.radius * 0.2, a.radius * 0.22);
    drawCrater(a.radius * 0.3, a.radius * 0.15, a.radius * 0.15);

    // 외곽선
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = 1.5;
    drawPoly(0, 0, 1);
    ctx.stroke();

    ctx.restore();
}

function createExplosion(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * 250 + 50;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: Math.random() * 0.6 + 0.4,
            maxLife: 1.0,
            size: Math.random() * 5 + 2,
            color: color
        });
    }
}

function createHugeExplosion(x, y, color) {
    for (let i = 0; i < 200; i++) {
        let angle = Math.random() * Math.PI * 2;
        let speed = Math.random() * 400 + 100;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: Math.random() * 1.5 + 1.0,
            maxLife: 2.5,
            size: Math.random() * 12 + 6,
            color: color
        });
    }
}

// 거대 전함(스타디스트로이어) 격파: 빨강 코어 + 주황/노랑 파편으로 대규모 파괴감
function createStarDestroyerExplosion(x, y) {
    const bursts = [
        { color: '#ee2222', count: 70, speedMin: 80, speedRange: 280, sizeMin: 3, sizeRange: 7, lifeMin: 0.5, lifeRange: 0.7 },
        { color: '#ff7700', count: 90, speedMin: 100, speedRange: 340, sizeMin: 4, sizeRange: 9, lifeMin: 0.6, lifeRange: 0.9 },
        { color: '#ffcc22', count: 90, speedMin: 120, speedRange: 380, sizeMin: 3, sizeRange: 8, lifeMin: 0.7, lifeRange: 1.0 },
        { color: '#fff5aa', count: 40, speedMin: 60, speedRange: 220, sizeMin: 2, sizeRange: 5, lifeMin: 0.4, lifeRange: 0.6 }
    ];

    bursts.forEach(b => {
        for (let i = 0; i < b.count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * b.speedRange + b.speedMin;
            const life = Math.random() * b.lifeRange + b.lifeMin;
            particles.push({
                x: x + (Math.random() - 0.5) * 28,
                y: y + (Math.random() - 0.5) * 20,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: life,
                maxLife: life + 0.8,
                size: Math.random() * b.sizeRange + b.sizeMin,
                color: b.color
            });
        }
    });
}

function getEnergyShieldColor() {
    if (energyShield > 80) return '#00ffcc';
    if (energyShield > 60) return '#adff2f';
    if (energyShield > 40) return '#ffff00';
    if (energyShield > 20) return '#ffa500';
    return '#ff3366';
}

function updateCockpitNeonFromShield() {
    const hex = getEnergyShieldColor().replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const midR = Math.min(255, r + 50);
    const midG = Math.min(255, g + 50);
    const midB = Math.min(255, b + 50);
    const coreR = Math.min(255, Math.round(r * 0.35 + 255 * 0.65));
    const coreG = Math.min(255, Math.round(g * 0.35 + 255 * 0.65));
    const coreB = Math.min(255, Math.round(b * 0.35 + 255 * 0.65));

    gameContainer.style.setProperty('--neon-line', `#${hex}`);
    gameContainer.style.setProperty('--neon-bloom', `rgba(${r}, ${g}, ${b}, 0.55)`);
    gameContainer.style.setProperty('--neon-mid', `rgba(${midR}, ${midG}, ${midB}, 0.9)`);
    gameContainer.style.setProperty('--neon-core', `rgb(${coreR}, ${coreG}, ${coreB})`);
    gameContainer.style.setProperty('--neon-glow', `rgba(${r}, ${g}, ${b}, 0.85)`);
}

function updateEnergyShield() {
    energyShield = Math.max(0, Math.min(100, Math.round(energyShield)));
    uiEnergyShield.style.width = energyShield + '%';
    uiEnergyShield.style.background = getEnergyShieldColor();
    uiEnergyShieldValue.textContent = energyShield;
    updateCockpitNeonFromShield();
}

function updateBeamCharge() {
    beamCharge = Math.max(0, Math.min(100, Math.round(beamCharge)));
    uiBeamGauge.style.width = beamCharge + "%";
    uiBeamValue.textContent = beamCharge;

    if (beamCharge === 100) {
        uiBeamGauge.classList.add('beam-ready');
    } else {
        uiBeamGauge.classList.remove('beam-ready');
    }
}

function addMissionPoints(points) {
    missionPoints += points;
    updateMissionPoints();
}

function updateMissionPoints() {
    uiMissionPoints.textContent = missionPoints;
}

function drawEnergyShieldBubble() {
    if (gameState === 'GAME_OVER' || energyShield <= 0) return;

    const cx = player.x + player.width / 2;
    const cy = player.y;
    const radiusX = 38 + (energyShield / 100) * 6;
    const radiusY = 32 + (energyShield / 100) * 5;
    const baseAlpha = 0.12 + (energyShield / 100) * 0.3;

    let color = getEnergyShieldColor();
    let alpha = baseAlpha;

    if (player.invincibleTimer > 0) {
        const flash = Math.floor(player.invincibleTimer * 12) % 2 === 0;
        if (flash) {
            color = '#ffffff';
            alpha = 0.55;
        }
    }

    ctx.save();

    ctx.globalAlpha = alpha;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, radiusX);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// 두벌식 필요 타수. 한글 음절은 초·중·종성 키 수, 영문 등은 글자당 1타.
// 쌍자음(ㄲ 등)=1타, 복합모음·겹받침=2타. Shift는 세지 않는다.
const JUNG_STROKES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 2, 2, 2, 1, 1, 1];
const JONG_STROKES = [
    0, 1, 1, 2, 1, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
];

function keystrokeCount(text) {
    let n = 0;
    for (const ch of text) {
        if (ch === '\n' || ch === '\r') continue;
        const c = ch.codePointAt(0);
        if (c >= 0xAC00 && c <= 0xD7A3) {
            const s = c - 0xAC00;
            n += 1; // 초성 (쌍자음 포함 1타)
            n += JUNG_STROKES[Math.floor((s % 588) / 28)];
            n += JONG_STROKES[s % 28];
        } else {
            n += 1;
        }
    }
    return n;
}

// 게임 시작부터의 누적 유효 타수 / 실제 입력 시간 → 분당 타수
function currentStageSkill() {
    let currentSessionTime = 0;
    if (currentTypingStartTime) {
        currentSessionTime = (Date.now() - currentTypingStartTime) / 1000;
    }

    let totalSeconds = totalTypingTime + currentSessionTime;
    if (totalSeconds <= 0) {
        return 0;
    }

    let effectiveChars = totalTypedChars - failedChars;
    return Math.max(0, Math.floor((effectiveChars / totalSeconds) * 60));
}

function calculateTriggeringSkill() {
    const skill = currentStageSkill();
    uiTriggeringSkill.textContent = skill;
    return skill;
}

function scheduleChallengeClear() {
    if (pendingChallengeClear || pendingGameOver || gameState === 'CHALLENGE_CLEAR' || gameState === 'GAME_OVER') {
        return;
    }
    pendingChallengeClear = true;
    endScreenDelay = 0;
    burstOnScreenAsteroids();
    if (fireQueue.length === 0) {
        disableTypeInput();
    }
}

function scheduleGameOver() {
    if (pendingChallengeClear || pendingGameOver || gameState === 'GAME_OVER') {
        return;
    }
    pendingGameOver = true;
    endScreenDelay = 0;
    burstOnScreenAsteroids();
    if (energyShield <= 0) {
        createHugeExplosion(player.x + player.width / 2, player.y, '#00ffcc');
    }
    if (fireQueue.length === 0) {
        disableTypeInput();
    }
}

function updateEndingSequence(dt) {
    updateFireQueue(dt);
    updateAsteroidBursts(dt);

    for (let i = lasers.length - 1; i >= 0; i--) {
        let l = lasers[i];
        l.timer -= dt;
        if (l.timer <= -0.5) {
            lasers.splice(i, 1);
        }
    }

    if (fireQueue.length > 0) {
        endScreenDelay = 0;
        return;
    }

    disableTypeInput();

    endScreenDelay += dt;
    if (endScreenDelay < END_SCREEN_DELAY) {
        return;
    }

    endScreenDelay = 0;
    if (pendingChallengeClear) {
        pendingChallengeClear = false;
        if (currentChallenge >= maxChallenge) {
            showBreakthrough();
        } else {
            handleChallengeClear();
        }
    } else if (pendingGameOver) {
        pendingGameOver = false;
        showGameOver();
    }
}

function gameLoop() {
    if (isPaused || isSettingsOpen()) {
        requestAnimationFrame(gameLoop);
        return;
    }

    let now = Date.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;

    stars.forEach(s => {
        s.x -= s.speed * dt;
        if (s.x < 0) s.x = canvas.width;
    });

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }

    if (gameState === 'PLAYING' || gameState === 'BEAM_INPUT') {
        if (pendingChallengeClear || pendingGameOver) {
            updateEndingSequence(dt);
        } else {
            update(dt);

            if (challengeEnemiesDestroyed >= enemyCountForChallenge(currentChallenge)) {
                scheduleChallengeClear();
            } else if (energyShield <= 0) {
                scheduleGameOver();
            }
        }
    }

    draw();

    requestAnimationFrame(gameLoop);
}

function update(dt) {
    calculateTriggeringSkill();
    updateFireQueue(dt);

    if (player.invincibleTimer > 0) {
        player.invincibleTimer -= dt;
    }

    if (keys.ArrowUp) player.y -= player.speed * dt;
    if (keys.ArrowDown) player.y += player.speed * dt;

    if (player.y < 20) player.y = 20;
    if (player.y > canvas.height - 20) player.y = canvas.height - 20;

    maybeSpawnAsteroids();
    updateAsteroids(dt);

    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];

        // 미진입이면 방어막 풀 밝기, 진입하면 0.4초에 걸쳐 fade out.
        if (!isEnemyOnScreen(e)) {
            e.shieldAlpha = 1;
        } else if (e.shieldAlpha > 0) {
            e.shieldAlpha = Math.max(0, e.shieldAlpha - dt / 0.4);
        }

        if (e.enemyType === 'line') {
            if (e.laserState === 'moving') {
                e.x -= e.speed * dt;
                if (e.x <= canvas.width - e.width / 2) {
                    e.laserTimer -= dt;
                    if (e.laserTimer <= 0) {
                        e.laserState = 'warning';
                        e.laserTimer = LASER_WARNING_DURATION;
                        e.savedSpeed = e.speed;
                        e.speed = 0;

                        let ax = e.x - e.width / 2;
                        let ay = e.y;
                        let targetX = player.x + player.width / 2;
                        let targetY = player.y;
                        let tDx = targetX - ax;
                        let tDy = targetY - ay;
                        let tDist = Math.sqrt(tDx * tDx + tDy * tDy);
                        let dirX = tDist > 0 ? tDx / tDist : -1;
                        let dirY = tDist > 0 ? tDy / tDist : 0;

                        e.laserTargetX = ax + dirX * 2000;
                        e.laserTargetY = ay + dirY * 2000;
                    }
                }
            } else if (e.laserState === 'warning') {
                e.laserTimer -= dt;
                if (e.laserTimer <= 0) {
                    e.laserState = 'firing';
                    e.laserTimer = 0.75;
                }
            } else if (e.laserState === 'firing') {
                e.laserTimer -= dt;

                let duration = 0.75;
                let elapsed = duration - e.laserTimer;

                let ax = e.x - e.width / 2;
                let ay = e.y;
                let bx = e.laserTargetX;
                let by = e.laserTargetY;
                let dist = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));

                let growDuration = 0.15;
                let currentLength = elapsed < growDuration ? (elapsed / growDuration) * dist : dist;

                let endX = dist > 0 ? ax + (bx - ax) * (currentLength / dist) : ax;
                let endY = dist > 0 ? ay + (by - ay) * (currentLength / dist) : ay;

                if (elapsed < 0.40) {
                    let px = player.x + player.width / 2;
                    let py = player.y;
                    let abx = endX - ax;
                    let aby = endY - ay;
                    let apx = px - ax;
                    let apy = py - ay;

                    let abLenSq = abx * abx + aby * aby;
                    let t = abLenSq > 0 ? (apx * abx + apy * aby) / abLenSq : 0;
                    t = Math.max(0, Math.min(1, t));

                    let closestX = ax + t * abx;
                    let closestY = ay + t * aby;

                    let dx = px - closestX;
                    let dy = py - closestY;
                    let hitDist = Math.sqrt(dx * dx + dy * dy);

                    if (hitDist < 20) {
                        if (player.invincibleTimer <= 0) {
                            energyShield -= 10;
                            updateEnergyShield();
                            player.invincibleTimer = 2.0;
                            createExplosion(player.x + player.width / 2, player.y, '#00ffff', 100);
                        }
                    }
                }

                if (e.laserTimer <= 0) {
                    e.laserState = 'cooldown';
                    e.laserTimer = 5.0;
                    e.speed = e.savedSpeed || laneSpeedFor(e);
                }
            } else if (e.laserState === 'cooldown') {
                e.x -= e.speed * dt;
                e.laserTimer -= dt;
                if (e.laserTimer <= 0) {
                    e.laserState = 'warning';
                    e.laserTimer = LASER_WARNING_DURATION;
                    e.savedSpeed = e.speed;
                    e.speed = 0;

                    let ax = e.x - e.width / 2;
                    let ay = e.y;
                    let targetX = player.x + player.width / 2;
                    let targetY = player.y;
                    let tDx = targetX - ax;
                    let tDy = targetY - ay;
                    let tDist = Math.sqrt(tDx * tDx + tDy * tDy);
                    let dirX = tDist > 0 ? tDx / tDist : -1;
                    let dirY = tDist > 0 ? tDy / tDist : 0;

                    e.laserTargetX = ax + dirX * 2000;
                    e.laserTargetY = ay + dirY * 2000;
                }
            }

            if (e.x < -e.width) {
                moveEnemyToSpawnSlot(e);
                e.laserState = 'moving';
                e.laserTimer = Math.random() * 3 + 2;
            }
        } else {
            e.x -= e.speed * dt;

            if (e.enemyType === 1) {
                e.waveTimer += dt;
                e.y = e.baseY + Math.sin(e.waveTimer * e.waveSpeed) * e.waveAmp;
            }

            if (e.x < -e.width) {
                moveEnemyToSpawnSlot(e);
            }

            if (e.word !== "") {
                if (e.x <= canvas.width - e.width / 2) {
                    if (e.enemyType === 1) {
                        e.missileTimer -= dt;
                        if (e.missileTimer <= 0) {
                            fireEnemyMissiles(e);
                            e.missileTimer = 7.0;
                        }
                    } else if (e.enemyType === 2) {
                        e.missileTimer -= dt;
                        if (e.missileTimer <= 0) {
                            fireEnemyMissiles(e);
                            e.missileTimer = 7.0;
                        }
                    } else if (e.enemyType === 3) {
                        e.missileTimer -= dt;
                        if (e.missileTimer <= 0) {
                            fireEnemyMissiles(e);
                            e.missileTimer = 4.0;
                        }
                    }
                }
            }
        }
    }

    for (let i = lasers.length - 1; i >= 0; i--) {
        let l = lasers[i];
        l.timer -= dt;
        if (l.timer <= -0.5) {
            lasers.splice(i, 1);
        }
    }

    for (let i = missiles.length - 1; i >= 0; i--) {
        let m = missiles[i];

        if (m.delay > 0) {
            m.delay -= dt;
            if (m.source && enemies.includes(m.source)) {
                m.x = m.source.x - m.source.width / 2;
                m.y = m.source.y;
            }
            continue;
        }

        if (m.shape === 'line' && m.currentLength < m.maxLength) {
            let growSpeed = MISSILE_LINE_GROW_SPEED;
            m.currentLength += growSpeed * dt;
            if (m.currentLength > m.maxLength) {
                m.currentLength = m.maxLength;
            }
            if (m.source && enemies.includes(m.source)) {
                let tailX = m.source.x - m.source.width / 2;
                let tailY = m.source.y;
                m.x = tailX + m.dirX * m.currentLength;
                m.y = tailY + m.dirY * m.currentLength;
            } else {
                m.x += m.dirX * growSpeed * dt;
                m.y += m.dirY * growSpeed * dt;
            }
        } else {
            m.x += m.dirX * m.speed * dt;
            m.y += m.dirY * m.speed * dt;
        }

        let hitDx = (player.x + player.width / 2) - m.x;
        let hitDy = player.y - m.y;
        let hitDist = Math.sqrt(hitDx * hitDx + hitDy * hitDy);

        if (hitDist < 20) {
            missiles.splice(i, 1);

            if (player.invincibleTimer <= 0) {
                energyShield -= 10;
                updateEnergyShield();
                player.invincibleTimer = 2.0;
                createExplosion(player.x + player.width / 2, player.y, '#00ffff', 100);
            }
            continue;
        }

        if (m.x < -10 || m.x > canvas.width + 10 || m.y < -10 || m.y > canvas.height + 10) {
            missiles.splice(i, 1);
        }
    }

    updateMissileProximityWarning();
}

function fireEnemyMissiles(enemy) {
    let startX = enemy.x - enemy.width / 2;
    let startY = enemy.y;
    let targetX = player.x + player.width / 2;
    let targetY = player.y;

    let dx = targetX - startX;
    let dy = targetY - startY;
    let dist = Math.sqrt(dx * dx + dy * dy);
    let dirX = dist > 0 ? dx / dist : -1;
    let dirY = dist > 0 ? dy / dist : 0;

    let type = enemy.enemyType;
    let shape;
    let count;

    if (type === 'line') {
        shape = 'line';
        count = 1;
    } else {
        let normalShapes = ['circle', 'triangle'];
        shape = normalShapes[Math.floor(Math.random() * normalShapes.length)];
        count = type;
    }

    for (let j = 0; j < count; j++) {
        missiles.push({
            x: enemy.x - enemy.width / 2,
            y: enemy.y,
            source: enemy,
            speed: MISSILE_SPEED,
            delay: j * 0.5,
            dirX: dirX,
            dirY: dirY,
            shape: shape,
            currentLength: 0,
            maxLength: shape === 'line' ? 750 : 0
        });
    }
}

function darkenColor(color, amount) {
    const hex = color.replace('#', '');
    const r = Math.max(0, parseInt(hex.substring(0, 2), 16) - amount);
    const g = Math.max(0, parseInt(hex.substring(2, 4), 16) - amount);
    const b = Math.max(0, parseInt(hex.substring(4, 6), 16) - amount);
    return `rgb(${r}, ${g}, ${b})`;
}

function lightenColor(color, amount) {
    const hex = color.replace('#', '');
    const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + amount);
    const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + amount);
    const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + amount);
    return `rgb(${r}, ${g}, ${b})`;
}

// 함선 공통 셰이딩: highlight / mid / shadow / deep
function shipShade(hex, kind) {
    switch (kind) {
        case 'highlight': return lightenColor(hex, 70);
        case 'mid': return hex;
        case 'shadow': return darkenColor(hex, 45);
        case 'deep': return darkenColor(hex, 80);
        default: return hex;
    }
}

function drawShipCockpit(cx, cy, r) {
    ctx.fillStyle = 'rgba(180, 240, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dff8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
}

function drawThrusterGlow(x, y, r) {
    ctx.fillStyle = 'rgba(255, 140, 40, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff0c0';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
}

// Millennium Falcon 후미: 밝은 파란 엔진 밴드 + 왼쪽 화면 끝까지 그라데이션 플룸
function drawFalconEngineNeon(cx, cy, hw, hh) {
    const bankX = cx - hw * 0.88;
    const bankW = Math.max(4, hw * 0.22);
    const bankH = hh * 0.62;
    const coreH = bankH * 0.55;
    // 트레일은 캔버스 왼쪽 끝(0)에서 투명하게 사라짐 — 쉴드(~cx±44) 밖으로 충분히 길게
    const trailLeft = 0;
    const trailRight = bankX + bankW * 0.35;

    ctx.save();

    // ── 긴 엔진 플룸 (그라데이션 → 왼쪽 화면 끝) ──
    const plumeGrad = ctx.createLinearGradient(trailRight, cy, trailLeft, cy);
    plumeGrad.addColorStop(0, 'rgba(220, 245, 255, 0.95)');
    plumeGrad.addColorStop(0.06, 'rgba(120, 200, 255, 0.8)');
    plumeGrad.addColorStop(0.2, 'rgba(50, 140, 255, 0.45)');
    plumeGrad.addColorStop(0.45, 'rgba(30, 100, 220, 0.22)');
    plumeGrad.addColorStop(0.75, 'rgba(20, 60, 160, 0.08)');
    plumeGrad.addColorStop(1, 'rgba(10, 30, 80, 0)');

    ctx.fillStyle = plumeGrad;
    // 약간 테이퍼: 엔진 쪽은 두껍고 왼쪽은 얇아짐
    ctx.beginPath();
    ctx.moveTo(trailRight, cy - bankH * 0.52);
    ctx.lineTo(trailRight, cy + bankH * 0.52);
    ctx.lineTo(trailLeft, cy + coreH * 0.35);
    ctx.lineTo(trailLeft, cy - coreH * 0.35);
    ctx.closePath();
    ctx.fill();

    // 코어 빔 (더 가늘고 밝은 중앙 스트립)
    const coreGrad = ctx.createLinearGradient(trailRight, cy, trailLeft, cy);
    coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    coreGrad.addColorStop(0.12, 'rgba(180, 230, 255, 0.7)');
    coreGrad.addColorStop(0.4, 'rgba(100, 180, 255, 0.28)');
    coreGrad.addColorStop(0.8, 'rgba(60, 140, 255, 0.06)');
    coreGrad.addColorStop(1, 'rgba(40, 100, 200, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.moveTo(trailRight, cy - coreH * 0.28);
    ctx.lineTo(trailRight, cy + coreH * 0.28);
    ctx.lineTo(trailLeft, cy + coreH * 0.08);
    ctx.lineTo(trailLeft, cy - coreH * 0.08);
    ctx.closePath();
    ctx.fill();

    // ── 엔진 노즐 밴드 (레퍼런스처럼 가로로 강한 파란 빛) ──
    ctx.shadowColor = '#4da6ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(40, 130, 255, 0.45)';
    ctx.fillRect(bankX - bankW * 0.2, cy - bankH * 0.55, bankW * 1.4, bankH * 1.1);

    const nozzleGrad = ctx.createLinearGradient(bankX, cy - bankH / 2, bankX, cy + bankH / 2);
    nozzleGrad.addColorStop(0, 'rgba(80, 160, 255, 0.35)');
    nozzleGrad.addColorStop(0.5, 'rgba(230, 250, 255, 1)');
    nozzleGrad.addColorStop(1, 'rgba(80, 160, 255, 0.35)');
    ctx.fillStyle = nozzleGrad;
    ctx.fillRect(bankX, cy - bankH / 2, bankW, bankH);

    // 가로 슬랫
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#f2fbff';
    const slotCount = 5;
    for (let i = 0; i < slotCount; i++) {
        const t = (i + 0.5) / slotCount;
        const sy = cy - bankH / 2 + t * bankH - 1;
        ctx.fillRect(bankX - bankW * 0.15, sy, bankW * 1.25, 2);
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

function fillPlumpEllipse(cx, cy, rx, ry, hex) {
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.08, cy + ry * 0.12, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.92, ry * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.22, cy - ry * 0.28, rx * 0.45, ry * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
}

/*
 * Falcon design prompt (implementation guide):
 * Top-down Millennium Falcon game sprite, facing right.
 * Circular saucer with radial panels + center hub; keep highlight/mid/shadow volume.
 * Twin forward mandibles on the RIGHT: parallel mechanical forks, trapezoid bodies,
 * blunt flat tips (not needle horns), inner notch, tip detail dot, clear center gap.
 * Offset cockpit capsule on the LEFT of the saucer (engine/rear-left), short neck + rounded pod.
 * Rear blue neon engine band + long gradient plume to screen-left edge (unchanged behavior).
 * Metallic gray #c8c8c8, readable at ~40×30.
 */
function drawFalcon(cx, cy, w, h, color = '#c8c8c8') {
    const hw = w / 2;
    const hh = h / 2;
    const hex = color.startsWith('#') ? color : '#c8c8c8';
    const discCx = cx - hw * 0.08;
    const discR = Math.min(hw, hh) * 0.95;

    ctx.save();

    // 후방 파란 엔진 플룸 (왼쪽)
    drawFalconEngineNeon(cx, cy, hw, hh);

    // ── 원반 동체 (입체 음영) ──
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.arc(discCx + discR * 0.06, cy + discR * 0.08, discR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.arc(discCx, cy, discR * 0.96, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.ellipse(discCx - discR * 0.22, cy - discR * 0.28, discR * 0.42, discR * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // 방사형 패널 라인
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(discCx + Math.cos(a) * discR * 0.22, cy + Math.sin(a) * discR * 0.22);
        ctx.lineTo(discCx + Math.cos(a) * discR * 0.9, cy + Math.sin(a) * discR * 0.9);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 중앙 허브
    ctx.fillStyle = shipShade(hex, 'deep');
    ctx.beginPath();
    ctx.arc(discCx, cy, discR * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.arc(discCx - discR * 0.04, cy - discR * 0.04, discR * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // 상·하 가장자리 기계 노치
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.fillRect(discCx - discR * 0.12, cy - discR * 0.98, discR * 0.24, discR * 0.14);
    ctx.fillRect(discCx - discR * 0.12, cy + discR * 0.84, discR * 0.24, discR * 0.14);

    // ── 전방 만디블 (우측): 평행 사다리꼴 + 뭉툭한 끝 ──
    const drawMandible = (ySign) => {
        const rootX = discCx + discR * 0.55;
        const tipX = cx + hw * 0.95;
        const midY = cy + ySign * discR * 0.38;
        const yOuter = midY + ySign * discR * 0.2;
        const yInner = midY + ySign * discR * 0.05;

        // shadow
        ctx.fillStyle = shipShade(hex, 'shadow');
        ctx.beginPath();
        ctx.moveTo(rootX, yOuter);
        ctx.lineTo(tipX, yOuter - ySign * discR * 0.06);
        ctx.lineTo(tipX, yInner);
        ctx.lineTo(rootX + discR * 0.12, yInner);
        ctx.closePath();
        ctx.fill();

        // mid body — 평행 포크, 끝은 뭉툭
        ctx.fillStyle = shipShade(hex, 'mid');
        ctx.beginPath();
        ctx.moveTo(rootX, yOuter);
        ctx.lineTo(tipX - hw * 0.05, yOuter - ySign * discR * 0.04);
        ctx.lineTo(tipX, yOuter - ySign * discR * 0.08);
        ctx.lineTo(tipX, yInner + ySign * discR * 0.02);
        ctx.lineTo(tipX - hw * 0.05, yInner);
        ctx.lineTo(rootX + discR * 0.08, yInner);
        ctx.closePath();
        ctx.fill();

        // highlight strip
        ctx.fillStyle = shipShade(hex, 'highlight');
        ctx.beginPath();
        ctx.moveTo(rootX + discR * 0.04, yOuter - ySign * discR * 0.04);
        ctx.lineTo(tipX - hw * 0.12, yOuter - ySign * discR * 0.1);
        ctx.lineTo(tipX - hw * 0.12, yOuter - ySign * discR * 0.16);
        ctx.lineTo(rootX + discR * 0.04, yOuter - ySign * discR * 0.1);
        ctx.closePath();
        ctx.fill();

        // 안쪽 사각 노치
        ctx.fillStyle = shipShade(hex, 'deep');
        const notchX = rootX + (tipX - rootX) * 0.42;
        const notchY = (yOuter + yInner) / 2;
        ctx.fillRect(notchX - hw * 0.05, notchY - hh * 0.04, hw * 0.1, hh * 0.08);

        // 끝단 디테일 점
        ctx.beginPath();
        ctx.arc(tipX - hw * 0.035, (yOuter + yInner) / 2, Math.max(1.2, hw * 0.04), 0, Math.PI * 2);
        ctx.fill();
    };
    drawMandible(-1);
    drawMandible(1);

    // ── 왼쪽(후방 쪽) 오프셋 조종석 포드 ──
    const cockBaseX = discCx - discR * 0.55;
    const cockY = cy + discR * 0.42;
    const neckX1 = discCx - discR * 0.25;
    const neckY1 = cy + discR * 0.2;

    // 목
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.moveTo(neckX1, neckY1);
    ctx.lineTo(cockBaseX + hw * 0.08, cockY - hh * 0.12);
    ctx.lineTo(cockBaseX + hw * 0.08, cockY + hh * 0.12);
    ctx.lineTo(neckX1 - hw * 0.02, neckY1 + hh * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(neckX1, neckY1 + hh * 0.02);
    ctx.lineTo(cockBaseX + hw * 0.06, cockY - hh * 0.08);
    ctx.lineTo(cockBaseX + hw * 0.06, cockY + hh * 0.08);
    ctx.lineTo(neckX1 - hw * 0.01, neckY1 + hh * 0.12);
    ctx.closePath();
    ctx.fill();

    // 캡슐 조종석 (왼쪽)
    const podRx = hw * 0.2;
    const podRy = hh * 0.22;
    const podCx = cockBaseX - hw * 0.02;
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.ellipse(podCx + 1, cockY + 1, podRx, podRy, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.ellipse(podCx, cockY, podRx * 0.95, podRy * 0.92, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.ellipse(podCx - podRx * 0.2, cockY - podRy * 0.25, podRx * 0.4, podRy * 0.35, -0.35, 0, Math.PI * 2);
    ctx.fill();

    // 조종석 창
    drawShipCockpit(podCx - podRx * 0.15, cockY - podRy * 0.05, Math.min(hw, hh) * 0.1);

    // 목 뿌리 원형 디테일
    ctx.fillStyle = shipShade(hex, 'deep');
    ctx.beginPath();
    ctx.arc(neckX1, neckY1 + hh * 0.06, discR * 0.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawStarDestroyer(cx, cy, w, h, color = '#ee2222') {
    // Imperial Star Destroyer: 사각뿔(쐐기) 실루엣 — 좌측 tip, 우측 넓은 선미 + 후방 브리지
    const hw = w / 2;
    const hh = h / 2;
    const hex = color.startsWith('#') ? color : '#ee2222';
    const tipX = cx - hw;
    const sternX = cx + hw * 0.9;
    const sternHalf = hh;

    ctx.save();

    drawThrusterGlow(sternX - hw * 0.05, cy - hh * 0.22, Math.min(hw, hh) * 0.08);
    drawThrusterGlow(sternX - hw * 0.05, cy, Math.min(hw, hh) * 0.09);
    drawThrusterGlow(sternX - hw * 0.05, cy + hh * 0.22, Math.min(hw, hh) * 0.08);

    // 하단(그림자) 면 — 약간 아래로 어긋난 쐐기
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.moveTo(tipX, cy + hh * 0.06);
    ctx.lineTo(sternX, cy + sternHalf);
    ctx.lineTo(sternX, cy + hh * 0.08);
    ctx.closePath();
    ctx.fill();

    // 본체 쐐기 (직선만)
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(sternX, cy - sternHalf);
    ctx.lineTo(sternX, cy + sternHalf);
    ctx.closePath();
    ctx.fill();

    // 상단 하이라이트 면 (중앙 능선 → 우상단)
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(sternX, cy - sternHalf);
    ctx.lineTo(sternX, cy - hh * 0.12);
    ctx.lineTo(cx - hw * 0.1, cy);
    ctx.closePath();
    ctx.fill();

    // 중앙 능선
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(sternX - hw * 0.35, cy);
    ctx.stroke();

    // 가로 패널 (쐐기 폭에 맞춰 직선)
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < 4; i++) {
        const t = 0.22 + i * 0.18;
        const x = tipX + (sternX - tipX) * t;
        const halfSpan = sternHalf * t;
        ctx.beginPath();
        ctx.moveTo(x, cy - halfSpan);
        ctx.lineTo(x, cy + halfSpan);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 후방 브리지 타워 (각진 직사각)
    const bx = cx + hw * 0.38;
    const bw = hw * 0.42;
    const bh = hh * 0.55;
    ctx.fillStyle = shipShade(hex, 'deep');
    ctx.fillRect(bx, cy - bh / 2, bw, bh);
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.fillRect(bx + bw * 0.15, cy - bh * 0.32, bw * 0.7, bh * 0.64);

    // 실드 제너레이터 돔 (브리지 상단 양쪽)
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.arc(bx + bw * 0.28, cy - bh * 0.15, hw * 0.07, 0, Math.PI * 2);
    ctx.arc(bx + bw * 0.28, cy + bh * 0.15, hw * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // 전방 뷰포트 (작은 각진 점)
    ctx.fillStyle = '#dff8ff';
    ctx.fillRect(cx - hw * 0.35, cy - hh * 0.06, hw * 0.12, hh * 0.12);

    ctx.restore();
}

function drawTieFighter(cx, cy, w, h, color = '#00ff00') {
    // TIE/ln: 중앙 구형 콕핏 + 상하 육각 솔라 패널 (직선 육각)
    const hw = w / 2;
    const hh = h / 2;
    const hex = color.startsWith('#') ? color : '#00ff00';

    ctx.save();

    const drawHexPanel = (oy, rx, ry) => {
        // 그림자 레이어
        ctx.fillStyle = shipShade(hex, 'shadow');
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            const px = cx + Math.cos(a) * rx;
            const py = cy + oy + Math.sin(a) * ry + hh * 0.04;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = shipShade(hex, 'mid');
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            const px = cx + Math.cos(a) * rx;
            const py = cy + oy + Math.sin(a) * ry;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();

        // 패널 격자 (직선)
        ctx.strokeStyle = shipShade(hex, 'deep');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.55, cy + oy);
        ctx.lineTo(cx + rx * 0.55, cy + oy);
        ctx.moveTo(cx, cy + oy - ry * 0.7);
        ctx.lineTo(cx, cy + oy + ry * 0.7);
        ctx.stroke();

        // 하이라이트 면 (각진 사다리꼴)
        ctx.fillStyle = shipShade(hex, 'highlight');
        ctx.beginPath();
        ctx.moveTo(cx - rx * 0.45, cy + oy - ry * 0.15);
        ctx.lineTo(cx - rx * 0.1, cy + oy - ry * 0.55);
        ctx.lineTo(cx + rx * 0.15, cy + oy - ry * 0.45);
        ctx.lineTo(cx - rx * 0.2, cy + oy);
        ctx.closePath();
        ctx.fill();
    };

    drawHexPanel(-hh * 0.72, hw * 0.88, hh * 0.38);
    drawHexPanel(hh * 0.72, hw * 0.88, hh * 0.38);

    // 연결 암 (직선 바)
    ctx.fillStyle = shipShade(hex, 'deep');
    ctx.fillRect(cx - hw * 0.06, cy - hh * 0.55, hw * 0.12, hh * 0.22);
    ctx.fillRect(cx - hw * 0.06, cy + hh * 0.33, hw * 0.12, hh * 0.22);

    // 중앙 콕핏 구 — 각진 팔면체 느낌의 다이아몬드 레이어
    const cr = Math.min(hw, hh) * 0.42;
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.moveTo(cx, cy - cr * 1.05);
    ctx.lineTo(cx + cr * 1.05, cy);
    ctx.lineTo(cx, cy + cr * 1.05);
    ctx.lineTo(cx - cr * 1.05, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(cx, cy - cr * 0.9);
    ctx.lineTo(cx + cr * 0.9, cy);
    ctx.lineTo(cx, cy + cr * 0.9);
    ctx.lineTo(cx - cr * 0.9, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.moveTo(cx - cr * 0.35, cy - cr * 0.15);
    ctx.lineTo(cx, cy - cr * 0.7);
    ctx.lineTo(cx + cr * 0.15, cy - cr * 0.25);
    ctx.lineTo(cx - cr * 0.1, cy);
    ctx.closePath();
    ctx.fill();

    drawThrusterGlow(cx + cr * 0.85, cy, Math.min(hw, hh) * 0.1);
    drawShipCockpit(cx, cy, Math.min(hw, hh) * 0.14);

    ctx.restore();
}

function drawYwing(cx, cy, w, h, color = '#ffdd00') {
    // BTL Y-wing: 쐐기 콕핏 + 중앙 스파 + 쌍 엔진 나셀 (직선)
    const hw = w / 2;
    const hh = h / 2;
    const hex = color.startsWith('#') ? color : '#ffdd00';

    ctx.save();

    const drawNacelle = (oy) => {
        const nx = cx + hw * 0.05;
        const nw = hw * 0.85;
        const nh = hh * 0.28;
        // 그림자
        ctx.fillStyle = shipShade(hex, 'shadow');
        ctx.beginPath();
        ctx.moveTo(nx, cy + oy - nh * 0.3);
        ctx.lineTo(nx + nw, cy + oy - nh * 0.55);
        ctx.lineTo(nx + nw, cy + oy + nh * 0.7);
        ctx.lineTo(nx, cy + oy + nh * 0.45);
        ctx.closePath();
        ctx.fill();
        // 본체
        ctx.fillStyle = shipShade(hex, 'mid');
        ctx.beginPath();
        ctx.moveTo(nx, cy + oy - nh * 0.45);
        ctx.lineTo(nx + nw * 0.95, cy + oy - nh * 0.7);
        ctx.lineTo(nx + nw * 0.95, cy + oy + nh * 0.55);
        ctx.lineTo(nx, cy + oy + nh * 0.3);
        ctx.closePath();
        ctx.fill();
        // 하이라이트
        ctx.fillStyle = shipShade(hex, 'highlight');
        ctx.beginPath();
        ctx.moveTo(nx + nw * 0.1, cy + oy - nh * 0.35);
        ctx.lineTo(nx + nw * 0.75, cy + oy - nh * 0.55);
        ctx.lineTo(nx + nw * 0.75, cy + oy - nh * 0.15);
        ctx.lineTo(nx + nw * 0.1, cy + oy - nh * 0.05);
        ctx.closePath();
        ctx.fill();
        // 전방 센서 돔 (작은 각진 박스)
        ctx.fillStyle = shipShade(hex, 'deep');
        ctx.fillRect(nx - hw * 0.08, cy + oy - nh * 0.2, hw * 0.1, nh * 0.4);
        drawThrusterGlow(nx + nw * 0.95, cy + oy, Math.min(hw, hh) * 0.09);
    };

    drawNacelle(-hh * 0.55);
    drawNacelle(hh * 0.55);

    // 파일론 (직선)
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = Math.max(1.5, hw * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.15, cy - hh * 0.1);
    ctx.lineTo(cx + hw * 0.15, cy - hh * 0.45);
    ctx.moveTo(cx - hw * 0.15, cy + hh * 0.1);
    ctx.lineTo(cx + hw * 0.15, cy + hh * 0.45);
    ctx.stroke();

    // 중앙 스파 (각진 바)
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.fillRect(cx - hw * 0.45, cy - hh * 0.1, hw * 1.05, hh * 0.28);
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.fillRect(cx - hw * 0.45, cy - hh * 0.14, hw * 1.0, hh * 0.22);
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.fillRect(cx - hw * 0.4, cy - hh * 0.14, hw * 0.9, hh * 0.07);

    // 전방 쐐기 콕핏
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx - hw * 0.35, cy - hh * 0.35);
    ctx.lineTo(cx - hw * 0.35, cy + hh * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.95, cy);
    ctx.lineTo(cx - hw * 0.38, cy - hh * 0.28);
    ctx.lineTo(cx - hw * 0.38, cy + hh * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.95, cy);
    ctx.lineTo(cx - hw * 0.5, cy - hh * 0.22);
    ctx.lineTo(cx - hw * 0.45, cy - hh * 0.05);
    ctx.closePath();
    ctx.fill();

    drawShipCockpit(cx - hw * 0.55, cy, Math.min(hw, hh) * 0.12);

    ctx.restore();
}

function drawArquitens(cx, cy, w, h, color = '#ff8800') {
    // Arquitens: 카이트형 쐐기 + 전방 갈라진 스파 + T형 브리지 + 3엔진
    const hw = w / 2;
    const hh = h / 2;
    const hex = color.startsWith('#') ? color : '#ff8800';
    const tipX = cx - hw;
    const sternX = cx + hw * 0.75;

    ctx.save();

    // 3엔진 글로우
    drawThrusterGlow(sternX, cy - hh * 0.28, Math.min(hw, hh) * 0.08);
    drawThrusterGlow(sternX + hw * 0.05, cy, Math.min(hw, hh) * 0.1);
    drawThrusterGlow(sternX, cy + hh * 0.28, Math.min(hw, hh) * 0.08);

    // 하단 그림자 면
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.beginPath();
    ctx.moveTo(tipX + hw * 0.15, cy + hh * 0.08);
    ctx.lineTo(sternX, cy + hh * 0.55);
    ctx.lineTo(sternX, cy + hh * 0.1);
    ctx.lineTo(cx - hw * 0.2, cy + hh * 0.05);
    ctx.closePath();
    ctx.fill();

    // 본체 카이트 (직선)
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(tipX + hw * 0.28, cy);           // 갈라진 함수 사이
    ctx.lineTo(cx - hw * 0.15, cy - hh * 0.22);
    ctx.lineTo(sternX, cy - hh * 0.5);
    ctx.lineTo(sternX, cy + hh * 0.5);
    ctx.lineTo(cx - hw * 0.15, cy + hh * 0.22);
    ctx.closePath();
    ctx.fill();

    // 전방 이중 스파 (cleaved bow)
    ctx.fillStyle = shipShade(hex, 'mid');
    ctx.beginPath();
    ctx.moveTo(tipX, cy - hh * 0.18);
    ctx.lineTo(cx - hw * 0.2, cy - hh * 0.28);
    ctx.lineTo(cx - hw * 0.2, cy - hh * 0.08);
    ctx.lineTo(tipX + hw * 0.12, cy - hh * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tipX, cy + hh * 0.18);
    ctx.lineTo(cx - hw * 0.2, cy + hh * 0.28);
    ctx.lineTo(cx - hw * 0.2, cy + hh * 0.08);
    ctx.lineTo(tipX + hw * 0.12, cy + hh * 0.05);
    ctx.closePath();
    ctx.fill();

    // 상단 하이라이트
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.moveTo(tipX + hw * 0.28, cy);
    ctx.lineTo(cx - hw * 0.15, cy - hh * 0.22);
    ctx.lineTo(sternX - hw * 0.1, cy - hh * 0.4);
    ctx.lineTo(sternX - hw * 0.1, cy - hh * 0.12);
    ctx.lineTo(cx - hw * 0.05, cy);
    ctx.closePath();
    ctx.fill();

    // 스파 하이라이트
    ctx.fillStyle = shipShade(hex, 'highlight');
    ctx.beginPath();
    ctx.moveTo(tipX, cy - hh * 0.18);
    ctx.lineTo(cx - hw * 0.2, cy - hh * 0.28);
    ctx.lineTo(cx - hw * 0.2, cy - hh * 0.18);
    ctx.lineTo(tipX + hw * 0.1, cy - hh * 0.1);
    ctx.closePath();
    ctx.fill();

    // 패널 라인
    ctx.strokeStyle = shipShade(hex, 'deep');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.05, cy);
    ctx.lineTo(sternX - hw * 0.15, cy);
    ctx.moveTo(cx - hw * 0.1, cy - hh * 0.15);
    ctx.lineTo(cx - hw * 0.1, cy + hh * 0.15);
    ctx.stroke();

    // T형 브리지
    const bx = cx + hw * 0.15;
    ctx.fillStyle = shipShade(hex, 'deep');
    ctx.fillRect(bx, cy - hh * 0.12, hw * 0.45, hh * 0.24);
    ctx.fillRect(bx + hw * 0.12, cy - hh * 0.28, hw * 0.22, hh * 0.56);

    // 포탑 (작은 각진 박스)
    ctx.fillStyle = shipShade(hex, 'shadow');
    ctx.fillRect(bx - hw * 0.08, cy - hh * 0.32, hw * 0.12, hh * 0.12);
    ctx.fillRect(bx - hw * 0.08, cy + hh * 0.2, hw * 0.12, hh * 0.12);

    ctx.fillStyle = '#dff8ff';
    ctx.fillRect(cx - hw * 0.05, cy - hh * 0.05, hw * 0.1, hh * 0.1);

    ctx.restore();
}

function drawEnemyShip(e) {
    const cx = e.x;
    const cy = e.y;
    const w = e.width;
    const h = e.height;

    if (e.enemyType === 1) {
        drawTieFighter(cx, cy, w, h, '#00ff00');
    } else if (e.enemyType === 2) {
        drawYwing(cx, cy, w, h, '#ffdd00');
    } else if (e.enemyType === 3) {
        drawArquitens(cx, cy, w, h, '#ff8800');
    } else if (e.enemyType === 'line') {
        drawStarDestroyer(cx, cy, w, h, '#ee2222');
    }
}

// 미진입(무적) 적 테두리 형광 네온 방어막. 함선 path는 건드리지 않고 타원 stroke만 그린다.
function drawEnemyInvulnShield(e) {
    const alpha = e.shieldAlpha;
    if (!(alpha > 0)) return;

    const pad = 6;
    const rx = e.width / 2 + pad;
    const ry = e.height / 2 + pad;
    // 무적 중(알파≈1)만 약한 밝기 펄스. fade 중에는 알파만 감소.
    const pulse = alpha >= 0.99
        ? 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(Date.now() * 0.01))
        : 1;

    ctx.save();
    ctx.globalAlpha = alpha * pulse;
    ctx.lineJoin = 'round';

    // bloom
    ctx.shadowColor = 'rgba(255, 61, 242, 0.95)';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(255, 61, 242, 0.35)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // mid neon
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255, 140, 250, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // core
    ctx.shadowBlur = 2;
    ctx.strokeStyle = '#ffe6ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.fillRect(s.x, s.y, s.size, s.size);
    });

    if (gameState !== 'GAME_OVER' && energyShield > 0) {
        drawEnergyShieldBubble();

        if (player.invincibleTimer <= 0 || Math.floor(player.invincibleTimer * 10) % 2 === 0) {
            drawFalcon(
                player.x + player.width / 2,
                player.y,
                player.width,
                player.height,
                '#c8c8c8'
            );
        }
    }

    enemies.forEach(e => {
        if (e.enemyType === 'line') {
            if (e.laserState === 'warning') {
                let ax = e.x - e.width / 2;
                let ay = e.y;
                let bx = e.laserTargetX;
                let by = e.laserTargetY;
                let progress = 1.0 - (e.laserTimer / LASER_WARNING_DURATION);

                ctx.save();
                ctx.strokeStyle = `rgba(255, 0, 0, ${progress * 0.8 + 0.2})`;
                ctx.lineWidth = 1 + progress * 3;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.restore();
            } else if (e.laserState === 'firing') {
                let ax = e.x - e.width / 2;
                let ay = e.y;
                let bx = e.laserTargetX;
                let by = e.laserTargetY;
                let dist = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));

                let duration = 0.75;
                let elapsed = duration - e.laserTimer;
                let growDuration = 0.15;
                let currentLength = elapsed < growDuration ? (elapsed / growDuration) * dist : dist;

                let endX = dist > 0 ? ax + (bx - ax) * (currentLength / dist) : ax;
                let endY = dist > 0 ? ay + (by - ay) * (currentLength / dist) : ay;

                let alpha = 1.0;
                if (elapsed >= 0.40) {
                    alpha = Math.max(0, 1.0 - (elapsed - 0.40) / 0.35);
                }

                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.shadowColor = 'rgba(255, 100, 0, 0.9)';
                ctx.shadowBlur = 15;

                let grad = ctx.createLinearGradient(ax, ay, endX, endY);
                grad.addColorStop(0, "rgba(255, 68, 0, 1)");
                grad.addColorStop(1, "rgba(255, 170, 0, 1)");

                ctx.strokeStyle = grad;
                ctx.lineWidth = 8;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(endX, endY);
                ctx.stroke();

                ctx.shadowBlur = 0;
                ctx.strokeStyle = '#fffae6';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(endX, endY);
                ctx.stroke();

                ctx.restore();
            }
        }
    });

    enemies.forEach(e => {
        drawEnemyShip(e);
        drawEnemyInvulnShield(e);

        if (e.word !== "") {
            ctx.fillStyle = '#fff';
            ctx.font = `${ENEMY_WORD_FONT_SIZE}px "Noto Sans KR"`;
            ctx.textAlign = 'center';
            ctx.fillText(e.word, e.x, e.y - 20);
        }
    });

    asteroids.forEach(a => drawAsteroid(a));

    lasers.forEach(l => {
        let alpha = 1.0;
        if (l.timer < 0) {
            alpha = Math.max(0, 1.0 - (Math.abs(l.timer) / 0.5));
        }
        ctx.globalAlpha = alpha;

        let grad = ctx.createLinearGradient(l.startX, l.startY, l.endX, l.endY);
        grad.addColorStop(0, "rgba(0, 50, 255, 1)");
        grad.addColorStop(1, "rgba(0, 255, 255, 1)");

        ctx.lineWidth = 6;
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(l.startX, l.startY);
        ctx.lineTo(l.endX, l.endY);
        if (l.deflected) {
            ctx.lineTo(l.bounceX, l.bounceY);
        }
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#e6ffff';
        ctx.stroke();

        ctx.globalAlpha = 1.0;
    });
    ctx.lineWidth = 1;

    missiles.forEach(m => {
        if (m.delay <= 0) {
            if (m.shape === 'circle') {
                ctx.fillStyle = '#ff9900';
                ctx.beginPath();
                ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.save();
                ctx.translate(m.x, m.y);
                let angle = Math.atan2(m.dirY, m.dirX);
                ctx.rotate(angle);
                if (m.shape === 'triangle') {
                    ctx.fillStyle = '#ff9900';
                    ctx.beginPath();
                    ctx.moveTo(6, 0);
                    ctx.lineTo(-6, -4);
                    ctx.lineTo(-6, 4);
                    ctx.fill();
                } else if (m.shape === 'line') {
                    ctx.fillStyle = '#00ff00';
                    ctx.fillRect(-m.currentLength, -2, m.currentLength, 4);
                }
                ctx.restore();
            }
        }
    });

    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1.0;
}

function handleChallengeClear() {
    gameState = 'CHALLENGE_CLEAR';
    clearMissileWarning(false);
    enemies = [];
    missiles = [];
    lasers = [];
    asteroids = [];
    fireQueue = [];
    fireQueueDelay = 0;

    let challengePoints = challengeEnemiesDestroyed * 100 + challengeBeamFires * 1000;

    document.getElementById('clear-ships').textContent = challengeEnemiesDestroyed;
    document.getElementById('clear-beams').textContent = challengeBeamFires;
    document.getElementById('clear-mission-points').textContent = challengePoints;

    modalChallengeClear.classList.remove('hidden');
}

function showBreakthrough() {
    enemies = [];
    missiles = [];
    lasers = [];
    asteroids = [];
    fireQueue = [];
    fireQueueDelay = 0;
    showEndScreen('Breakthrough!');
}

function showGameOver() {
    asteroids = [];
    showEndScreen('Mission Failed.');
}

function rankKpm(entry) {
    // 신규: kpm(분당 타수). 예전 keystrokes(누적 타수) 필드는 무시한다.
    const n = Number(entry && entry.kpm);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function buildRankScoreEl(entry) {
    const scoreEl = document.createElement('span');
    scoreEl.className = 'rank-score';

    const pointsEl = document.createElement('span');
    pointsEl.className = 'rank-score-points';
    pointsEl.textContent = String(entry.score);
    scoreEl.appendChild(pointsEl);

    const kpm = rankKpm(entry);
    if (kpm === null) {
        return scoreEl;
    }

    const dotEl = document.createElement('span');
    dotEl.className = 'rank-score-dot';
    dotEl.textContent = '.';
    const keysEl = document.createElement('span');
    keysEl.className = 'rank-score-keys';
    keysEl.textContent = String(kpm);
    scoreEl.appendChild(dotEl);
    scoreEl.appendChild(keysEl);
    return scoreEl;
}

function showEndScreen(title) {
    gameState = 'GAME_OVER';
    clearMissileWarning(false);
    document.getElementById('end-screen-title').textContent = title;

    const triggeringSkill = calculateTriggeringSkill();
    let skillBonus = triggeringSkill * currentChallenge;
    let finalMissionPoints = missionPoints + skillBonus;

    document.getElementById('result-mission-points').textContent = missionPoints;
    document.getElementById('result-skill').textContent = triggeringSkill;
    document.getElementById('result-challenge-level').textContent = currentChallenge;
    document.getElementById('final-mission-points').textContent = finalMissionPoints;
    document.getElementById('result-kpm').textContent = triggeringSkill;

    let scores = readJsonFromLocalStorage('starwords_scores', []);
    if (!Array.isArray(scores)) {
        scores = [];
    }
    scores = scores.filter(item =>
        item &&
        typeof item.name === 'string' &&
        Number.isFinite(Number(item.score))
    );
    // 타자수: Keys/Min과 동일한 분당 타수(triggeringSkill). 구기록의 keystrokes(누적)는 무시.
    const currentEntry = {
        name: settings.name,
        score: finalMissionPoints,
        kpm: Math.max(0, Math.floor(triggeringSkill)),
        date: new Date().toLocaleDateString()
    };
    scores.push(currentEntry);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 10);
    localStorage.setItem('starwords_scores', JSON.stringify(scores));

    let ul = document.getElementById('scoreboard-list');
    ul.innerHTML = '';
    scores.forEach((s, i) => {
        let li = document.createElement('li');
        const nameEl = document.createElement('span');
        nameEl.className = 'rank-name';
        nameEl.textContent = `${i + 1}. ${s.name}`;
        li.appendChild(nameEl);
        li.appendChild(buildRankScoreEl(s));
        if (s === currentEntry) {
            li.classList.add('current-score');
        }
        ul.appendChild(li);
    });

    modalGameOver.classList.remove('hidden');
}

updateEnergyShield();
updateBeamCharge();
updateMissionPoints();
lastTime = Date.now();
requestAnimationFrame(gameLoop);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.warn('[STAR WORDS] Service Worker 등록 실패', err);
        });
    });
}
