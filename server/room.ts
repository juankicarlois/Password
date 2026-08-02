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
import { GameEngine, type EngineEmitter } from './engine.js';
import type { Word } from './words_repo.js';

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
    const participants = this.players.slice(0, 2).map((p) => p.id);
    this.engine = new GameEngine(participants, this.config, this.words, this.engineEmitter());
    this.emit({ kind: 'gameStarted' });
    this.engine.start();
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
    };
  }

  /** Resumen de la última partida terminada, si lo hay. */
  get summary(): GameSummaryView | null {
    return this.lastSummary;
  }

  /** Reenvía la vista a toda la sala. */
  private broadcastState(): void {
    this.transport.broadcast({ type: 'state', state: this.toView() });
  }

  /** Emite un evento puntual a toda la sala. */
  private emit(event: GameEvent): void {
    this.transport.broadcast({ type: 'event', event });
  }
}
