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

buyPropertyButton.addEventListener('click', () => {
    socket.emit('buyProperty');
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

socket.on('reload', () => {
    window.location.reload();
});

// Wenn der Server den Game State schickt
socket.on('gameStateUpdate', (gameState) => {
    console.log('GameState Update erhalten:', gameState);
    updateLobby(gameState);
    if (gameState.gameStarted) {
        updateStatusBar(gameState);
        renderBoard(gameState);
        updateControls(gameState);
    }
});

function updateControls(gameState) {
    const currentPlayer = gameState.players[gameState.turn];
    const isMyTurn = currentPlayer.id === socket.id;

    // Controls nur anzeigen, wenn man dran ist
    if (isMyTurn && gameState.gameStarted) {
        controls.classList.add('show');
    } else {
        controls.classList.remove('show');
    }

    // Buttons nur aktivieren, wenn man dran ist
    const field = gameState.board[currentPlayer.position];
    rollDiceButton.disabled = !isMyTurn || gameState.waitingForAction !== 'ROLL_DICE';
    buyPropertyButton.disabled = !isMyTurn || gameState.waitingForAction !== 'BUY_OR_PASS';
    
    // Bauen nur wenn man genug Geld hat
    const canAffordHouse = field && field.housePrice && currentPlayer.money >= field.housePrice;
    buildHouseButton.disabled = !isMyTurn || gameState.waitingForAction !== 'BUILD_OR_END' || !canAffordHouse;
    
    endTurnButton.disabled = !isMyTurn || (gameState.waitingForAction !== 'END_TURN' && gameState.waitingForAction !== 'BUILD_OR_END');

    // Bau-Info anzeigen
    const buildInfo = document.getElementById('build-info');
    if (isMyTurn && gameState.waitingForAction === 'BUILD_OR_END' && field.type === 'PROPERTY') {
        const modalPrice = document.getElementById('modal-price');
        const modalUpgrade = document.getElementById('modal-upgrade');
        
        if (modalPrice) modalPrice.innerText = `Kosten: ${field.housePrice}€`;
        if (modalUpgrade) modalUpgrade.innerText = `Miet-Upgrade: +${field.rent * 2}€/Haus`;
        
        if (buildInfo) buildInfo.style.display = 'flex';
        
        // NEU: Hauptmenü zwingend ausblenden, damit es keine Klicks klaut!
        controls.classList.remove('show'); 
    } else {
        if (buildInfo) buildInfo.style.display = 'none';
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

function updateStatusBar(gameState) {
    const currentPlayer = gameState.players[gameState.turn];
    const isMyTurn = currentPlayer.id === socket.id;
    
    let actionText = '';
    if (gameState.waitingForAction === 'ROLL_DICE') actionText = 'muss würfeln';
    if (gameState.waitingForAction === 'BUY_OR_PASS') actionText = 'entscheidet über Kauf';
    if (gameState.waitingForAction === 'END_TURN') actionText = 'beendet den Zug';
    if (gameState.waitingForAction === 'BUILD_OR_END') actionText = 'kann bauen oder beenden';

    currentTurnDisplay.innerText = `${currentPlayer.name} ${actionText}`;
    currentTurnDisplay.style.color = isMyTurn ? '#4ade80' : 'white';

    diceDisplay.innerText = `🎲 ${gameState.lastRoll[0]}, ${gameState.lastRoll[1]}`;

    // Spieler-Attribute in die Ecken
    const corners = ['tl', 'tr', 'bl', 'br'];
    gameState.players.forEach((player, index) => {
        const cornerId = `player-${corners[index]}`;
        const cornerEl = document.getElementById(cornerId);
        if (cornerEl) {
            const isCurrent = gameState.turn === index;
            cornerEl.style.border = isCurrent ? '3px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)';
            cornerEl.style.boxShadow = isCurrent ? '0 0 20px rgba(251, 191, 36, 0.4)' : 'none';
            
            cornerEl.innerHTML = `
                <div class="player-name" style="font-family: 'Anton', sans-serif; text-transform: uppercase; font-size: 0.9rem; color: #fbbf24; margin-bottom: 5px;">${player.name}</div>
                <div class="player-money" style="font-weight: 900; font-size: 1.2rem; display: flex; align-items: center; gap: 5px;">
                    <span style="opacity: 0.7; font-size: 0.8rem;">€</span>${player.money}
                </div>
                <div class="player-props" style="font-size: 0.65rem; margin-top: 5px; opacity: 0.8; display: flex; flex-wrap: wrap; gap: 2px;">
                    ${gameState.board.filter(f => f.owner === player.id).map(f => `<div style="width: 8px; height: 8px; background: ${f.color || '#94a3b8'}; border-radius: 2px;"></div>`).join('')}
                </div>
            `;
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
function renderBoard(gameState) {
    const { board, players, turn } = gameState;
    const boardContainer = document.getElementById('board-container');
    
    // Nur Felder entfernen, board-center behalten
    Array.from(boardContainer.children).forEach(child => {
        if (child.className === 'field') boardContainer.removeChild(child);
    });

    board.forEach(field => {
        const f = document.createElement('div');
        f.className = 'field';
        f.setAttribute('data-id', field.id);
        f.setAttribute('data-type', field.type);
        
        // Grid Position berechnen
        const pos = getGridPosition(field.id);
        f.style.gridRow = pos.row;
        f.style.gridColumn = pos.col;

        // Alle Felder sollen zum Spieler schauen (Rotation = 0)
        let rotation = 0;

        let colorBar = '';
        if (field.color) {
            colorBar = `<div class="color-bar" style="background-color: ${field.color}"></div>`;
        }

        let icon = '';
        if (field.type === 'GO') icon = '🏁';
        if (field.type === 'JAIL') icon = '🔒';
        if (field.type === 'FREE_PARKING') icon = '🚗';
        if (field.type === 'GO_TO_JAIL') icon = '👮';
        if (field.type === 'STATION') icon = '🚂';
        if (field.type === 'UTILITY') icon = '💡';
        if (field.type === 'TAX') icon = '💸';
        if (field.type === 'CHANCE') icon = '❓';
        if (field.type === 'COMMUNITY_CHEST') icon = '📦';

        let ownerIndicator = '';
        if (field.owner) {
            const ownerIndex = players.findIndex(p => p.id === field.owner);
            if (ownerIndex !== -1) {
                ownerIndicator = `<div class="owner-indicator token-p${ownerIndex + 1}"></div>`;
            }
        }

        let houseIndicator = '';
        if (field.houses > 0) {
            const icon = field.houses === 3 ? '🏨' : '🏠'.repeat(field.houses);
            houseIndicator = `<div class="house-indicator">${icon}</div>`;
        }

        f.innerHTML = `
            <div class="field-content" style="transform: rotate(${rotation}deg)">
                ${colorBar}
                ${ownerIndicator}
                ${houseIndicator}
                <div class="field-icon" style="font-size: 1.2rem; margin-bottom: 2px;">${icon}</div>
                <div class="field-name">${field.name}</div>
                ${field.price > 0 ? `<div class="field-price">${field.price}€</div>` : ''}
            </div>
        `;

        // Spieler-Tokens auf diesem Feld rendern
        players.forEach((player, index) => {
            if (player.position === field.id) {
                const token = document.createElement('div');
                token.className = `player-token token-p${index + 1}`;
                if (index === turn) token.classList.add('active');
                
                // Versatz für mehrere Spieler auf einem Feld
                token.style.bottom = `${5 + (index * 5)}px`;
                token.style.right = `${5 + (index * 5)}px`;
                f.appendChild(token);
            }
        });

        boardContainer.appendChild(f);
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
