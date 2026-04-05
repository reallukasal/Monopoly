/**
 * Monopoly Multiplayer - Client Logik
 * Vanilla JavaScript, HTML5, CSS3
 */

// Verbindung zum Socket-Server herstellen
const socket = io();
window.socket = socket; // Global verfügbar machen für inline onclick

// UI Elemente
const lobbyStatus = document.getElementById('lobby-status');
const playerList = document.getElementById('player-list');
const gameBoard = document.getElementById('game-board');
const controls = document.getElementById('controls');
const lobbyControls = document.getElementById('lobby-controls');
const fillAIButton = document.getElementById('fill-ai');
const resetGameButton = document.getElementById('reset-game');
const currentTurnDisplay = document.getElementById('current-turn');
const diceDisplay = document.getElementById('dice-display');

const rollDiceButton = document.getElementById('roll-dice');
const buyPropertyButton = document.getElementById('buy-property');
const buildHouseButton = document.getElementById('build-house');
const endTurnButton = document.getElementById('end-turn');
const gameLog = document.getElementById('game-log');

const menuDefault = document.getElementById('menu-default');
const menuBuild = document.getElementById('menu-build');
const menuCard = document.getElementById('menu-card');
const menuBuyout = document.getElementById('menu-buyout');
const menuCrypto = document.getElementById('menu-crypto');
const menuDebt = document.getElementById('menu-debt');

const cryptoMarketBtn = document.getElementById('crypto-market-btn');
const cryptoBtnPrice = document.getElementById('crypto-btn-price');
const cryptoCurrentPrice = document.getElementById('crypto-current-price');
const cryptoUserCoins = document.getElementById('crypto-user-coins');
const cryptoUserCash = document.getElementById('crypto-user-cash');
const cryptoAmountInput = document.getElementById('crypto-amount-input');
const cryptoAmountMinus = document.getElementById('crypto-amount-minus');
const cryptoAmountPlus = document.getElementById('crypto-amount-plus');
const cryptoBuyBtn = document.getElementById('crypto-buy-btn');
const cryptoSellBtn = document.getElementById('crypto-sell-btn');
const cryptoCloseBtn = document.getElementById('crypto-close-btn');
const cryptoChartCanvas = document.getElementById('crypto-chart');

let cryptoChart = null;

const buyoutCityName = document.getElementById('buyout-city-name');
const buyoutHouseIcon = document.getElementById('buyout-house-icon');
const buyoutPriceDisplay = document.getElementById('buyout-price');
const buyoutConfirm = document.getElementById('buyout-confirm');
const buyoutCancel = document.getElementById('buyout-cancel');

const cardDisplay = document.getElementById('card-display');
const cardType = document.getElementById('card-type');
const cardImage = document.getElementById('card-image');
const cardTitle = document.getElementById('card-title');
const cardText = document.getElementById('card-text');
const cardOk = document.getElementById('card-ok');

const cardImages = {
    'WM': '/assets/eventFootballWM.png',
    'INFLUENCER': '/assets/eventInfluencerHype.png',
    'GENTRIFICATION': '/assets/eventGentrification.png',
    'BUBBLE': '/assets/eventImmobilien.png',
    'CROWDFUNDING': '/assets/communityCrowdfunding.png',
    'NEIGHBORHOOD': '/assets/communityHelp.png',
    'SPEEDING': '/assets/communityBlitzer.png',
    'FLIGHT': '/assets/communityFirstClass.png'
};

// Wenn die Verbindung erfolgreich ist
socket.on('connect', () => {
    console.log(`Verbunden! Socket-ID: ${socket.id}`);
});

// Game Log
socket.on('gameLog', (msg) => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerText = msg;
    gameLog.prepend(entry);
    
    // Limit entries
    if (gameLog.children.length > 10) {
        gameLog.removeChild(gameLog.lastChild);
    }
});

// Event Listener für KI-Button
fillAIButton.addEventListener('click', () => {
    socket.emit('fillWithAI');
});

resetGameButton.addEventListener('click', () => {
    if (confirm('Möchtest du das Spiel wirklich zurücksetzen?')) {
        socket.emit('resetGame');
    }
});

// Game Action Buttons
rollDiceButton.addEventListener('click', () => {
    socket.emit('rollDice');
});

cryptoMarketBtn.addEventListener('click', () => {
    if (menuCrypto.style.display === 'flex') {
        closeCryptoMarket();
    } else {
        openCryptoMarket();
    }
});

cryptoCloseBtn.addEventListener('click', () => {
    closeCryptoMarket();
});

cryptoAmountMinus.addEventListener('click', () => {
    let val = parseInt(cryptoAmountInput.value);
    if (val > 1) cryptoAmountInput.value = val - 1;
});

cryptoAmountPlus.addEventListener('click', () => {
    let val = parseInt(cryptoAmountInput.value);
    const currentPlayer = window.lastGameState.players.find(p => p.id === socket.id);
    if (!currentPlayer) return;
    
    const maxBuy = Math.floor(currentPlayer.money / window.lastGameState.vibeCoinPrice);
    const maxSell = currentPlayer.coins || 0;
    const maxAllowed = Math.max(maxBuy, maxSell, 1);
    
    if (val < maxAllowed) cryptoAmountInput.value = val + 1;
});

cryptoBuyBtn.addEventListener('click', () => {
    const amount = parseInt(cryptoAmountInput.value);
    if (amount > 0) socket.emit('buyCoins', amount);
});

cryptoSellBtn.addEventListener('click', () => {
    const amount = parseInt(cryptoAmountInput.value);
    if (amount > 0) socket.emit('sellCoins', amount);
});

function openCryptoMarket() {
    menuCrypto.style.display = 'flex';
    updateControls(window.lastGameState);
    updateCryptoUI();
}

function closeCryptoMarket() {
    menuCrypto.style.display = 'none';
    updateControls(window.lastGameState);
}

function updateCryptoUI() {
    if (!window.lastGameState) return;
    const gs = window.lastGameState;
    const player = gs.players.find(p => p.id === socket.id);
    if (!player) return;
    
    const priceText = `${gs.vibeCoinPrice}€`;
    cryptoCurrentPrice.innerText = priceText;
    if (cryptoBtnPrice) cryptoBtnPrice.innerText = priceText;
    
    cryptoUserCoins.innerText = `Deine Coins: ${player.coins || 0}`;
    cryptoUserCash.innerText = `Dein Cash: ${player.money}€`;
    
    renderCryptoChart(gs.priceHistory);
}

function renderCryptoChart(history) {
    const ctx = cryptoChartCanvas.getContext('2d');
    const width = cryptoChartCanvas.width = cryptoChartCanvas.offsetWidth;
    const height = cryptoChartCanvas.height = cryptoChartCanvas.offsetHeight;
    
    ctx.clearRect(0, 0, width, height);
    
    if (history.length < 2) return;
    
    const max = Math.max(...history) * 1.1;
    const min = Math.min(...history) * 0.9;
    const range = max - min;
    
    ctx.beginPath();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    
    history.forEach((price, i) => {
        const x = (i / (history.length - 1)) * width;
        const y = height - ((price - min) / range) * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Gradient fill
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
    grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
}

buyPropertyButton.addEventListener('click', () => {
    if (window.lastGameState && window.lastGameState.waitingForAction === 'BUYOUT_OR_PASS') {
        socket.emit('buyoutProperty');
    } else {
        socket.emit('buyProperty');
    }
});

buildHouseButton.addEventListener('click', () => {
    socket.emit('buildHouse');
});

endTurnButton.addEventListener('click', () => {
    socket.emit('endTurn');
});

// Modal Buttons
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel = document.getElementById('modal-cancel');
if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
        socket.emit('buildHouse');
    });
}
if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        socket.emit('endTurn');
    });
}

if (buyoutConfirm) {
    buyoutConfirm.addEventListener('click', () => {
        socket.emit('buyoutProperty');
    });
}

if (buyoutCancel) {
    buyoutCancel.addEventListener('click', () => {
        socket.emit('endTurn');
    });
}

socket.on('reload', () => {
    window.location.reload();
});

// Wenn der Server den Game State schickt
socket.on('gameStateUpdate', (gameState) => {
    console.log('GameState Update erhalten:', gameState);
    window.lastGameState = gameState;
    
    if (menuCrypto && menuCrypto.style.display === 'flex') {
        updateCryptoUI();
    }
    
    updateLobby(gameState);
    if (gameState.gameStarted) {
        updateStatusBar(gameState);
        renderBoard(gameState);
        updateControls(gameState);
    }
});

function updateControls(gameState) {
    if (!gameState) return;
    window.lastGameState = gameState;
    const currentPlayer = gameState.players[gameState.turn];
    const isMyTurn = currentPlayer.id === socket.id;

    if (!menuDefault || !menuBuild || !menuCard || !menuBuyout || !menuDebt || !menuCrypto) return;

    const isCryptoOpen = menuCrypto.style.display === 'flex';
    const field = gameState.board[currentPlayer.position];
    const isCardActive = gameState.lastDrawnCard && dismissedCardId !== gameState.lastDrawnCard.id + gameState.turn;

    // Sichtbarkeit des Haupt-Containers
    if ((gameState.gameStarted && gameState.waitingForAction !== 'GAME_OVER' && (isMyTurn || isCardActive)) || isCryptoOpen) {
        controls.classList.add('show');
    } else {
        controls.classList.remove('show');
        return;
    }

    // Alle Sub-Menüs verstecken
    [menuDefault, menuBuild, menuCard, menuBuyout, menuDebt, menuCrypto].forEach(m => {
        if (m) m.style.display = 'none';
    });

    const menuInfo = document.getElementById('menu-info');
    if (menuInfo) menuInfo.style.display = 'none';

    // Bestimmen, welches Menü angezeigt wird
    if (isCryptoOpen) {
        menuCrypto.style.display = 'flex';
    } else if (isCardActive && (isMyTurn || currentPlayer.isAI)) {
        menuCard.style.display = 'flex';
        const card = gameState.lastDrawnCard;
        cardDisplay.className = card.type === 'CHANCE' ? 'chance-card' : 'community-card';
        cardType.innerText = card.type === 'CHANCE' ? 'EREIGNIS' : 'GEMEINSCHAFT';
        
        if (cardImages[card.id]) {
            cardImage.src = cardImages[card.id];
            cardImage.style.display = 'block';
            const imgContainer = document.getElementById('card-image-container');
            if (imgContainer) {
                imgContainer.innerHTML = '';
                imgContainer.appendChild(cardImage);
            }
            cardTitle.style.display = 'none';
            cardText.style.display = 'none';
            cardType.style.display = 'none';
            cardDisplay.style.background = 'transparent';
            cardDisplay.style.border = 'none';
            cardDisplay.style.boxShadow = 'none';
        } else {
            cardImage.style.display = 'none';
            cardTitle.style.display = 'block';
            cardText.style.display = 'block';
            cardType.style.display = 'block';
            cardTitle.innerText = card.title;
            cardText.innerText = card.text;
            cardDisplay.style.background = '#fef3c7';
            cardDisplay.style.border = '8px solid #fbbf24';
            cardDisplay.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
            const imgMap = {
                'WM': '⚽', 'INFLUENCER': '📱', 'GENTRIFICATION': '🏗️', 'BUBBLE': '📉',
                'CROWDFUNDING': '🚀', 'NEIGHBORHOOD': '🤝', 'SPEEDING': '📸', 'FLIGHT': '✈️'
            };
            const imgContainer = document.getElementById('card-image-container');
            if (imgContainer) imgContainer.innerHTML = `<span style="font-size: 5rem;">${imgMap[card.id] || '❓'}</span>`;
        }
        cardOk.style.display = isMyTurn ? 'block' : 'none';
        cardOk.onclick = () => {
            if (['WM', 'GENTRIFICATION', 'FLIGHT', 'INFLUENCER'].includes(card.id)) {
                dismissedCardId = card.id + gameState.turn;
                updateControls(gameState);
            } else {
                socket.emit('confirmCard');
            }
        };
    } else if (gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT' && isMyTurn) {
        menuDebt.style.display = 'flex';
        const debtAmount = document.getElementById('debt-amount');
        if (debtAmount) debtAmount.innerText = `${gameState.rentOwed}€`;
    } else if (isMyTurn) {
        // Vereinheitlichtes Default Menü
        menuDefault.style.display = 'grid';
        
        // Button Labels und Info-Text
        buyPropertyButton.innerText = 'Kaufen';
        if (gameState.waitingForAction === 'BUYOUT_OR_PASS') {
            buyPropertyButton.innerText = 'Abkaufen';
            if (menuInfo && field) {
                let buyoutMultiplier = 1.5;
                const sameColorFields = gameState.board.filter(b => b.color === field.color && b.color !== "#ccc");
                const isMonopoly = sameColorFields.length > 0 && sameColorFields.every(b => b.owner === field.owner);
                if (field.type === 'PROPERTY' && isMonopoly) buyoutMultiplier = 1.5 * 1.15;
                const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
                menuInfo.innerText = `💸 ${field.name} abkaufen für ${buyoutPrice}€?`;
                menuInfo.style.display = 'block';
            }
        } else if (gameState.waitingForAction === 'BUILD_OR_END') {
            if (menuInfo && field) {
                const hasBothUtilities = currentPlayer.properties.includes(12) && currentPlayer.properties.includes(28);
                const discount = hasBothUtilities ? 0.65 : 1.0;
                const effectiveHousePrice = Math.floor(field.housePrice * discount);
                menuInfo.innerText = `🏠 Haus auf ${field.name} bauen für ${effectiveHousePrice}€?`;
                menuInfo.style.display = 'block';
            }
        } else if (gameState.waitingForAction === 'BUY_OR_PASS') {
            if (menuInfo && field) {
                menuInfo.innerText = `🏙️ ${field.name} kaufen für ${field.price}€?`;
                menuInfo.style.display = 'block';
            }
        } else if (['CHOOSE_WM_CITY', 'CHOOSE_GENTRIFICATION_CITY', 'CHOOSE_FLIGHT_DESTINATION'].includes(gameState.waitingForAction)) {
            if (menuInfo) {
                const msgMap = {
                    'CHOOSE_WM_CITY': '⚽ Wähle eine deiner Städte für die WM!',
                    'CHOOSE_GENTRIFICATION_CITY': '🏗️ Wähle eine Stadt für ein Gratis-Haus!',
                    'CHOOSE_FLIGHT_DESTINATION': '✈️ Wähle ein Ziel für deinen Flug!'
                };
                menuInfo.innerText = msgMap[gameState.waitingForAction];
                menuInfo.style.display = 'block';
            }
        } else if (gameState.waitingForAction === 'END_TURN') {
            if (menuInfo) {
                menuInfo.innerText = '✅ Zug beenden?';
                menuInfo.style.display = 'block';
            }
        }

        // Button Zustände
        rollDiceButton.disabled = gameState.waitingForAction !== 'ROLL_DICE';
        
        const canAffordBuy = field && currentPlayer.money >= field.price;
        const isBuyout = gameState.waitingForAction === 'BUYOUT_OR_PASS';
        let canAffordBuyout = false;
        if (isBuyout && field) {
            let buyoutMultiplier = 1.5;
            const sameColorFields = gameState.board.filter(b => b.color === field.color && b.color !== "#ccc");
            const isMonopoly = sameColorFields.length > 0 && sameColorFields.every(b => b.owner === field.owner);
            if (field.type === 'PROPERTY' && isMonopoly) buyoutMultiplier = 1.5 * 1.15;
            const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
            canAffordBuyout = currentPlayer.money >= buyoutPrice;
        }
        
        buyPropertyButton.disabled = (gameState.waitingForAction !== 'BUY_OR_PASS' && !isBuyout) || (gameState.waitingForAction === 'BUY_OR_PASS' && !canAffordBuy) || (isBuyout && !canAffordBuyout);
        
        const hasBothUtilities = currentPlayer.properties.includes(12) && currentPlayer.properties.includes(28);
        const discount = hasBothUtilities ? 0.65 : 1.0;
        const canAffordHouse = field && field.housePrice && currentPlayer.money >= Math.floor(field.housePrice * discount);
        const canBuildMore = field && field.houses < 3;
        buildHouseButton.disabled = gameState.waitingForAction !== 'BUILD_OR_END' || !canAffordHouse || !canBuildMore;
        
        endTurnButton.disabled = !['END_TURN', 'BUILD_OR_END', 'BUY_OR_PASS', 'BUYOUT_OR_PASS'].includes(gameState.waitingForAction);
    }
}

// Wenn das Spiel startet
socket.on('gameStarted', (gameState) => {
    console.log('Spiel gestartet!', gameState);
    lobbyStatus.innerText = 'Spiel läuft!';
    lobbyControls.style.display = 'none';
    gameBoard.style.display = 'block';
    updateStatusBar(gameState);
    renderBoard(gameState);
    updateControls(gameState);
});

// Globaler State für Geld-Tracking und Würfel-Animation
let previousMoney = {};
let lastRollSeen = [0, 0];
let diceDisplayMode = 'individual'; // 'individual' oder 'sum'
let dismissedCardId = null;

function updateStatusBar(gameState) {
    const currentPlayer = gameState.players[gameState.turn];
    const isMyTurn = currentPlayer.id === socket.id;
    
    // Update crypto button price
    if (cryptoBtnPrice && gameState.vibeCoinPrice) {
        cryptoBtnPrice.innerText = `${gameState.vibeCoinPrice}€`;
    }
    
    let actionText = '';
    if (gameState.waitingForAction === 'ROLL_DICE') actionText = 'muss würfeln';
    if (gameState.waitingForAction === 'BUY_OR_PASS') actionText = 'entscheidet über Kauf';
    if (gameState.waitingForAction === 'END_TURN') actionText = 'beendet den Zug';
    if (gameState.waitingForAction === 'BUILD_OR_END') actionText = 'kann bauen oder beenden';
    if (gameState.waitingForAction === 'CHOOSE_WM_CITY') actionText = 'wählt WM-Stadt';
    if (gameState.waitingForAction === 'CHOOSE_GENTRIFICATION_CITY') actionText = 'wählt Stadt für Gratis-Haus';
    if (gameState.waitingForAction === 'CHOOSE_FLIGHT_DESTINATION') actionText = 'wählt Flugziel';
    if (gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT') actionText = `muss ${gameState.rentOwed}€ Schulden begleichen`;
    if (gameState.waitingForAction === 'GAME_OVER') actionText = 'SPIEL VORBEI!';

    currentTurnDisplay.innerText = gameState.waitingForAction === 'GAME_OVER' ? '🏆 SPIEL VORBEI!' : `${currentPlayer.name} ${actionText}`;
    currentTurnDisplay.style.color = (isMyTurn || gameState.waitingForAction === 'GAME_OVER') ? '#4ade80' : 'white';

    // Würfel-Display Logik
    const r = gameState.lastRoll;
    const isNewRoll = r[0] !== lastRollSeen[0] || r[1] !== lastRollSeen[1];
    
    if (isNewRoll && (r[0] > 0 || r[1] > 0)) {
        lastRollSeen = [...r];
        diceDisplayMode = 'individual';
        diceDisplay.classList.remove('dice-sum-glow');
        diceDisplay.innerText = `🎲 ${r[0]}, ${r[1]}`;
        
        // Nach kurzer Verzögerung die Summe mit Animation zeigen
        setTimeout(() => {
            diceDisplayMode = 'sum';
            diceDisplay.innerText = `🎲 ${r[0] + r[1]}`;
            diceDisplay.classList.add('dice-sum-glow');
        }, 800);
    } else if (r[0] === 0 && r[1] === 0) {
        lastRollSeen = [0, 0];
        diceDisplayMode = 'individual';
        diceDisplay.innerText = `🎲 0, 0`;
        diceDisplay.classList.remove('dice-sum-glow');
    } else {
        // Bestehenden Roll beibehalten
        if (diceDisplayMode === 'sum') {
            diceDisplay.innerText = `🎲 ${r[0] + r[1]}`;
            diceDisplay.classList.add('dice-sum-glow');
        } else {
            diceDisplay.innerText = `🎲 ${r[0]}, ${r[1]}`;
        }
    }

    // Spieler-Attribute in die Ecken
    const corners = ['tl', 'tr', 'bl', 'br'];
    gameState.players.forEach((player, index) => {
        const cornerId = `player-${corners[index]}`;
        const cornerEl = document.getElementById(cornerId);
        if (cornerEl) {
            const isCurrent = gameState.turn === index;
            cornerEl.style.border = isCurrent ? '3px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)';
            cornerEl.style.boxShadow = isCurrent ? '0 0 20px rgba(251, 191, 36, 0.4)' : 'none';
            
            // Geld-Animation Logik
            let moneyClass = '';
            if (previousMoney[player.id] !== undefined) {
                if (player.money > previousMoney[player.id]) {
                    moneyClass = 'money-gain';
                } else if (player.money < previousMoney[player.id]) {
                    moneyClass = 'money-loss';
                }
            }
            previousMoney[player.id] = player.money;

            const portfolioValue = (player.coins || 0) * (gameState.vibeCoinPrice || 0);
            cornerEl.innerHTML = `
                <div class="player-name">${player.name}</div>
                <div class="player-money ${moneyClass}">
                    <span style="opacity: 0.7; font-size: 0.8rem;">€</span>${player.money}
                    ${portfolioValue > 0 ? `<span class="player-coins-small">🪙${portfolioValue}€</span>` : ''}
                </div>
                <div class="player-props">
                    ${gameState.board.filter(f => f.owner === player.id).map(f => `<div style="width: 8px; height: 8px; background: ${f.color || '#94a3b8'}; border-radius: 2px;"></div>`).join('')}
                </div>
            `;
            
            // Animation nach 1.5s entfernen, damit sie beim nächsten Mal wieder triggert
            if (moneyClass) {
                setTimeout(() => {
                    const moneyEl = cornerEl.querySelector('.player-money');
                    if (moneyEl) moneyEl.classList.remove(moneyClass);
                }, 1500);
            }
        }
    });
}

// Lobby-Anzeige aktualisieren
function updateLobby(gameState) {
    lobbyStatus.innerText = `Spieler: ${gameState.players.length}/4`;
    playerList.innerHTML = '';
    gameState.players.forEach(player => {
        const p = document.createElement('p');
        p.innerText = `${player.name} (${player.id === socket.id ? 'Du' : player.id})`;
        playerList.appendChild(p);
    });

    // Button verstecken, wenn voll
    if (gameState.players.length >= 4) {
        lobbyControls.style.display = 'none';
    } else {
        lobbyControls.style.display = 'block';
    }
}

// Spielfeld rendern (11x11 Grid Layout)
// Spielfeld rendern (Smarte DOM-Updates statt Abriss)
function renderBoard(gameState) {
    const { board, players, turn } = gameState;
    const boardContainer = document.getElementById('board-container');
    
    // 1. OPERATION: Prüfen, ob die Felder schon existieren
    const existingFields = boardContainer.querySelectorAll('.field');
    const isInitialized = existingFields.length === 40;

    board.forEach((field, index) => {
        let f;
        
        if (!isInitialized) {
            // PHASE A: Initiales Bauen (nur beim allerersten Aufruf)
            f = document.createElement('div');
            f.className = 'field';
            f.setAttribute('data-id', field.id);
            f.setAttribute('data-type', field.type);
            
            // Grid Position einstellen
            const pos = getGridPosition(field.id);
            f.style.gridRow = pos.row;
            f.style.gridColumn = pos.col;
            
            boardContainer.appendChild(f);
        } else {
            // PHASE B: Smartes Update (Feld aus dem DOM fischen)
            f = existingFields[index];
            
            // Alten Zustand restlos bereinigen (verhindert Glitches)
            f.className = 'field'; 
            f.style.cursor = 'default';
            f.style.boxShadow = 'none';
            f.onclick = null;
        }

        // --- Ab hier: Logik für dynamische Inhalte (Klassen, Klicks, HTML) ---

        // Monopoly Glow Check
        if (field.color && field.owner) {
            const ownerIndex = players.findIndex(p => p.id === field.owner);
            if (ownerIndex !== -1) {
                const sameColorFields = board.filter(b => b.color === field.color);
                const isMonopoly = sameColorFields.every(b => b.owner === field.owner);
                
                if (isMonopoly) {
                    f.classList.add(`monopoly-glow-strong-p${ownerIndex + 1}`);
                } else {
                    f.classList.add(`monopoly-glow-subtle-p${ownerIndex + 1}`);
                }
            }
        }

        // Visual feedback for field selection
        const isChoosingWM = gameState.waitingForAction === 'CHOOSE_WM_CITY';
        const isChoosingGentrification = gameState.waitingForAction === 'CHOOSE_GENTRIFICATION_CITY';
        const isChoosingFlight = gameState.waitingForAction === 'CHOOSE_FLIGHT_DESTINATION';
        const isChoosingSell = gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT';
        const currentPlayerId = gameState.players[gameState.turn]?.id;

        if (isChoosingWM || isChoosingGentrification || isChoosingFlight || isChoosingSell) {
            let selectable = false;
            if (isChoosingWM) {
                selectable = (field.owner === currentPlayerId && field.type === 'PROPERTY');
            } else if (isChoosingGentrification) {
                selectable = (field.owner === currentPlayerId && field.type === 'PROPERTY' && field.houses < 3);
            } else if (isChoosingFlight) {
                selectable = (field.type === 'PROPERTY' || field.type === 'STATION' || field.type === 'UTILITY');
            } else if (isChoosingSell) {
                selectable = (field.owner === socket.id);
            }
            
            if (!selectable) {
                f.classList.add('unselectable');
            }
        }

        // Klick-Logik für interaktive Karten
        if (gameState.waitingForAction === 'CHOOSE_WM_CITY') {
            if (field.owner === socket.id) {
                f.style.cursor = 'pointer';
                f.onclick = () => socket.emit('chooseWMCity', field.id);
                f.style.boxShadow = '0 0 15px #fbbf24';
            }
        } else if (gameState.waitingForAction === 'CHOOSE_GENTRIFICATION_CITY') {
            if (field.owner === socket.id && field.type === 'PROPERTY' && field.houses < 3) {
                f.style.cursor = 'pointer';
                f.onclick = () => socket.emit('chooseGentrificationCity', field.id);
                f.style.boxShadow = '0 0 15px #4ade80';
            }
        } else if (gameState.waitingForAction === 'CHOOSE_FLIGHT_DESTINATION') {
            if (field.type === 'PROPERTY' || field.type === 'STATION' || field.type === 'UTILITY') {
                f.style.cursor = 'pointer';
                f.onclick = () => socket.emit('chooseFlightDestination', field.id);
                f.style.boxShadow = '0 0 15px #3b82f6';
            }
        } else if (gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT') {
            if (field.owner === socket.id) {
                f.style.cursor = 'pointer';
                f.onclick = () => socket.emit('sellProperty', field.id);
                f.style.boxShadow = '0 0 15px #f97316';
            }
        }

        let colorBar = field.color ? `<div class="color-bar" style="background-color: ${field.color}"></div>` : '';

        let iconHTML = '';
        if (field.type === 'GO') iconHTML = '<div class="custom-icon icon-go"></div>';
        if (field.type === 'JAIL') iconHTML = '<div class="custom-icon icon-jail"></div>';
        if (field.type === 'FREE_PARKING') iconHTML = '<div class="custom-icon icon-parking"></div>';
        if (field.type === 'GO_TO_JAIL') iconHTML = '<div class="custom-icon icon-gotojail"></div>';
        if (field.type === 'STATION') iconHTML = '<div class="custom-icon icon-station"></div>';
        if (field.type === 'CHANCE') iconHTML = '<div class="custom-icon icon-chance"></div>';
        if (field.type === 'COMMUNITY_CHEST') iconHTML = '<div class="custom-icon icon-chest"></div>';
        if (field.type === 'UTILITY') iconHTML = '<div class="custom-icon icon-utility"></div>'; 
        if (field.type === 'TAX') iconHTML = '<div class="custom-icon icon-tax"></div>';

        let ownerIndicator = '';
        if (field.owner) {
            const ownerIndex = players.findIndex(p => p.id === field.owner);
            if (ownerIndex !== -1) ownerIndicator = `<div class="owner-indicator token-p${ownerIndex + 1}"></div>`;
        }

        let houseIndicator = '';
        if (field.specialEffect === 'WM') {
            houseIndicator = `<div class="build-container"><div class="isometric-stadium"></div></div>`;
        } else if (field.houses > 0) {
            const ownerIndex = players.findIndex(p => p.id === field.owner);
            const playerNum = ownerIndex !== -1 ? ownerIndex + 1 : 1;
            houseIndicator = `<div class="build-container">`;
            
            if (field.houses >= 3) {
                houseIndicator += `<div class="isometric-hotel hotel-p${playerNum}"></div>`;
            } else {
                const doubleHouses = Math.floor(field.houses / 2);
                const singleHouses = field.houses % 2; 
                for (let i = 0; i < doubleHouses; i++) houseIndicator += `<div class="isometric-houseDouble houseDouble-p${playerNum}"></div>`;
                for (let i = 0; i < singleHouses; i++) houseIndicator += `<div class="isometric-house house-p${playerNum}"></div>`;
            }
            houseIndicator += `</div>`;
        }

        let priceOrRentHTML = '';
        if (field.price > 0) {
            if (gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT' && field.owner === socket.id) {
                const sellPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * 0.75);
                priceOrRentHTML = `<div class="field-sell">VERKAUF: ${sellPrice}€</div>`;
            } else if (field.owner) {
                let currentRent = field.rent || Math.floor(field.price * 0.1);
                if (field.houses === 1) currentRent *= 2;
                if (field.houses === 2) currentRent *= 3;
                if (field.houses >= 3) currentRent *= 5; 
                
                const sameColorFields = gameState.board.filter(b => b.color === field.color && b.color !== "#ccc");
                const isMonopoly = sameColorFields.length > 0 && sameColorFields.every(b => b.owner === field.owner);
                if (field.type === 'PROPERTY' && isMonopoly) currentRent = Math.floor(currentRent * 1.075);
                if (field.specialEffect === 'WM') currentRent *= 3;
                
                priceOrRentHTML = `<div class="field-rent">${currentRent}€</div>`;
            } else {
                priceOrRentHTML = `<div class="field-price">${field.price}€</div>`;
            }
        }

        // InnerHTML wird jetzt nur noch überschrieben, nicht das Element gelöscht
        f.innerHTML = `
            <div class="field-content" style="transform: rotate(0deg)">
                ${colorBar}
                ${ownerIndicator}
                ${houseIndicator}
                ${iconHTML} 
                <div class="field-name">${field.name}</div>
                ${priceOrRentHTML}
            </div>
        `;

        // 2. OPERATION: Token rendern (die alten Token werden durch f.innerHTML = ... oben automatisch gelöscht)
        players.forEach((player, pIndex) => {
            if (player.position === field.id) {
                const token = document.createElement('div');
                token.className = `player-token token-p${pIndex + 1}`;
                if (pIndex === turn) token.classList.add('active');
                
                token.style.bottom = `${5 + (pIndex * 5)}px`;
                token.style.right = `${5 + (pIndex * 5)}px`;
                f.appendChild(token);
            }
        });
    });
}

// Hilfsfunktion für Grid-Positionen (11x11)
function getGridPosition(id) {
    if (id >= 0 && id <= 10) return { row: 11, col: 11 - id }; // Unten (Rechts nach Links)
    if (id >= 11 && id <= 20) return { row: 11 - (id - 10), col: 1 }; // Links (Unten nach Oben)
    if (id >= 21 && id <= 30) return { row: 1, col: 1 + (id - 20) }; // Oben (Links nach Rechts)
    if (id >= 31 && id <= 39) return { row: 1 + (id - 30), col: 11 }; // Rechts (Oben nach Unten)
    return { row: 1, col: 1 };
}

// Fehler-Handling
socket.on('error_message', (msg) => {
    alert(msg);
});
