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
  rentRecipientId: null,
  vibeCoinPrice: 120,
  priceHistory: [120],
  vibeCoinTrend: 0, // Markttrend (-5 bis +5)
  vibeCoinBonus: 0, // Temporärer Bonus durch Events
  totalTurns: 0,    // Gesamtzahl der Züge für Frequenz-Checks
  globalRentMultiplier: 1.0, // Steigt über Zeit
  maxRounds: 50,    // Maximale Runden bis zum Ende
  currentRound: 1   // Aktuelle Runde
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
  
  // Vibe-Coin Preis-Schwankung nach jedem Wurf
  const oldPrice = gameState.vibeCoinPrice;
  gameState.totalTurns++;

  // Sudden Death Trigger (ca. Runde 40 bei 4 Spielern)
  if (gameState.totalTurns === 160) {
    gameState.globalRentMultiplier = 2.0;
    io.emit('gameLog', `🔥 SUDDEN DEATH! Die Mieten wurden dauerhaft verdoppelt!`);
  }

  // Aktuelle Runde berechnen (grob)
  gameState.currentRound = Math.floor(gameState.totalTurns / gameState.players.length) + 1;
  if (gameState.currentRound > gameState.maxRounds) {
    endGameByNetWorth();
    return;
  }
  
  // 1. Basis-Schwankung (Zufall)
  let changePercent = (Math.random() * 0.1) - 0.05; // -5% bis +5%
  
  // 2. Markttrend (Drift)
  gameState.vibeCoinTrend += (Math.random() * 0.4) - 0.2; // Trend ändert sich langsam
  gameState.vibeCoinTrend = Math.max(-5, Math.min(5, gameState.vibeCoinTrend));
  changePercent += gameState.vibeCoinTrend / 100;

  // 3. Hype-Städte Check (Tokyo: 8, Madrid: 23, New York: 37)
  // Nur jeden 3. Zug aktiv, um den Boost zu dämpfen
  const hypeCities = [8, 23, 37];
  let hypeBonus = 0;
  if (gameState.totalTurns % 3 === 0) {
    hypeCities.forEach(id => {
      if (gameState.board[id].owner !== null) {
        hypeBonus += 0.008; // +0.8% pro besetzter Hype-Stadt
      }
    });
  }
  changePercent += hypeBonus;

  // 4. Temporärer Event-Bonus (Influencer, Bubble etc.)
  // Der Bonus wird nun schneller abgebaut (Decay 0.5 statt 0.85)
  // und sein Einfluss auf die tägliche Schwankung wird gedeckelt.
  const cappedBonus = Math.max(-10, Math.min(10, gameState.vibeCoinBonus));
  changePercent += cappedBonus / 100;
  gameState.vibeCoinBonus *= 0.5; // Schnellerer Abbau

  // 5. Mean Reversion (Verhindert "Stuck at Bottom" und extreme Blasen)
  if (gameState.vibeCoinPrice < 50) {
    changePercent += 0.15; // Noch stärkerer Aufwärtsdruck bei < 50€
  } else if (gameState.vibeCoinPrice < 100) {
    changePercent += 0.05; // Aufwärtsdruck bei < 100€
  } else if (gameState.vibeCoinPrice > 450) {
    changePercent -= 0.15; // Starker Korrekturdruck bei > 450€
  } else if (gameState.vibeCoinPrice > 300) {
    changePercent -= 0.05; // Korrekturdruck bei > 300€
  }

  // Preis berechnen (Minimum 20€ statt 10€)
  gameState.vibeCoinPrice = Math.max(20, Math.floor(gameState.vibeCoinPrice * (1 + changePercent)));
  gameState.priceHistory.push(gameState.vibeCoinPrice);
  if (gameState.priceHistory.length > 20) gameState.priceHistory.shift();
  
  const trendIcon = gameState.vibeCoinPrice > oldPrice ? '📈' : '📉';
  io.emit('gameLog', `${trendIcon} Vibe-Coin Kurs-Update: ${oldPrice}€ ➔ ${gameState.vibeCoinPrice}€ (${(changePercent * 100).toFixed(1)}%)`);
  if (hypeBonus > 0) {
    io.emit('gameLog', `✨ Hype-Städte Bonus aktiv: +${(hypeBonus * 100).toFixed(1)}%`);
  }
  if (Math.abs(gameState.vibeCoinBonus) > 0.5) {
    io.emit('gameLog', `🔥 Event-Nachwirkungen beeinflussen den Kurs: ${(gameState.vibeCoinBonus > 0 ? '+' : '')}${(gameState.vibeCoinBonus).toFixed(1)}%`);
  }

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
    // KI versucht vor dem Beenden noch zu bauen, wenn sie Geld hat
    const buildable = player.properties.filter(id => gameState.board[id].type === 'PROPERTY' && gameState.board[id].houses < 3);
    if (buildable.length > 0) {
      const f = gameState.board[buildable[0]];
      if (player.money >= f.housePrice + 100) {
        player.money -= f.housePrice;
        f.houses++;
        io.emit('gameLog', `${player.name} (KI) baut strategisch auf ${f.name}`);
      }
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'BUY_OR_PASS') {
    // KI kauft, wenn sie danach noch 100€ Puffer hat (aggressiver)
    // Wenn nicht genug Cash, aber Coins da sind: Coins verkaufen!
    if (player.money < field.price + 100 && player.coins > 0) {
      const needed = (field.price + 100) - player.money;
      const coinsToSell = Math.ceil(needed / gameState.vibeCoinPrice);
      const actualSell = Math.min(player.coins, coinsToSell);
      if (actualSell > 0) {
        const gain = actualSell * gameState.vibeCoinPrice;
        player.money += gain;
        player.coins -= actualSell;
        io.emit('gameLog', `${player.name} (KI) verkauft ${actualSell} Coins, um ${field.name} kaufen zu können.`);
      }
    }

    if (player.money >= field.price + 100) {
      player.money -= field.price;
      field.owner = player.id;
      player.properties.push(field.id);
      io.emit('gameLog', `${player.name} (KI) kauft ${field.name} für ${field.price}€`);
      
      checkWinCondition(player);
      if (!gameState.gameStarted) return;

      // Nach Kauf: Prüfen ob Hausbau möglich
      if (field.type === 'PROPERTY' && player.money >= field.housePrice + 100) {
        field.houses = 1;
        player.money -= field.housePrice;
        io.emit('gameLog', `${player.name} (KI) baut sofort ein Haus auf ${field.name}`);
      }
    }
    nextTurn();
  } else if (gameState.waitingForAction === 'BUYOUT_OR_PASS') {
    let buyoutMultiplier = 1.4; // Günstigeres Abkaufen
    if (field.type === 'PROPERTY' && hasMonopoly(field.owner, field.color)) {
      buyoutMultiplier = 1.4 * 1.1;
    }
    const buyoutPrice = Math.floor((field.price + (field.houses || 0) * (field.housePrice || 0)) * buyoutMultiplier);
    
    // KI verkauft Coins für Buyout
    if (player.money < buyoutPrice + 150 && player.coins > 0) {
      const needed = (buyoutPrice + 150) - player.money;
      const coinsToSell = Math.ceil(needed / gameState.vibeCoinPrice);
      const actualSell = Math.min(player.coins, coinsToSell);
      if (actualSell > 0) {
        player.money += actualSell * gameState.vibeCoinPrice;
        player.coins -= actualSell;
      }
    }

    if (player.money >= buyoutPrice + 150) {
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
    if (field.type === 'PROPERTY' && field.houses < 3 && player.money >= field.housePrice + 100) {
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
  
  // 1. Alle 4 Bahnhöfe
  if (ownedStations.length === 4) {
    announceWin(player, "BAHNHOF-MONOPOLY! Besitzt alle 4 Bahnhöfe.");
    return;
  }

  // 2. Alle Straßen einer Seite
  const side1 = [1, 3, 6, 8, 9]; // Braun + Hellblau
  const side2 = [11, 13, 14, 16, 18, 19]; // Pink + Orange
  const side3 = [21, 23, 24, 26, 27, 29]; // Rot + Gelb
  const side4 = [31, 32, 34, 37, 39]; // Grün + Dunkelblau

  if (side1.every(id => gameState.board[id].owner === player.id)) {
    announceWin(player, "SIDE-MONOPOLY (Seite 1)! Besitzt alle Straßen von Buenos Aires bis Seoul.");
    return;
  }
  if (side2.every(id => gameState.board[id].owner === player.id)) {
    announceWin(player, "SIDE-MONOPOLY (Seite 2)! Besitzt alle Straßen von Rom bis Prag.");
    return;
  }
  if (side3.every(id => gameState.board[id].owner === player.id)) {
    announceWin(player, "SIDE-MONOPOLY (Seite 3)! Besitzt alle Straßen von Amsterdam bis Dubai.");
    return;
  }
  if (side4.every(id => gameState.board[id].owner === player.id)) {
    announceWin(player, "SIDE-MONOPOLY (Seite 4)! Besitzt alle Straßen von London bis San Francisco.");
    return;
  }

  // 3. Top 5 World Hype (Pink + Dunkelblau)
  const hypeWorld = [11, 13, 14, 37, 39]; // Rom, Paris, Venedig, NY, SF
  if (hypeWorld.every(id => gameState.board[id].owner === player.id)) {
    announceWin(player, "WORLD HYPE MONOPOLY! Besitzt die Top 5 Hype-Städte der Welt.");
    return;
  }

  // 4. Klassisches Monopoly: 3 komplette Farbgruppen (Monopole)
  const colors = ["#955436", "#aae0fa", "#d93a96", "#f7941d", "#ed1c24", "#fef200", "#1fb25a", "#0072bb"];
  let monopolyCount = 0;
  colors.forEach(color => {
    if (hasMonopoly(player.id, color)) monopolyCount++;
  });

  if (monopolyCount >= 3) {
    announceWin(player, `MONOPOLY-KÖNIG! Besitzt ${monopolyCount} komplette Farbgruppen.`);
    return;
  }

  // 5. Net Worth Tycoon: 10.000€ Gesamtwert (Cash + Grundstücke + Häuser + Coins)
  let netWorth = player.money + (player.coins * gameState.vibeCoinPrice);
  player.properties.forEach(id => {
    const f = gameState.board[id];
    netWorth += f.price + (f.houses || 0) * (f.housePrice || 0);
  });

  if (netWorth >= 10000) {
    announceWin(player, `NET WORTH TYCOON! Gesamtwert von ${netWorth}€ erreicht.`);
    return;
  }
}

function endGameByNetWorth() {
  io.emit('gameLog', `⌛ ZEITABLAUF! Die maximale Rundenzahl wurde erreicht.`);
  
  let winner = null;
  let maxNetWorth = -1;

  gameState.players.forEach(player => {
    let netWorth = player.money + (player.coins * gameState.vibeCoinPrice);
    player.properties.forEach(id => {
      const f = gameState.board[id];
      netWorth += f.price + (f.houses || 0) * (f.housePrice || 0);
    });

    if (netWorth > maxNetWorth) {
      maxNetWorth = netWorth;
      winner = player;
    }
  });

  if (winner) {
    announceWin(winner, `REICHSTER SPIELER! Gesamtwert von ${maxNetWorth}€ am Ende der Zeit.`);
  }
}

function announceWin(player, reason) {
  io.emit('gameLog', `🏆 SPIELENDE! ${player.name} gewinnt! Grund: ${reason}`);
  gameState.gameStarted = false;
  gameState.waitingForAction = 'GAME_OVER';
  io.emit('gameStateUpdate', gameState);
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
        
        // Globaler Multiplikator (Sudden Death)
        rent = Math.floor(rent * gameState.globalRentMultiplier);

        // Miete erhöhen durch Häuser (Normalwerte)
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
      // Sofortiger Effekt auf den Preis
      const influencerImpact = 0.15;
      gameState.vibeCoinPrice = Math.floor(gameState.vibeCoinPrice * (1 + influencerImpact));
      gameState.vibeCoinBonus += 5; // Kleinerer Nachwirkungs-Trend
      io.emit('gameLog', `🚀 Vibe-Coin Hype durch Influencer! Sofort-Anstieg: +15%`);
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
      // Sofortiger Effekt auf den Preis
      const bubbleImpact = -0.20;
      gameState.vibeCoinPrice = Math.max(20, Math.floor(gameState.vibeCoinPrice * (1 + bubbleImpact)));
      gameState.vibeCoinBonus -= 5; // Kleinerer Nachwirkungs-Trend
      io.emit('gameLog', `📉 Marktpanik! Immobilienblase drückt Vibe-Coin: -20%`);
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

  // Wir fügen den Spieler nur hinzu, wenn noch Platz ist und das Spiel nicht läuft
  if (!gameState.gameStarted && gameState.players.length < 4) {
    const newPlayer = {
      id: socket.id,
      name: `Spieler ${gameState.players.length + 1}`,
      position: 0,
      money: 1500,
      coins: 0,
      totalSpent: 0, // Für Durchschnittspreis-Berechnung
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
  } else if (gameState.gameStarted) {
    // Wenn das Spiel läuft, prüfen wir, ob es einen "Auto-Play" Bot gibt, den der Spieler übernehmen kann
    const aiPlayer = gameState.players.find(p => p.isAI);
    if (aiPlayer) {
      const oldName = aiPlayer.name.replace(" (Auto-Play)", "");
      aiPlayer.id = socket.id;
      aiPlayer.isAI = false;
      aiPlayer.name = oldName;
      io.emit('gameLog', `🔄 ${aiPlayer.name} ist wieder da und übernimmt seinen Platz!`);
      io.emit('gameStateUpdate', gameState);
    } else {
      socket.emit('error_message', 'Spiel ist bereits voll und alle Plätze sind belegt.');
    }
  } else {
    socket.emit('error_message', 'Lobby ist voll.');
  }

  // Wir senden den aktuellen State an den neuen Socket, auch wenn er nur Zuschauer ist
  socket.emit('gameStateUpdate', gameState);

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
        coins: 0,
        totalSpent: 0,
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

  socket.on('buyCoins', (amount) => {
    if (!gameState.gameStarted) return;
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;
    
    const cost = amount * gameState.vibeCoinPrice;
    if (player.money >= cost) {
      player.money -= cost;
      player.coins += amount;
      player.totalSpent += cost;
      io.emit('gameLog', `${player.name} kauft ${amount} Vibe-Coins für ${cost}€`);
      io.emit('gameStateUpdate', gameState);
    }
  });

  socket.on('sellCoins', (amount) => {
    if (!gameState.gameStarted) return;
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;
    
    if (player.coins >= amount) {
      const revenue = amount * gameState.vibeCoinPrice;
      
      // Durchschnittspreis-Anpassung beim Verkauf (FIFO-ähnlich oder einfach anteilig)
      const avgPrice = player.coins > 0 ? player.totalSpent / player.coins : 0;
      player.totalSpent -= avgPrice * amount;
      if (player.totalSpent < 0) player.totalSpent = 0;

      player.money += revenue;
      player.coins -= amount;
      io.emit('gameLog', `${player.name} verkauft ${amount} Vibe-Coins für ${revenue}€`);
      io.emit('gameStateUpdate', gameState);
    }
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
        recipient.money += gameState.rentOwed;
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
    gameState.wmCityId = null;
    gameState.lastDrawnCard = null;
    gameState.rentOwed = 0;
    gameState.rentRecipientId = null;
    gameState.vibeCoinPrice = 120;
    gameState.priceHistory = [120];
    gameState.totalTurns = 0;
    gameState.globalRentMultiplier = 1.0;
    gameState.currentRound = 1;
    
    io.emit('gameStateUpdate', gameState);
    io.emit('gameLog', 'Das Spiel wurde zurückgesetzt.');
    // Alle Clients müssen die Seite neu laden oder UI zurücksetzen
    io.emit('reload');
  });

  socket.on('disconnect', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (player) {
      if (gameState.gameStarted) {
        // Spiel läuft? Lass eine KI übernehmen!
        player.isAI = true;
        player.name = player.name + " (Auto-Play)";
        io.emit('gameLog', `🔌 ${player.name} hat die Verbindung verloren. Ein Bot übernimmt.`);
        checkAITurn(); // Falls er gerade dran war
      } else {
        // Spiel noch in der Lobby? Dann normal löschen
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
      }
      io.emit('gameStateUpdate', gameState);
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
