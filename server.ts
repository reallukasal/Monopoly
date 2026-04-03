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
  waitingForAction: 'ROLL_DICE', // 'ROLL_DICE', 'BUY_OR_PASS', 'END_TURN', etc.
  lastRoll: [0, 0],
  wmCityId: null, // ID der Stadt mit WM-Bonus
  lastDrawnCard: null, // { type, id, title, text }
  rentOwed: 0,
  rentRecipientId: null
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
        housePrice: Math.floor(price * 0.5),
        specialEffect: null // z.B. 'WM'
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
    // Bonus: E-Werk (12) und Wasserwerk (28)
    const ownsEWerk = gameState.board[12].owner === player.id;
    const ownsWasserwerk = gameState.board[28].owner === player.id;
    const salary = (ownsEWerk && ownsWasserwerk) ? 300 : 200;
    
    player.money += salary;
    io.emit('gameLog', `${player.name} geht über LOS und erhält ${salary}€${salary === 300 ? ' (Bonus durch Versorgungs-Monopoly!)' : ''}`);
  }

  io.emit('gameLog', `${player.name} würfelt ${total} und landet auf ${gameState.board[player.position].name}`);
  
  handleLanding(player);
  io.emit('gameStateUpdate', gameState);

  // KI-Check
  if (player.isAI) {
    setTimeout(() => processAI(player), 1500);
  }
}

function processAI(player) {
  if (!gameState.gameStarted || !player.isAI) return;

  const field = gameState.board[player.position];

  if (gameState.waitingForAction === 'END_TURN') {
    nextTurn();
  } else if (gameState.waitingForAction === 'BUY_OR_PASS') {
    // KI kauft, wenn sie danach noch 200€ Puffer hat
    if (player.money >= field.price + 200) {
      player.money -= field.price;
      field.owner = player.id;
      player.properties.push(field.id);
      io.emit('gameLog', `${player.name} (KI) kauft ${field.name} für ${field.price}€`);
      
      checkWinCondition(player);
      if (!gameState.gameStarted) return;

      // Nach Kauf: Prüfen ob Hausbau möglich
      if (field.type === 'PROPERTY' && player.money >= field.housePrice + 200) {
        field.houses = 1;
        player.money -= field.housePrice;
        io.emit('gameLog', `${player.name} (KI) baut ein Haus auf ${field.name}`);
      }
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'BUYOUT_OR_PASS') {
    let buyoutMultiplier = 1.5;
    if (field.type === 'PROPERTY' && hasMonopoly(field.owner, field.color)) {
      buyoutMultiplier = 1.5 * 1.15;
    }
    const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
    // KI kauft ab, wenn sie danach noch 300€ Puffer hat (etwas vorsichtiger beim Abkaufen)
    if (player.money >= buyoutPrice + 300) {
      const oldOwner = gameState.players.find(p => p.id === field.owner);
      player.money -= buyoutPrice;
      if (oldOwner) {
        oldOwner.money += buyoutPrice;
        oldOwner.properties = oldOwner.properties.filter(id => id !== field.id);
      }
      field.owner = player.id;
      player.properties.push(field.id);
      io.emit('gameLog', `${player.name} (KI) kauft ${field.name} von ${oldOwner ? oldOwner.name : 'jemandem'} ab für ${buyoutPrice}€!`);
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'BUILD_OR_END') {
    if (field.type === 'PROPERTY' && field.houses < 3 && player.money >= field.housePrice + 200) {
      player.money -= field.housePrice;
      field.houses++;
      const type = field.houses === 3 ? 'ein Hotel' : `Haus Nr. ${field.houses}`;
      io.emit('gameLog', `${player.name} (KI) baut ${type} auf ${field.name}`);
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'CHOOSE_WM_CITY') {
    const bestCityId = player.properties.sort((a, b) => gameState.board[b].rent - gameState.board[a].rent)[0];
    if (bestCityId !== undefined) {
      const f = gameState.board[bestCityId];
      f.specialEffect = 'WM';
      gameState.wmCityId = bestCityId;
      io.emit('gameLog', `${player.name} (KI) wählt ${f.name} für die WM!`);
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'CHOOSE_GENTRIFICATION_CITY') {
    const buildable = player.properties.filter(id => gameState.board[id].type === 'PROPERTY' && gameState.board[id].houses < 3);
    const bestCityId = buildable.sort((a, b) => gameState.board[a].houses - gameState.board[b].houses)[0];
    if (bestCityId !== undefined) {
      const f = gameState.board[bestCityId];
      f.houses++;
      io.emit('gameLog', `${player.name} (KI) nutzt Gentrifizierung für ${f.name}!`);
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'MUST_SELL_TO_PAY_RENT') {
    // KI verkauft Besitz bis Schulden weg sind
    while (player.money < gameState.rentOwed && player.properties.length > 0) {
      const fieldId = player.properties[0];
      const f = gameState.board[fieldId];
      const sellPrice = Math.floor((f.price + (f.houses || 0) * (f.housePrice || 0)) * 0.75);
      
      player.money += sellPrice;
      player.properties.shift();
      f.owner = null;
      f.houses = 0;
      f.specialEffect = null;
      io.emit('gameLog', `${player.name} (KI) verkauft ${f.name} für ${sellPrice}€`);
    }
    
    if (player.money >= gameState.rentOwed) {
      player.money -= gameState.rentOwed;
      gameState.rentOwed = 0;
      gameState.rentRecipientId = null;
      gameState.waitingForAction = 'END_TURN';
      io.emit('gameLog', `${player.name} (KI) hat seine Schulden beglichen.`);
    } else {
      removePlayer(player);
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'CHOOSE_FLIGHT_DESTINATION') {
    const freeFields = gameState.board.filter(f => (f.type === 'PROPERTY' || f.type === 'STATION') && !f.owner);
    let targetId = 0;
    if (freeFields.length > 0) {
      targetId = freeFields.sort((a, b) => b.price - a.price)[0].id;
    } else {
      targetId = (player.position + 10) % 40;
    }
    
    if (targetId < player.position) {
      player.money += 200;
      io.emit('gameLog', `${player.name} geht über LOS und erhält 200€`);
    }
    player.position = targetId;
    io.emit('gameLog', `${player.name} (KI) fliegt nach ${gameState.board[targetId].name}`);
    handleLanding(player);
    io.emit('gameStateUpdate', gameState);
    
    // WICHTIG: Nach dem Flug erneut processAI aufrufen, um auf dem neuen Feld zu reagieren!
    setTimeout(() => processAI(player), 1500);
  }
}

function checkWinCondition(player) {
  const stationIndices = [5, 15, 25, 35];
  const ownedStations = stationIndices.filter(index => gameState.board[index].owner === player.id);
  
  if (ownedStations.length === 4) {
    io.emit('gameLog', `🏆 BAHNHOF-MONOPOLY! ${player.name} besitzt alle 4 Bahnhöfe und gewinnt das Spiel!`);
    gameState.gameStarted = false;
    gameState.waitingForAction = 'GAME_OVER';
    io.emit('gameStateUpdate', gameState);
  }
}

function hasMonopoly(playerId, color) {
  if (!color || color === "#ccc") return false;
  const colorFields = gameState.board.filter(f => f.color === color);
  return colorFields.every(f => f.owner === playerId);
}

function removePlayer(player) {
  const index = gameState.players.findIndex(p => p.id === player.id);
  if (index === -1) return;

  io.emit('gameLog', `💀 ${player.name} ist bankrott! Er verlässt das Spiel.`);

  // Alle Besitztümer freigeben
  gameState.board.forEach(f => {
    if (f.owner === player.id) {
      f.owner = null;
      f.houses = 0;
      f.specialEffect = null;
    }
  });

  gameState.players.splice(index, 1);

  if (gameState.players.length === 1) {
    io.emit('gameLog', `🏆 ${gameState.players[0].name} hat gewonnen!`);
    gameState.gameStarted = false;
    gameState.waitingForAction = 'GAME_OVER';
    io.emit('gameStateUpdate', gameState);
  } else {
    // Turn-Index anpassen
    if (index < gameState.turn) {
      gameState.turn--;
    } else if (index === gameState.turn) {
      // Wenn der aktuelle Spieler entfernt wird, zeigt der Index danach auf den nächsten Spieler
      // Wir müssen turn so setzen, dass nextTurn() zum richtigen Spieler springt
      gameState.turn = (gameState.turn - 1 + gameState.players.length) % gameState.players.length;
    }
    nextTurn();
  }
}

function handleLanding(player, isInfluencerMove = false) {
  const field = gameState.board[player.position];

  if (field.type === 'PROPERTY' || field.type === 'STATION' || field.type === 'UTILITY') {
    if (!field.owner) {
      gameState.waitingForAction = 'BUY_OR_PASS';
    } else if (field.owner !== player.id) {
      const owner = gameState.players.find(p => p.id === field.owner);
      if (owner) {
        let rent = field.rent || Math.floor(field.price * 0.1);
        
        // Miete erhöhen durch Häuser
        if (field.houses === 1) rent *= 2;
        if (field.houses === 2) rent *= 3;
        if (field.houses === 3) rent *= 5; // Hotel

        // Monopoly Bonus (7.5%)
        if (field.type === 'PROPERTY' && hasMonopoly(owner.id, field.color)) {
          rent = Math.floor(rent * 1.075);
        }

        // Station scaling
        if (field.type === 'STATION') {
          const ownerStations = owner.properties.filter(id => gameState.board[id].type === 'STATION').length;
          if (ownerStations === 2) rent = Math.floor(rent * 1.3);
          if (ownerStations === 3) rent = Math.floor(rent * 1.6);
          if (ownerStations === 4) rent = Math.floor(rent * 1.9);
        }

        // Spezial-Effekte
        if (field.specialEffect === 'WM') {
          rent *= 3;
          io.emit('gameLog', `⚽ WM-BONUS! Die Miete auf ${field.name} ist verdreifacht!`);
        }
        if (isInfluencerMove) {
          rent *= 2;
          io.emit('gameLog', `📱 INFLUENCER-HYPE! Die Miete auf ${field.name} ist verdoppelt!`);
        }

        if (player.money < rent) {
          const partialRent = player.money;
          player.money = 0;
          owner.money += partialRent;
          gameState.rentOwed = rent - partialRent;
          gameState.rentRecipientId = owner.id;
          
          // Check if player can even pay by selling everything
          const totalAssets = player.properties.reduce((sum, id) => {
            const f = gameState.board[id];
            return sum + Math.floor((f.price + (f.houses || 0) * (f.housePrice || 0)) * 0.75);
          }, 0);

          if (totalAssets < gameState.rentOwed) {
            removePlayer(player);
            return;
          }

          gameState.waitingForAction = 'MUST_SELL_TO_PAY_RENT';
          io.emit('gameLog', `⚠️ ${player.name} kann die Miete von ${rent}€ nicht voll zahlen! Er zahlt ${partialRent}€ und muss Besitz verkaufen, um die restlichen ${gameState.rentOwed}€ zu begleichen.`);
          io.emit('gameStateUpdate', gameState);
          return;
        } else {
          player.money -= rent;
          owner.money += rent;
          io.emit('gameLog', `${player.name} zahlt ${rent}€ Miete an ${owner.name}`);
        }

        // BUYOUT LOGIC
        let buyoutMultiplier = 1.5;
        if (field.type === 'PROPERTY' && hasMonopoly(owner.id, field.color)) {
          buyoutMultiplier = 1.5 * 1.15; // 15% teurer bei Monopoly
        }
        const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
        if (player.money >= buyoutPrice) {
          gameState.waitingForAction = 'BUYOUT_OR_PASS';
        } else {
          gameState.waitingForAction = 'END_TURN';
        }
      }
    } else {
      // Eigene Straße: Man kann bauen, wenn es eine PROPERTY ist und man genug Geld hat
      const hasBothUtilities = player.properties.includes(12) && player.properties.includes(28);
      const discount = hasBothUtilities ? 0.65 : 1.0;
      const effectiveHousePrice = Math.floor(field.housePrice * discount);

      if (field.type === 'PROPERTY' && field.houses < 3 && player.money >= effectiveHousePrice) {
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
  } else if (field.type === 'CHANCE') {
    drawChanceCard(player);
  } else if (field.type === 'COMMUNITY_CHEST') {
    drawCommunityChestCard(player);
  } else {
    gameState.waitingForAction = 'END_TURN';
  }
}

function drawChanceCard(player) {
  const cards = [
    { id: 'WM', title: 'Die Fußball-WM', text: 'Du hast die Rechte für die nächste Fußball-WM gesichert! Wähle eine deiner Städte. Die Miete verdreifacht sich, bis das nächste Mal diese Karte gezogen wird.' },
    { id: 'INFLUENCER', title: 'Influencer-Hype', text: 'Ein virales TikTok-Video wurde bei dir gedreht. Der Hype ist real! Rücke vor bis zur nächsten Stadt (Tokyo, Wien oder Sydney). Wenn sie frei ist, kannst du sie kaufen. Gehört sie schon jemandem, zahlst du die doppelte Miete.' },
    { id: 'GENTRIFICATION', title: 'Gentrifizierung', text: 'Das Viertel wird aufgewertet. Du erhältst sofort ein kostenloses Haus, das du in einer beliebigen deiner Städte platzieren kannst (sofern Platz ist).' },
    { id: 'BUBBLE', title: 'Immobilien-Blase geplatzt', text: 'Der Markt korrigiert sich hart. Du musst für jedes deiner Häuser 40€ und für jedes Hotel 115€ an die Bank zahlen.' }
  ];
  const card = cards[Math.floor(Math.random() * cards.length)];
  
  gameState.lastDrawnCard = { type: 'CHANCE', ...card };
  io.emit('gameLog', `❓ EREIGNIS: ${card.title}`);

  switch(card.id) {
    case 'WM':
      // WM Effekt vom alten Feld entfernen
      if (gameState.wmCityId !== null) {
        gameState.board[gameState.wmCityId].specialEffect = null;
      }
      if (player.properties.some(id => gameState.board[id].type === 'PROPERTY')) {
        gameState.waitingForAction = 'CHOOSE_WM_CITY';
      } else {
        io.emit('gameLog', `Keine Städte im Besitz. WM fällt aus.`);
        gameState.waitingForAction = 'END_TURN';
      }
      break;
    case 'INFLUENCER':
      const targets = [8, 18, 32]; // Tokyo, Wien, Sydney
      let nextPos = (player.position + 1) % 40;
      while (!targets.includes(nextPos)) {
        nextPos = (nextPos + 1) % 40;
      }
      if (nextPos < player.position) {
        player.money += 200;
        io.emit('gameLog', `${player.name} geht über LOS und erhält 200€`);
      }
      player.position = nextPos;
      handleLanding(player, true); // true = Influencer Move (doppelte Miete)
      break;
    case 'GENTRIFICATION':
      if (player.properties.filter(id => gameState.board[id].type === 'PROPERTY' && gameState.board[id].houses < 3).length > 0) {
        gameState.waitingForAction = 'CHOOSE_GENTRIFICATION_CITY';
      } else {
        io.emit('gameLog', `Kein Platz für ein neues Haus.`);
        gameState.waitingForAction = 'END_TURN';
      }
      break;
    case 'BUBBLE':
      let totalCost = 0;
      player.properties.forEach(id => {
        const f = gameState.board[id];
        if (f.houses === 3) totalCost += 115;
        else if (f.houses > 0) totalCost += f.houses * 40;
      });
      player.money -= totalCost;
      io.emit('gameLog', `📉 "Immobilien-Blase": ${player.name} zahlt ${totalCost}€ für Renovierungen.`);
      gameState.waitingForAction = 'END_TURN';
      break;
  }
}

function drawCommunityChestCard(player) {
  const cards = [
    { id: 'CROWDFUNDING', title: 'Crowdfunding-Erfolg', text: 'Dein neues Tech-Startup hat sein Finanzierungsziel erreicht! Jeder Mitspieler ist investiert und muss dir 50€ zahlen.' },
    { id: 'NEIGHBORHOOD', title: 'Nachbarschaftshilfe', text: 'Solidarität im Viertel. Der Spieler, der aktuell das wenigste Geld hat, erhält eine Spende von 200€ aus der Gemeinschaftskasse.' },
    { id: 'SPEEDING', title: 'Blitzer-Marathon', text: 'Du wurdest auf dem Weg in die Stadt geblitzt. Gehe sofort direkt ins Gefängnis. Gehe nicht über Los, ziehe keine 200€ ein.' },
    { id: 'FLIGHT', title: 'First-Class Flugticket', text: 'Ab zum Flughafen! Du fliegst in eine beliebige Stadt deiner Wahl. Du bewegst dich auf dem Feld vorwärts – wenn du dabei über LOS fliegst, ziehst du deine 200€ Gehalt ein!' }
  ];
  const card = cards[Math.floor(Math.random() * cards.length)];
  
  gameState.lastDrawnCard = { type: 'COMMUNITY', ...card };
  io.emit('gameLog', `📦 GEMEINSCHAFT: ${card.title}`);

  switch(card.id) {
    case 'CROWDFUNDING':
      gameState.players.forEach(p => {
        if (p.id !== player.id) {
          p.money -= 50;
          player.money += 50;
        }
      });
      gameState.waitingForAction = 'END_TURN';
      break;
    case 'NEIGHBORHOOD':
      let poorest = gameState.players[0];
      gameState.players.forEach(p => {
        if (p.money < poorest.money) poorest = p;
      });
      poorest.money += 200;
      io.emit('gameLog', `${poorest.name} erhält 200€ Unterstützung.`);
      gameState.waitingForAction = 'END_TURN';
      break;
    case 'SPEEDING':
      player.position = 10;
      player.inJail = true;
      gameState.waitingForAction = 'END_TURN';
      break;
    case 'FLIGHT':
      gameState.waitingForAction = 'CHOOSE_FLIGHT_DESTINATION';
      break;
  }
}

function nextTurn() {
  gameState.turn = (gameState.turn + 1) % gameState.players.length;
  const nextPlayer = gameState.players[gameState.turn];

  if (nextPlayer && nextPlayer.inJail) {
    nextPlayer.inJail = false;
    io.emit('gameLog', `⛓️ ${nextPlayer.name} setzt eine Runde im Gefängnis aus.`);
    nextTurn();
    return;
  }

  gameState.waitingForAction = 'ROLL_DICE';
  gameState.lastDrawnCard = null; // Reset card
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
    gameState.board = initBoard(); // Reset board for new game
    gameState.gameStarted = true;
    gameState.waitingForAction = 'ROLL_DICE';
    io.emit('gameStarted', gameState);
    io.emit('gameStateUpdate', gameState);
    checkAITurn();
  }

  socket.on('fillWithAI', () => {
    if (gameState.gameStarted) return;
    gameState.board = initBoard(); // Reset board for new game
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
    gameState.lastDrawnCard = null; // Reset card on new roll
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
        
        // Check Win Condition (Stations)
        checkWinCondition(player);
        if (!gameState.gameStarted) return;

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

  socket.on('buyoutProperty', () => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'BUYOUT_OR_PASS') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;

    const field = gameState.board[player.position];
    const oldOwnerId = field.owner;
    if (!oldOwnerId || oldOwnerId === player.id) return;

    let buyoutMultiplier = 1.5;
    if (field.type === 'PROPERTY' && hasMonopoly(oldOwnerId, field.color)) {
      buyoutMultiplier = 1.5 * 1.15;
    }
    const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
    if (player.money >= buyoutPrice) {
      const oldOwner = gameState.players.find(p => p.id === oldOwnerId);
      
      player.money -= buyoutPrice;
      if (oldOwner) {
        oldOwner.money += buyoutPrice;
        // Remove from old owner's properties
        oldOwner.properties = oldOwner.properties.filter(id => id !== field.id);
      }
      
      field.owner = player.id;
      player.properties.push(field.id);
      
      io.emit('gameLog', `${player.name} kauft ${field.name} von ${oldOwner ? oldOwner.name : 'jemandem'} ab für ${buyoutPrice}€!`);
      
      gameState.waitingForAction = 'END_TURN';
      io.emit('gameStateUpdate', gameState);
    }
  });

  socket.on('buildHouse', () => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'BUILD_OR_END') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;

    const field = gameState.board[player.position];
    if (field.type === 'PROPERTY' && field.owner === player.id && field.houses < 3) {
      const hasBothUtilities = player.properties.includes(12) && player.properties.includes(28);
      const discount = hasBothUtilities ? 0.65 : 1.0;
      const effectiveHousePrice = Math.floor(field.housePrice * discount);

      if (player.money >= effectiveHousePrice) {
        player.money -= effectiveHousePrice;
        field.houses++;
        const type = field.houses === 3 ? 'ein Hotel' : `Haus Nr. ${field.houses}`;
        const subMsg = hasBothUtilities ? ' (inkl. 35% Bau-Subvention!)' : '';
        io.emit('gameLog', `${player.name} baut ${type} auf ${field.name} für ${effectiveHousePrice}€${subMsg}`);
        
        // Man kann nur ein Haus pro Zug bauen
        gameState.waitingForAction = 'END_TURN';
        io.emit('gameStateUpdate', gameState);
      }
    }
  });

  socket.on('sellProperty', (fieldId) => {
    if (!gameState.gameStarted || gameState.waitingForAction !== 'MUST_SELL_TO_PAY_RENT') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    if (!player.properties.includes(fieldId)) return;

    const field = gameState.board[fieldId];
    const sellPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * 0.75);
    
    player.money += sellPrice;
    
    // Remove from player's properties
    player.properties = player.properties.filter(id => id !== fieldId);
    field.owner = null;
    field.houses = 0;
    field.specialEffect = null;

    io.emit('gameLog', `${player.name} verkauft ${field.name} für ${sellPrice}€, um Schulden zu begleichen.`);

    // Check if debt is cleared
    if (player.money >= gameState.rentOwed) {
      player.money -= gameState.rentOwed;
      const recipient = gameState.players.find(p => p.id === gameState.rentRecipientId);
      if (recipient) {
        // Recipient already got the money in handleLanding, but wait...
        // Actually, in handleLanding we already subtracted rent from player and added to owner.
        // If player had 100 and rent was 400, player is now at -300.
        // My logic above sets player.money = 0 and rentOwed = 300.
        // So when player sells for 400, they have 400. 400 >= 300.
        // They pay 300, remain with 100.
        // The recipient already got the FULL rent in handleLanding.
        // So we don't need to add to recipient again.
      }
      gameState.rentOwed = 0;
      gameState.rentRecipientId = null;
      gameState.waitingForAction = 'END_TURN';
      io.emit('gameLog', `${player.name} hat seine Schulden beglichen.`);
    }

    io.emit('gameStateUpdate', gameState);
  });

  socket.on('confirmCard', () => {
    if (!gameState.gameStarted) return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    
    // Nur wenn wir auf eine Kartenbestätigung warten
    if (gameState.waitingForAction === 'END_TURN' && gameState.lastDrawnCard) {
      nextTurn();
    }
  });

  socket.on('chooseWMCity', (fieldId) => {
    if (gameState.waitingForAction !== 'CHOOSE_WM_CITY') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    if (!player.properties.includes(fieldId)) return;

    const field = gameState.board[fieldId];
    if (field.type !== 'PROPERTY') return;

    field.specialEffect = 'WM';
    gameState.wmCityId = fieldId;
    io.emit('gameLog', `${player.name} wählt ${field.name} für die Fußball-WM!`);
    nextTurn();
  });

  socket.on('chooseGentrificationCity', (fieldId) => {
    if (gameState.waitingForAction !== 'CHOOSE_GENTRIFICATION_CITY') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;
    if (!player.properties.includes(fieldId)) return;

    const field = gameState.board[fieldId];
    if (field.type === 'PROPERTY' && field.houses < 3) {
      field.houses++;
      io.emit('gameLog', `${player.name} nutzt Gentrifizierung für ein Gratis-Haus auf ${field.name}!`);
      nextTurn();
    }
  });

  socket.on('chooseFlightDestination', (fieldId) => {
    if (gameState.waitingForAction !== 'CHOOSE_FLIGHT_DESTINATION') return;
    const player = gameState.players[gameState.turn];
    if (player.id !== socket.id) return;

    if (fieldId < player.position) {
      player.money += 200;
      io.emit('gameLog', `${player.name} geht über LOS und erhält 200€`);
    }
    player.position = fieldId;
    io.emit('gameLog', `${player.name} fliegt nach ${gameState.board[fieldId].name}`);
    handleLanding(player);
    io.emit('gameStateUpdate', gameState);
  });

  socket.on('endTurn', () => {
    // Operation: Wir erlauben den endTurn-Befehl jetzt auch, wenn der Status BUY_OR_PASS ist
    if (!gameState.gameStarted || (
        gameState.waitingForAction !== 'END_TURN' && 
        gameState.waitingForAction !== 'BUILD_OR_END' &&
        gameState.waitingForAction !== 'BUY_OR_PASS' &&
        gameState.waitingForAction !== 'BUYOUT_OR_PASS'
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
