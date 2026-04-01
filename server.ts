import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = 3000;

// Statische Dateien aus dem "public"-Ordner ausliefern
app.use(express.static(path.join(__dirname, 'public')));

/**
 * SPIEL-STATE
 * Der Server ist die einzige "Source of Truth".
 */
const gameState = {
  players: [], // Array für 4 Spieler: { id, name, position, money, properties, inJail }
  board: [],   // Array mit 40 Feldern
  turn: 0,     // Wer ist dran? (0-3)
  gameStarted: false,
  waitingForAction: 'ROLL_DICE', // 'ROLL_DICE', 'BUY_OR_PASS', 'END_TURN'
  lastRoll: [0, 0]
};

// Initialisierung des Spielfelds (Beispielhaft für Schritt 1)
function initBoard() {
  const board = [];
  const colors = [
    "#955436", "#955436", // Braun: Buenos Aires / Cairo
    "#aae0fa", "#aae0fa", "#aae0fa", // Hellblau: Beijing / Tokyo / Seoul
    "#d93a96", "#d93a96", "#d93a96", // Pink: Rom / Paris / Venedig
    "#f7941d", "#f7941d", "#f7941d", // Orange: Berlin / Wien / Prag
    "#ed1c24", "#ed1c24", "#ed1c24", // Rot: Amsterdam / Madrid / Lissabon
    "#fef200", "#fef200", "#fef200", // Gelb: Moskau / Istanbul / Dubai
    "#1fb25a", "#1fb25a", "#1fb25a", // Grün: London / Sydney / Kapstadt
    "#0072bb", "#0072bb"  // Dunkelblau: New York / San Francisco
  ];
  
  const names = [
    "LOS!", "Buenos Aires", "Gemeinschaft", "Cairo", "Steuern", "London Tube", "Beijing", "Ereignis", "Tokyo", "Seoul",
    "Gefängnis", "Rom", "E-Werk", "Paris", "Venedig", "Gare du Nord", "Berlin", "Gemeinschaft", "Wien", "Prag",
    "Frei Parken", "Amsterdam", "Ereignis", "Madrid", "Lissabon", "Atocha", "Moskau", "Istanbul", "Wasserwerk", "Dubai",
    "Gehe ins Gefängnis", "London", "Sydney", "Gemeinschaft", "Kapstadt", "Grand Central", "Ereignis", "New York", "Zusatzsteuer", "San Francisco"
  ];

  let colorIndex = 0;

  for (let i = 0; i < 40; i++) {
    const name = names[i];
    if (i === 0) board.push({ id: i, type: "GO", name, price: 0 });
    else if (i === 10) board.push({ id: i, type: "JAIL", name, price: 0 });
    else if (i === 20) board.push({ id: i, type: "FREE_PARKING", name, price: 0 });
    else if (i === 30) board.push({ id: i, type: "GO_TO_JAIL", name, price: 0 });
    else if ([2, 17, 33].includes(i)) board.push({ id: i, type: "COMMUNITY_CHEST", name, price: 0 });
    else if ([7, 22, 36].includes(i)) board.push({ id: i, type: "CHANCE", name, price: 0 });
    else if ([5, 15, 25, 35].includes(i)) board.push({ id: i, type: "STATION", name, price: 200 });
    else if ([4, 38].includes(i)) board.push({ id: i, type: "TAX", name, price: 100 });
    else if ([12, 28].includes(i)) board.push({ id: i, type: "UTILITY", name, price: 150 });
    else {
      const price = 60 + (i * 10);
      board.push({ 
        id: i, 
        type: "PROPERTY", 
        name, 
        price, 
        rent: 2 + i, 
        owner: null,
        color: colors[colorIndex++] || "#ccc",
        houses: 0, // 0-2 Häuser, 3 = Hotel
        housePrice: Math.floor(price * 0.5)
      });
    }
  }
  return board;
}

gameState.board = initBoard();

/**
 * GAME LOGIC FUNCTIONS
 */
function handleRoll(player) {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  gameState.lastRoll = [d1, d2];
  const total = d1 + d2;

  const oldPos = player.position;
  player.position = (player.position + total) % 40;

  // Über LOS gehen
  if (player.position < oldPos) {
    player.money += 200;
    io.emit('gameLog', `${player.name} geht über LOS und erhält 200€`);
  }

  io.emit('gameLog', `${player.name} würfelt ${total} und landet auf ${gameState.board[player.position].name}`);
  
  handleLanding(player);
  io.emit('gameStateUpdate', gameState);

  // Wenn KI dran ist
  if (player.isAI) {
    if (gameState.waitingForAction === 'END_TURN') {
      setTimeout(nextTurn, 1500);
    } else if (gameState.waitingForAction === 'BUY_OR_PASS') {
      setTimeout(() => {
        const field = gameState.board[player.position];
        if (player.money >= field.price + 200) {
          player.money -= field.price;
          field.owner = player.id;
          player.properties.push(field.id);
          io.emit('gameLog', `${player.name} (KI) kauft ${field.name} für ${field.price}€`);
          
          // KI baut vielleicht direkt ein Haus
          if (field.type === 'PROPERTY' && player.money >= field.housePrice + 200) {
            player.money -= field.housePrice;
            field.houses = 1;
            io.emit('gameLog', `${player.name} (KI) baut ein Haus auf ${field.name}`);
          }
        }
        nextTurn();
      }, 1500);
    } else if (gameState.waitingForAction === 'BUILD_OR_END') {
      setTimeout(() => {
        const field = gameState.board[player.position];
        // KI baut nur, wenn sie danach noch mindestens 200€ hat
        if (field.type === 'PROPERTY' && field.houses < 3 && player.money >= field.housePrice + 200) {
          player.money -= field.housePrice;
          field.houses++;
          const type = field.houses === 3 ? 'ein Hotel' : `Haus Nr. ${field.houses}`;
          io.emit('gameLog', `${player.name} (KI) baut ${type} auf ${field.name}`);
        }
        nextTurn();
      }, 1500);
    } else {
      // Fallback für alle anderen Zustände
      setTimeout(nextTurn, 1500);
    }
  }
}

function handleLanding(player) {
  const field = gameState.board[player.position];

  if (field.type === 'PROPERTY' || field.type === 'STATION' || field.type === 'UTILITY') {
    if (!field.owner) {
      gameState.waitingForAction = 'BUY_OR_PASS';
    } else if (field.owner !== player.id) {
      const owner = gameState.players.find(p => p.id === field.owner);
      if (owner) {
        let rent = field.rent || Math.floor(field.price * 0.1);
        
        // Miete erhöhen durch Häuser
        if (field.houses === 1) rent *= 3;
        if (field.houses === 2) rent *= 5;
        if (field.houses === 3) rent *= 10; // Hotel

        player.money -= rent;
        owner.money += rent;
        io.emit('gameLog', `${player.name} zahlt ${rent}€ Miete an ${owner.name}`);
      }
      gameState.waitingForAction = 'END_TURN';
    } else {
      // Eigene Straße: Man kann bauen, wenn es eine PROPERTY ist
      if (field.type === 'PROPERTY' && field.houses < 3) {
        gameState.waitingForAction = 'BUILD_OR_END';
      } else {
        gameState.waitingForAction = 'END_TURN';
      }
    }
  } else if (field.type === 'TAX') {
    player.money -= field.price;
    gameState.waitingForAction = 'END_TURN';
  } else if (field.type === 'GO_TO_JAIL') {
    player.position = 10;
    player.inJail = true;
    gameState.waitingForAction = 'END_TURN';
  } else {
    gameState.waitingForAction = 'END_TURN';
  }
}

function nextTurn() {
  gameState.turn = (gameState.turn + 1) % gameState.players.length;
  gameState.waitingForAction = 'ROLL_DICE';
  io.emit('gameStateUpdate', gameState);
  checkAITurn();
}

function checkAITurn() {
  const currentPlayer = gameState.players[gameState.turn];
  if (currentPlayer && currentPlayer.isAI && gameState.gameStarted) {
    setTimeout(() => {
      handleRoll(currentPlayer);
    }, 2000);
  }
}

/**
 * SOCKET.IO LOGIK
 */
io.on('connection', (socket) => {
  console.log(`Neuer Spieler verbunden: ${socket.id}`);

  if (gameState.gameStarted || gameState.players.length >= 4) {
    socket.emit('error_message', 'Spiel ist bereits voll oder läuft.');
    return;
  }

  const newPlayer = {
    id: socket.id,
    name: `Spieler ${gameState.players.length + 1}`,
    position: 0,
    money: 1500,
    properties: [],
    inJail: false
  };
  gameState.players.push(newPlayer);
  io.emit('gameStateUpdate', gameState);

  if (gameState.players.length === 4) {
    gameState.gameStarted = true;
    gameState.waitingForAction = 'ROLL_DICE';
    io.emit('gameStarted', gameState);
    io.emit('gameStateUpdate', gameState);
    checkAITurn();
  }

  socket.on('fillWithAI', () => {
    if (gameState.gameStarted) return;
    while (gameState.players.length < 4) {
      const aiId = `AI_${Math.random().toString(36).substr(2, 9)}`;
      gameState.players.push({
        id: aiId,
        name: `KI ${gameState.players.length + 1}`,
        position: 0,
        money: 1500,
        properties: [],
        inJail: false,
        isAI: true
      });
    }
    gameState.gameStarted = true;
    gameState.waitingForAction = 'ROLL_DICE';
    io.emit('gameStateUpdate', gameState);
    io.emit('gameStarted', gameState);
    checkAITurn();
  });

  socket.on('rollDice', () => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'ROLL_DICE') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    handleRoll(player);
  });

  socket.on('buyProperty', () => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'BUY_OR_PASS') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;

    const field = gameState.board[player.position];
    if ((field.type === 'PROPERTY' || field.type === 'STATION' || field.type === 'UTILITY') && !field.owner) {
      if (player.money >= field.price) {
        player.money -= field.price;
        field.owner = player.id;
        player.properties.push(field.id);
        io.emit('gameLog', `${player.name} kauft ${field.name} für ${field.price}€`);
        
        // Nach dem Kauf direkt die Option zum Bauen geben
        if (field.type === 'PROPERTY') {
          gameState.waitingForAction = 'BUILD_OR_END';
        } else {
          gameState.waitingForAction = 'END_TURN';
        }
        io.emit('gameStateUpdate', gameState);
      }
    }
  });

  socket.on('buildHouse', () => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'BUILD_OR_END') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;

    const field = gameState.board[player.position];
    if (field.type === 'PROPERTY' && field.owner === player.id && field.houses < 3) {
      if (player.money >= field.housePrice) {
        player.money -= field.housePrice;
        field.houses++;
        const type = field.houses === 3 ? 'ein Hotel' : `Haus Nr. ${field.houses}`;
        io.emit('gameLog', `${player.name} baut ${type} auf ${field.name} für ${field.housePrice}€`);
        
        // Man kann nur ein Haus pro Zug bauen
        gameState.waitingForAction = 'END_TURN';
        io.emit('gameStateUpdate', gameState);
      }
    }
  });

  socket.on('endTurn', () => {
    // Operation: Wir erlauben den endTurn-Befehl jetzt auch, wenn der Status BUY_OR_PASS ist
    if (!gameState.gameStarted || (
        gameState.waitingForAction !== 'END_TURN' && 
        gameState.waitingForAction !== 'BUILD_OR_END' &&
        gameState.waitingForAction !== 'BUY_OR_PASS'
    )) return;
    
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    
    // Optional: Log-Eintrag, dass das Grundstück übersprungen wurde
    if (gameState.waitingForAction === 'BUY_OR_PASS') {
        io.emit('gameLog', `${player.name} kauft das Grundstück nicht und beendet den Zug.`);
    }
    
    nextTurn();
  });

  socket.on('resetGame', () => {
    gameState.players = [];
    gameState.gameStarted = false;
    gameState.turn = 0;
    gameState.waitingForAction = 'ROLL_DICE';
    gameState.lastRoll = [0, 0];
    gameState.board = initBoard();
    io.emit('gameStateUpdate', gameState);
    io.emit('gameLog', 'Das Spiel wurde zurückgesetzt.');
    // Alle Clients müssen die Seite neu laden oder UI zurücksetzen
    io.emit('reload');
  });

  socket.on('disconnect', () => {
    const index = gameState.players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      gameState.players.splice(index, 1);
      gameState.players = gameState.players.filter(p => !p.isAI);
      gameState.gameStarted = false;
      io.emit('gameStateUpdate', gameState);
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
