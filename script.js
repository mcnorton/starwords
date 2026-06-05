const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

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

// Data
let wordsList = WORD_DATA_KO.words;
let beamCodes = WORD_DATA_KO.beamCodes;

// Game State
let gameState = 'START'; // START, PLAYING, BEAM_INPUT, CHALLENGE_CLEAR, GAME_OVER
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
    lang: "ko"
};

// Load settings
const savedSettings = readJsonFromLocalStorage('starwords_settings', null);
if (savedSettings && typeof savedSettings === 'object') {
    settings.name = typeof savedSettings.name === 'string' && savedSettings.name.trim()
        ? savedSettings.name.trim()
        : "Player";
    settings.lang = savedSettings.lang === 'en' ? 'en' : 'ko';
}
document.getElementById('setting-name').value = settings.name;
document.getElementById('setting-lang').value = settings.lang;
updateLanguage();

function updateLanguage() {
    if (settings.lang === 'ko') {
        wordsList = WORD_DATA_KO.words;
        beamCodes = WORD_DATA_KO.beamCodes;
    } else {
        wordsList = WORD_DATA_EN.words;
        beamCodes = WORD_DATA_EN.beamCodes;
    }
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
    const hitText = `${word}에 명중하였습니다.`;
    msg1.textContent = hitText;
    hitMessageTimeout = setTimeout(() => {
        hitMessageTimeout = null;
        if (!missileWarningActive && msg1.textContent === hitText) {
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
}

window.addEventListener('resize', resizeCanvasToContainer);
resizeCanvasToContainer();

function isModalOpen() {
    return !modalSettings.classList.contains('hidden') ||
        !modalChallengeClear.classList.contains('hidden') ||
        !modalGameOver.classList.contains('hidden');
}

function isEnterKey(e) {
    return e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13;
}

function proceedChallengeClear() {
    modalChallengeClear.classList.add('hidden');
    nextChallenge();
}

function proceedGameOver() {
    modalGameOver.classList.add('hidden');
    startGame();
}

function pauseGame() {
    if (isPaused) return;
    if (gameState !== 'PLAYING' && gameState !== 'BEAM_INPUT') return;
    if (isModalOpen()) return;

    isPaused = true;
    pauseStartTime = Date.now();
    pauseOverlay.classList.remove('hidden');
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
    typeInput.focus();
}

// Input Handling
const keys = {
    ArrowUp: false,
    ArrowDown: false
};

startOverlay.addEventListener('click', () => {
    if (gameState === 'START') startGame();
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
            startGame();
            return;
        }
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        keys[e.key] = true;
        e.preventDefault();
    }

    if (gameState === 'PLAYING' || gameState === 'BEAM_INPUT') {
        typeInput.focus();
    }
});

window.addEventListener('keyup', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        keys[e.key] = false;
    }
});

typeInput.addEventListener('input', e => {
    if (typeInput.value.length > 0 && !currentTypingStartTime) {
        currentTypingStartTime = Date.now();
    }
    if (typeInput.value.length === 0) {
        currentTypingStartTime = null;
    }
});

typeInput.addEventListener('keydown', e => {
    if (isEnterKey(e)) {
        if (!modalChallengeClear.classList.contains('hidden') ||
            !modalGameOver.classList.contains('hidden') ||
            isPaused) {
            return;
        }

        e.preventDefault();

        if (gameState === 'START') {
            startGame();
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

            if (gameState === 'PLAYING') {
                processTyping(text);
            } else if (gameState === 'BEAM_INPUT') {
                processBeamTyping(text);
            }
        }, 10);
    }
});

document.getElementById('btn-settings').addEventListener('click', () => {
    modalSettings.classList.remove('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const rawName = document.getElementById('setting-name').value;
    const rawLang = document.getElementById('setting-lang').value;

    // 초보자용 설명:
    // 이름이 공백만 들어오면 점수판이 보기 어려워지므로 기본 이름으로 보정합니다.
    settings.name = rawName.trim() || "Player";
    settings.lang = rawLang === 'en' ? 'en' : 'ko';

    document.getElementById('setting-name').value = settings.name;
    document.getElementById('setting-lang').value = settings.lang;
    localStorage.setItem('starwords_settings', JSON.stringify(settings));
    updateLanguage();
    modalSettings.classList.add('hidden');
    typeInput.focus();
});

document.getElementById('btn-next-challenge').addEventListener('click', proceedChallengeClear);

document.getElementById('btn-restart').addEventListener('click', proceedGameOver);

function processTyping(text) {
    let hit = false;
    let targets = [];
    for (let i = 0; i < enemies.length; i++) {
        if (enemies[i].word === text) {
            targets.push(enemies[i]);
        }
    }

    if (targets.length > 0) {
        targets.forEach(enemy => {
            totalTypedChars += text.length;
            destroyEnemy(enemy);
        });
        hit = true;
        showHitMessage(targets[0].word);
        showConsoleMsg2("새로운 목표물 설정하십시오.");
    }

    if (!hit) {
        clearHitMessageTimeout();
        failedChars += text.length;
        beamCharge = Math.max(0, beamCharge - 10);
        updateBeamCharge();
        msg1.textContent = "목표를 찾을 수 없습니다.";
        showConsoleMsg2("다시 확인하십시오.");
    } else {
        beamCharge = Math.min(100, beamCharge + 10);
        updateBeamCharge();
    }

    if (beamCharge === 100 && gameState === 'PLAYING') {
        triggerBeamMode();
    }
}

function processBeamTyping(text) {
    if (text === beamTargetCode) {
        totalTypedChars += text.length;
        fireSuperPowerBeam();
    } else {
        let hit = false;
        let targets = [];
        for (let i = 0; i < enemies.length; i++) {
            if (enemies[i].word === text) {
                targets.push(enemies[i]);
            }
        }

        if (targets.length > 0) {
            targets.forEach(enemy => {
                totalTypedChars += text.length;
                destroyEnemy(enemy);
            });
            hit = true;
        }

        if (!hit) {
            failedChars += text.length;
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

    let targets = [...enemies];
    targets.forEach(e => destroyEnemy(e));

    gameState = 'PLAYING';
    msg1.textContent = "SUPER POWER BEAM 발사! 냉각 및 재충전을 시작합니다.";
    showConsoleMsg2("새로운 목표물을 설정하십시오.");
}

function startGame() {
    resetGame();
    startOverlay.classList.add('hidden');
    startTime = Date.now();
    gameState = 'PLAYING';
    typeInput.focus();
    spawnEnemies();
}

function nextChallenge() {
    currentChallenge++;
    if (currentChallenge > maxChallenge) {
        showGameOver();
        return;
    }
    challengeEnemiesDestroyed = 0;
    challengeBeamFires = 0;
    energyShield = 100;
    updateEnergyShield();
    uiChallenge.textContent = currentChallenge;
    enemies = [];
    missiles = [];
    lasers = [];
    particles = [];
    spawnEnemies();

    if (beamCharge === 100) {
        triggerBeamMode(true);
    } else {
        gameState = 'PLAYING';
        msg1.textContent = `다수의 적대적 함선이 포착되었습니다. CHALLENGE ${currentChallenge} 작전을 시작합니다!`;
        showConsoleMsg2("모든 대원 정위치. 첫 목표물을 말씀하십시오.");
    }

    typeInput.focus();
    lastTime = Date.now();
    updateMissionPoints();
}

function resetHudScores() {
    uiMissionPoints.textContent = '0';
    uiTriggeringSkill.textContent = '0';
    document.getElementById('result-mission-points').textContent = '0';
    document.getElementById('result-skill').textContent = '0';
    document.getElementById('final-mission-points').textContent = '0';
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
    uiChallenge.textContent = currentChallenge;
    updateEnergyShield();
    updateBeamCharge();
    resetHudScores();
    enemies = [];
    missiles = [];
    lasers = [];
    particles = [];
    clearHitMessageTimeout();
    clearMissileWarning(false);
    isPaused = false;
    pauseStartTime = 0;
    pauseOverlay.classList.add('hidden');
    msg1.textContent = "다수의 적 함선 탐지. 전원 전투태세. 함포가 준비되었습니다.";
    showConsoleMsg2("목표물을 설정하십시오.");
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

        let color;
        if (enemy.enemyType === 1) color = '#00ff00';
        else if (enemy.enemyType === 2) color = 'yellow';
        else if (enemy.enemyType === 3) color = 'orange';
        else color = 'red';
        createExplosion(enemy.x, enemy.y, color, 80);

        enemies.splice(eIndex, 1);
        challengeEnemiesDestroyed++;
        enemiesDestroyed++;
        addMissionPoints(100);

        missiles = missiles.filter(m => m.source !== enemy);

        if (challengeEnemiesDestroyed + enemies.length < currentChallenge * 10) {
            createNewEnemy();
        }
    }
}

function spawnEnemies() {
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

    let speed = Math.random() * 20 + 30;
    let initialY = Math.random() * (canvas.height - 60) + 30;

    let enemyObj = {
        x: canvas.width + Math.random() * 200,
        y: initialY,
        width: eWidth,
        height: eHeight,
        speed: speed,
        word: word,
        enemyType: type
    };

    if (type === 1) {
        enemyObj.waveSpeed = (Math.random() * 2 + 2) / 5;
        enemyObj.waveAmp = (Math.random() * 50 + 50) / 2;

        let minBaseY = 30 + enemyObj.waveAmp;
        let maxBaseY = canvas.height - 30 - enemyObj.waveAmp;
        if (maxBaseY < minBaseY) {
            enemyObj.waveAmp = (canvas.height - 60) / 4;
            minBaseY = 30 + enemyObj.waveAmp;
            maxBaseY = canvas.height - 30 - enemyObj.waveAmp;
        }
        enemyObj.baseY = Math.random() * (maxBaseY - minBaseY) + minBaseY;
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

function getEnergyShieldColor() {
    if (energyShield > 80) return '#00ffcc';
    if (energyShield > 60) return '#adff2f';
    if (energyShield > 40) return '#ffff00';
    if (energyShield > 20) return '#ffa500';
    return '#ff3366';
}

function updateEnergyShield() {
    energyShield = Math.max(0, Math.min(100, Math.round(energyShield)));
    uiEnergyShield.style.width = energyShield + '%';
    uiEnergyShield.style.background = getEnergyShieldColor();
    uiEnergyShieldValue.textContent = energyShield;
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

    ctx.globalAlpha = alpha + 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, radiusX);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.6, color);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = alpha + 0.3;
    ctx.lineWidth = 1;
    const segments = 8;
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const innerR = Math.min(radiusX, radiusY) - 5;
        const outerR = Math.min(radiusX, radiusY);
        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR * (radiusY / radiusX);
        const x2 = cx + Math.cos(angle) * outerR;
        const y2 = cy + Math.sin(angle) * outerR * (radiusY / radiusX);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    ctx.globalAlpha = alpha + 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, radiusX - 2, radiusY - 2, 0, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.stroke();

    ctx.restore();
}

function calculateTriggeringSkill() {
    let currentSessionTime = 0;
    if (currentTypingStartTime) {
        currentSessionTime = (Date.now() - currentTypingStartTime) / 1000;
    }

    let totalSeconds = totalTypingTime + currentSessionTime;

    if (totalSeconds <= 0) {
        uiTriggeringSkill.textContent = 0;
        return 0;
    }

    let effectiveChars = totalTypedChars - failedChars;
    let skill = Math.max(0, Math.floor((effectiveChars / totalSeconds) * 60));
    uiTriggeringSkill.textContent = skill;
    return skill;
}

function gameLoop() {
    if (isPaused) {
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
        update(dt);

        if (challengeEnemiesDestroyed >= currentChallenge * 10) {
            handleChallengeClear();
        } else if (energyShield <= 0) {
            showGameOver();
        }
    }

    draw();

    requestAnimationFrame(gameLoop);
}

function update(dt) {
    calculateTriggeringSkill();

    if (player.invincibleTimer > 0) {
        player.invincibleTimer -= dt;
    }

    if (keys.ArrowUp) player.y -= player.speed * dt;
    if (keys.ArrowDown) player.y += player.speed * dt;

    if (player.y < 20) player.y = 20;
    if (player.y > canvas.height - 20) player.y = canvas.height - 20;

    for (let i = enemies.length - 1; i >= 0; i--) {
        let e = enemies[i];

        if (e.enemyType === 'line') {
            if (e.laserState === 'moving') {
                e.x -= e.speed * dt;
                if (e.x <= canvas.width - e.width / 2) {
                    e.laserTimer -= dt;
                    if (e.laserTimer <= 0) {
                        e.laserState = 'warning';
                        e.laserTimer = 1.5;
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
                    e.speed = e.savedSpeed || (Math.random() * 20 + 30);
                }
            } else if (e.laserState === 'cooldown') {
                e.x -= e.speed * dt;
                e.laserTimer -= dt;
                if (e.laserTimer <= 0) {
                    e.laserState = 'warning';
                    e.laserTimer = 1.5;
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
                e.x = canvas.width + 50;
                e.y = Math.random() * (canvas.height - 60) + 30;
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
                e.x = canvas.width + 50;
                if (e.enemyType === 1) {
                    let minBaseY = 30 + e.waveAmp;
                    let maxBaseY = canvas.height - 30 - e.waveAmp;
                    if (maxBaseY < minBaseY) {
                        e.waveAmp = (canvas.height - 60) / 4;
                        minBaseY = 30 + e.waveAmp;
                        maxBaseY = canvas.height - 30 - e.waveAmp;
                    }
                    e.baseY = Math.random() * (maxBaseY - minBaseY) + minBaseY;
                    e.waveTimer = Math.random() * Math.PI * 2;
                } else {
                    e.y = Math.random() * (canvas.height - 60) + 30;
                }
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
            let growSpeed = 600;
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
            speed: 150,
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

function drawFalcon(cx, cy, w, h, color = '#00ffcc') {
    const hw = w / 2;
    const hh = h / 2;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx - hw * 0.2, cy, hw * 0.5, hh * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.1, cy - hh * 0.25);
    ctx.lineTo(cx + hw * 0.95, cy - hh * 0.12);
    ctx.lineTo(cx + hw * 0.85, cy - hh * 0.35);
    ctx.lineTo(cx + hw * 0.15, cy - hh * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.1, cy + hh * 0.25);
    ctx.lineTo(cx + hw * 0.95, cy + hh * 0.12);
    ctx.lineTo(cx + hw * 0.85, cy + hh * 0.35);
    ctx.lineTo(cx + hw * 0.15, cy + hh * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkenColor(color, 40);
    ctx.beginPath();
    ctx.ellipse(cx - hw * 0.55, cy, hw * 0.18, hh * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = lightenColor(color, 50);
    ctx.beginPath();
    ctx.ellipse(cx - hw * 0.05, cy - hh * 0.55, hw * 0.12, hh * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = lightenColor(color, 80);
    ctx.beginPath();
    ctx.arc(cx - hw * 0.65, cy, hw * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - hw * 0.72, cy - hh * 0.15, hw * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - hw * 0.72, cy + hh * 0.15, hw * 0.04, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = darkenColor(color, 60);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.45, cy - hh * 0.5);
    ctx.lineTo(cx + hw * 0.3, cy - hh * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.45, cy + hh * 0.5);
    ctx.lineTo(cx + hw * 0.3, cy + hh * 0.35);
    ctx.stroke();

    ctx.restore();
}

function drawStarDestroyer(cx, cy, w, h, color = 'red') {
    const hw = w / 2;
    const hh = h / 2;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx + hw * 0.85, cy - hh);
    ctx.lineTo(cx + hw * 0.85, cy + hh);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkenColor('#cc0000', 30);
    ctx.fillRect(cx + hw * 0.55, cy - hh * 0.35, hw * 0.3, hh * 0.7);

    ctx.fillStyle = darkenColor('#cc0000', 50);
    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.7, cy - hh * 0.2);
    ctx.lineTo(cx + hw * 0.85, cy - hh * 0.15);
    ctx.lineTo(cx + hw * 0.85, cy + hh * 0.15);
    ctx.lineTo(cx + hw * 0.7, cy + hh * 0.2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = darkenColor('#cc0000', 20);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
        const t = 0.2 + i * 0.18;
        const x = cx - hw + (cx + hw * 0.85 - (cx - hw)) * t;
        const halfW = hh * (0.15 + t * 0.85);
        ctx.beginPath();
        ctx.moveTo(x, cy - halfW);
        ctx.lineTo(x, cy + halfW);
        ctx.stroke();
    }

    ctx.restore();
}

function drawTieFighter(cx, cy, w, h, color = '#00ff00') {
    const hw = w / 2;
    const hh = h / 2;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(angle) * hw * 0.85;
        const py = cy - hh * 0.75 + Math.sin(angle) * hh * 0.35;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + Math.cos(angle) * hw * 0.85;
        const py = cy + hh * 0.75 + Math.sin(angle) * hh * 0.35;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkenColor(color, 50);
    ctx.beginPath();
    ctx.arc(cx, cy, hw * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = darkenColor(color, 80);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.15, cy);
    ctx.lineTo(cx + hw * 0.15, cy);
    ctx.stroke();

    ctx.fillStyle = lightenColor(color, 40);
    ctx.beginPath();
    ctx.arc(cx - hw * 0.08, cy, hw * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = darkenColor(color, 30);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh * 0.4);
    ctx.lineTo(cx, cy - hh * 0.75);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + hh * 0.4);
    ctx.lineTo(cx, cy + hh * 0.75);
    ctx.stroke();

    ctx.restore();
}

function drawYwing(cx, cy, w, h, color = 'yellow') {
    const hw = w / 2;
    const hh = h / 2;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx - hw * 0.55, cy, hw * 0.2, hh * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillRect(cx - hw * 0.4, cy - hh * 0.08, hw * 0.75, hh * 0.16);

    ctx.beginPath();
    ctx.ellipse(cx + hw * 0.35, cy - hh * 0.55, hw * 0.12, hh * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + hw * 0.35, cy + hh * 0.55, hw * 0.12, hh * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = darkenColor('#cccc00', 40);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.15, cy - hh * 0.1);
    ctx.lineTo(cx + hw * 0.25, cy - hh * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.15, cy + hh * 0.1);
    ctx.lineTo(cx + hw * 0.25, cy + hh * 0.45);
    ctx.stroke();

    ctx.fillStyle = darkenColor('#cccc00', 30);
    ctx.beginPath();
    ctx.arc(cx + hw * 0.35, cy - hh * 0.55, hw * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + hw * 0.35, cy + hh * 0.55, hw * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = lightenColor('#cccc00', 30);
    ctx.beginPath();
    ctx.arc(cx - hw * 0.1, cy, hw * 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawArquitens(cx, cy, w, h, color = 'orange') {
    const hw = w / 2;
    const hh = h / 2;

    ctx.save();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy);
    ctx.lineTo(cx + hw * 0.7, cy - hh * 0.55);
    ctx.lineTo(cx + hw * 0.7, cy + hh * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = darkenColor('#cc7700', 30);
    ctx.fillRect(cx + hw * 0.35, cy - hh * 0.25, hw * 0.25, hh * 0.5);

    ctx.fillStyle = darkenColor('#cc7700', 50);
    ctx.beginPath();
    ctx.moveTo(cx + hw * 0.5, cy - hh * 0.15);
    ctx.lineTo(cx + hw * 0.7, cy - hh * 0.1);
    ctx.lineTo(cx + hw * 0.7, cy + hh * 0.1);
    ctx.lineTo(cx + hw * 0.5, cy + hh * 0.15);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = darkenColor('#cc7700', 20);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - hw * 0.5, cy);
    ctx.lineTo(cx + hw * 0.5, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh * 0.35);
    ctx.lineTo(cx, cy + hh * 0.35);
    ctx.stroke();

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
        drawYwing(cx, cy, w, h, 'yellow');
    } else if (e.enemyType === 3) {
        drawArquitens(cx, cy, w, h, 'orange');
    } else if (e.enemyType === 'line') {
        drawStarDestroyer(cx, cy, w, h, 'red');
    }
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
                '#00ffcc'
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
                let progress = 1.0 - (e.laserTimer / 1.5);

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

        if (e.word !== "") {
            ctx.fillStyle = '#fff';
            ctx.font = '14px "Noto Sans KR"';
            ctx.textAlign = 'center';
            ctx.fillText(e.word, e.x, e.y - 20);
        }
    });

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

    let challengePoints = challengeEnemiesDestroyed * 100 + challengeBeamFires * 1000;

    document.getElementById('clear-ships').textContent = challengeEnemiesDestroyed;
    document.getElementById('clear-beams').textContent = challengeBeamFires;
    document.getElementById('clear-mission-points').textContent = challengePoints;

    modalChallengeClear.classList.remove('hidden');
}

function showGameOver() {
    gameState = 'GAME_OVER';
    clearMissileWarning(false);
    const triggeringSkill = calculateTriggeringSkill();
    let skillBonus = triggeringSkill * currentChallenge;
    let finalMissionPoints = missionPoints + skillBonus;

    document.getElementById('result-mission-points').textContent = missionPoints;
    document.getElementById('result-skill').textContent = triggeringSkill;
    document.getElementById('result-challenge-level').textContent = currentChallenge;
    document.getElementById('final-mission-points').textContent = finalMissionPoints;

    if (energyShield <= 0) {
        createHugeExplosion(player.x + player.width / 2, player.y, '#00ffcc');
    }

    let scores = readJsonFromLocalStorage('starwords_scores', []);
    if (!Array.isArray(scores)) {
        scores = [];
    }
    scores = scores.filter(item =>
        item &&
        typeof item.name === 'string' &&
        Number.isFinite(Number(item.score))
    );
    const currentEntry = { name: settings.name, score: finalMissionPoints, date: new Date().toLocaleDateString() };
    scores.push(currentEntry);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 10);
    localStorage.setItem('starwords_scores', JSON.stringify(scores));

    let ul = document.getElementById('scoreboard-list');
    ul.innerHTML = '';
    scores.forEach((s, i) => {
        let li = document.createElement('li');
        li.textContent = `${i + 1}. ${s.name} - ${s.score}`;
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
