/**
 * Una sala de juego: el conjunto de jugadores (humanos y bots) que comparten un
 * código, su configuración de partida y su fase. La sala es la dueña del estado;
 * el cliente solo recibe vistas y manda intenciones.
 *
 * La sala gestiona el vestíbulo (unirse, bots, configuración, arranque) y, una
 * vez empezada la partida, delega el ciclo de juego en el motor (`GameEngine`),
 * traduciendo sus avisos a mensajes de red.
 */

import {
  DEFAULT_CONFIG,
  type BotDifficulty,
  type GameConfig,
  type GameEvent,
  type GamePhase,
  type GameSummaryView,
  type GameView,
  type PlayerView,
  type ServerMessage,
} from '../shared/protocol.js';
import { validateClue } from '../shared/rules.js';
import { GameEngine, type EngineEmitter } from './engine.js';
import { botClue, botGuess } from './bot.js';
import { createClaudeProvider } from './ai_claude.js';
import type { Word } from './words_repo.js';

/**
 * Proveedor de IA de Claude, si hay clave de API configurada. Se crea una sola
 * vez y lo comparten todas las salas; si es null, los bots juegan en modo offline.
 */
const aiProvider = createClaudeProvider();

/** Retardo antes de que un bot actúe, para que su jugada se oiga y no atropelle. */
const BOT_DELAY_MS = 1300;

/**
 * Salida de la sala hacia las conexiones. La sala no conoce los WebSockets: solo
 * pide "manda esto a todos" o "manda esto solo a este jugador". Así se puede
 * probar la lógica sin red.
 */
export interface Transport {
  /** Envía un mensaje a todas las conexiones de la sala. */
  broadcast(message: ServerMessage): void;
  /** Envía un mensaje solo a la conexión de un jugador (estado privado). */
  sendTo(playerId: string, message: ServerMessage): void;
}

/** Un jugador de la sala, con su estado interno. */
interface Player {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  difficulty?: BotDifficulty;
  team: number | null;
}

export class Room {
  private readonly players: Player[] = [];
  private hostId: string | null = null;
  private phase: GamePhase = 'lobby';
  private config: GameConfig = { ...DEFAULT_CONFIG };
  private nextPlayerNumber = 1;
  private nextBotNumber = 1;
  private engine: GameEngine | null = null;
  private lastSummary: GameSummaryView | null = null;
  /** Marca del turno de bot ya programado, para no programarlo dos veces. */
  private pendingBotToken: string | null = null;
  /** Temporizador del contrarreloj, para poder cancelarlo al terminar. */
  private timedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly code: string,
    private readonly transport: Transport,
    private readonly words: Word[],
  ) {}

  // --- Altas y bajas --------------------------------------------------------

  /**
   * @brief Añade un jugador humano a la sala, o lo readmite si ya estaba.
   *
   * Un nombre que vuelve (misma persona tras una reconexión) recupera su sitio
   * en vez de duplicarse. El primer jugador en entrar queda como anfitrión.
   *
   * @param name Nombre visible del jugador.
   * @return El id del jugador, o null si la partida ya no admite entradas.
   */
  addOrReattach(name: string): string | null {
    const existing = this.players.find((p) => !p.isBot && p.name === name);
    if (existing) {
      existing.connected = true;
      // Al reconectar, un dador ha de recuperar su palabra secreta (el cliente la
      // pierde al recargar); el motor la reenvía a quien corresponda.
      if (this.engine && !this.engine.isFinished) this.engine.resendSecrets();
      this.broadcastState();
      return existing.id;
    }
    // Empezada la partida no se admiten jugadores nuevos: entrar a media ronda
    // dejaría a alguien sin rol y sin contexto.
    if (this.phase !== 'lobby') return null;

    const id = `p${this.nextPlayerNumber++}`;
    const player: Player = { id, name, isBot: false, connected: true, team: null };
    this.players.push(player);
    if (this.hostId === null) this.hostId = id;
    this.emit({ kind: 'playerJoined', playerId: id, name });
    this.broadcastState();
    return id;
  }

  /** Marca a un jugador como desconectado sin quitarlo (puede volver). */
  markDisconnected(playerId: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    player.connected = false;
    this.broadcastState();
  }

  /** true si queda algún humano conectado (para saber si la sala sigue viva). */
  hasConnectedHumans(): boolean {
    return this.players.some((p) => !p.isBot && p.connected);
  }

  // --- Bots -----------------------------------------------------------------

  /** Añade un bot con la dificultad indicada. Solo en el vestíbulo. */
  addBot(difficulty: BotDifficulty): void {
    if (this.phase !== 'lobby') return;
    const id = `bot${this.nextBotNumber++}`;
    this.players.push({
      id,
      name: `Bot ${this.nextBotNumber - 1}`,
      isBot: true,
      connected: true,
      difficulty,
      team: null,
    });
    this.broadcastState();
  }

  /** Quita un bot por su id. Solo en el vestíbulo. */
  removeBot(playerId: string): void {
    if (this.phase !== 'lobby') return;
    const index = this.players.findIndex((p) => p.id === playerId && p.isBot);
    if (index === -1) return;
    this.players.splice(index, 1);
    this.broadcastState();
  }

  // --- Configuración y arranque ---------------------------------------------

  /** Aplica cambios de configuración enviados por el anfitrión (solo en lobby). */
  setConfig(playerId: string, patch: Partial<GameConfig>): void {
    if (this.phase !== 'lobby' || playerId !== this.hostId) return;
    this.config = { ...this.config, ...patch };
    this.broadcastState();
  }

  /**
   * @brief Arranca la partida. Solo el anfitrión puede, y hacen falta al menos
   *        dos participantes (el Password necesita dador y adivinador).
   *
   * Los dos primeros jugadores forman la pareja cooperativa; los roles se
   * alternan cada palabra.
   *
   * @param playerId Quién pide empezar.
   */
  start(playerId: string): void {
    const enLobby = this.phase === 'lobby' || this.phase === 'gameOver';
    if (!enLobby || playerId !== this.hostId) return;
    if (this.players.length < 2) return;

    this.phase = 'playing';
    this.lastSummary = null;
    if (this.timedTimer) clearTimeout(this.timedTimer);
    const participants = this.players.slice(0, 2).map((p) => p.id);
    this.engine = new GameEngine(participants, this.config, this.words, this.engineEmitter());
    this.emit({ kind: 'gameStarted' });
    this.engine.start();
    // Contrarreloj: al agotarse el tiempo, el motor termina la partida.
    if (this.config.ending === 'timed') {
      const engine = this.engine;
      this.timedTimer = setTimeout(() => engine.timeUp(), this.config.durationSeconds * 1000);
    }
  }

  // --- Acciones de juego (delegadas al motor) -------------------------------

  /** Registra una pista del jugador (si la partida está en marcha). */
  clue(playerId: string, text: string): void {
    if (this.phase === 'playing' && this.engine) this.engine.submitClue(playerId, text);
  }

  /** Registra un intento de adivinar. */
  guess(playerId: string, text: string): void {
    if (this.phase === 'playing' && this.engine) this.engine.submitGuess(playerId, text);
  }

  /** Salta la palabra actual. */
  pass(playerId: string): void {
    if (this.phase === 'playing' && this.engine) this.engine.pass(playerId);
  }

  /** Emisor que traduce los avisos del motor a mensajes de red. */
  private engineEmitter(): EngineEmitter {
    return {
      stateChanged: () => this.broadcastState(),
      event: (e) => this.emit(e),
      secret: (playerId, word) => this.transport.sendTo(playerId, { type: 'secret', word }),
      clueRejected: (playerId, reason) => this.transport.sendTo(playerId, { type: 'clueRejected', reason }),
      finished: (summary) => {
        this.phase = 'gameOver';
        this.lastSummary = summary;
        if (this.timedTimer) {
          clearTimeout(this.timedTimer);
          this.timedTimer = null;
        }
        this.transport.broadcast({ type: 'summary', summary });
        this.emit({ kind: 'gameOver' });
        this.broadcastState();
      },
    };
  }

  // --- Vistas y envíos ------------------------------------------------------

  /** Construye la vista pública del estado (la misma para toda la sala). */
  toView(): GameView {
    const players: PlayerView[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      connected: p.connected,
      difficulty: p.difficulty,
      team: p.team,
    }));
    return {
      roomCode: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      config: this.config,
      round: this.phase === 'playing' && this.engine ? this.engine.roundView() : null,
      score: this.engine ? this.engine.scoreView() : null,
      deadline: this.phase === 'playing' && this.engine ? this.engine.deadline : null,
    };
  }

  /** Resumen de la última partida terminada, si lo hay. */
  get summary(): GameSummaryView | null {
    return this.lastSummary;
  }

  /** Reenvía la vista a toda la sala y, si toca a un bot, programa su jugada. */
  private broadcastState(): void {
    this.transport.broadcast({ type: 'state', state: this.toView() });
    this.driveBots();
  }

  // --- Conducción de los bots -----------------------------------------------

  /**
   * Si al turno actual le toca un bot, programa su jugada con un pequeño retardo.
   * Es idempotente: una marca del turno evita programar la misma jugada dos veces
   * aunque el estado se reemita varias veces.
   */
  private driveBots(): void {
    if (this.phase !== 'playing' || !this.engine || this.engine.isFinished) return;
    const round = this.engine.roundView();
    if (!round) return;

    const actorId = round.waitingFor === 'giver' ? round.giverId : round.guesserId;
    const actor = this.players.find((p) => p.id === actorId);
    if (!actor || !actor.isBot) return;

    const token = `${round.index}|${round.waitingFor}|${round.clues.length}|${round.guesses.length}`;
    if (this.pendingBotToken === token) return;
    this.pendingBotToken = token;
    setTimeout(() => void this.runBotTurn(actorId, token), BOT_DELAY_MS);
  }

  /**
   * @brief Ejecuta la jugada de un bot: da una pista (Claude si hay clave, o la
   *        pista preescrita) o adivina (Claude, o la heurística offline).
   *
   * Si el estado ya no coincide con el turno programado (alguien pasó, la ronda
   * cambió), el motor ignora la acción por sus propias comprobaciones, así que no
   * hace falta una verificación perfecta aquí.
   *
   * @param actorId Bot que actúa.
   * @param token Marca del turno para el que se programó, para descartarlo si ya cambió.
   */
  private async runBotTurn(actorId: string, token: string): Promise<void> {
    if (this.phase !== 'playing' || !this.engine || this.engine.isFinished) {
      this.pendingBotToken = null;
      return;
    }
    const round = this.engine.roundView();
    const current = round
      ? `${round.index}|${round.waitingFor}|${round.clues.length}|${round.guesses.length}`
      : '';
    // Liberar la marca antes de actuar: la propia acción reprograma el siguiente turno.
    this.pendingBotToken = null;
    if (!round || current !== token) return;

    const actor = this.players.find((p) => p.id === actorId);
    if (!actor || !actor.isBot) return;
    const difficulty = actor.difficulty ?? 'media';

    if (round.waitingFor === 'giver') {
      const word = this.engine.wordInPlay();
      if (!word) return;
      let clue = aiProvider
        ? await aiProvider.clue(word.palabra, word.categoria, round.clues, this.config.clueRule, this.config.maxClueWords)
        : null;
      // Si Claude no da una pista válida, se recurre a la pista preescrita offline.
      if (clue && !validateClue(clue, word.palabra, this.config.clueRule, this.config, word.prohibidas).ok) {
        clue = null;
      }
      if (!clue) clue = botClue(word, round.clues);
      if (clue) this.engine.submitClue(actorId, clue);
      else this.engine.pass(actorId);
    } else {
      const wrong = round.guesses.filter((g) => !g.correct).map((g) => g.text);
      let guess = aiProvider ? await aiProvider.guess(round.clues, round.category) : null;
      if (!guess) guess = botGuess(round.clues, round.category, this.words, wrong, difficulty);
      if (guess) this.engine.submitGuess(actorId, guess);
      else this.engine.pass(actorId);
    }
  }

  /** Emite un evento puntual a toda la sala. */
  private emit(event: GameEvent): void {
    this.transport.broadcast({ type: 'event', event });
  }
}
