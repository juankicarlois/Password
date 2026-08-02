/**
 * Motor de una partida cooperativa clásica del Password: reparte la tanda de
 * palabras y lleva el ciclo de cada ronda —dar pistas, adivinar, puntuar— hasta
 * agotar la tanda.
 *
 * El motor es la fuente de verdad de la ronda; no conoce la red. Se comunica con
 * el exterior por un emisor (`EngineEmitter`) que la sala traduce a mensajes:
 * así se puede probar toda la lógica con un emisor de mentira, sin sockets.
 *
 * La palabra secreta es privada del jugador que da pistas: el motor la manda solo
 * a él (`secret`) y nunca la incluye en la vista pública de la ronda.
 */

import {
  checkGuess,
  validateClue,
} from '../shared/rules.js';
import type {
  GameConfig,
  GameEvent,
  GameSummaryView,
  GuessView,
  Role,
  RoundView,
  ScoreView,
} from '../shared/protocol.js';
import { dealWords, type Word } from './words_repo.js';

/**
 * Salida del motor hacia la sala. El motor pide "reemite la vista", "anuncia
 * esto", "manda el secreto a este jugador" o "se acabó"; la sala decide cómo.
 */
export interface EngineEmitter {
  /** El estado de la ronda ha cambiado: la sala debe reemitir la vista. */
  stateChanged(): void;
  /** Un evento puntual para anunciar a la sala. */
  event(e: GameEvent): void;
  /** Manda (o borra, con null) la palabra secreta a un jugador concreto. */
  secret(playerId: string, word: string | null): void;
  /** Avisa en privado al dador de que su pista no vale, con el motivo. */
  clueRejected(playerId: string, reason: string): void;
  /** La partida ha terminado, con su resumen. */
  finished(summary: GameSummaryView): void;
}

/** Puntos base de una palabra acertada a la primera pista. */
const BASE_POINTS = 5;

/**
 * @brief Puntos por acertar una palabra según las pistas que hicieron falta.
 *
 * Menos pistas, más puntos; nunca baja de 1 para que acertar siempre premie.
 *
 * @param cluesUsed Pistas dadas hasta el acierto (al menos 1).
 * @return Puntos ganados.
 */
export function pointsForClues(cluesUsed: number): number {
  return Math.max(1, BASE_POINTS - (cluesUsed - 1));
}

export class GameEngine {
  private readonly deck: Word[];
  /** Índice de la palabra actual dentro de la tanda. */
  private index = 0;
  private clues: string[] = [];
  private guesses: GuessView[] = [];
  private waitingFor: Role = 'giver';
  private points = 0;
  private solved = 0;
  private played = 0;
  /** Suma de pistas usadas en las palabras acertadas, para la media final. */
  private cluesOnSolved = 0;
  private done = false;
  /** Instante (epoch ms) en que acaba el contrarreloj; null si no es por tiempo. */
  private deadlineMs: number | null = null;

  /**
   * @param participants Ids de los dos participantes de la pareja cooperativa.
   * @param config Configuración de la partida (regla de pista, tamaño de tanda).
   * @param words Banco del que repartir la tanda.
   * @param emitter Salida hacia la sala.
   * @param random Fuente de aleatoriedad, inyectable para los tests.
   */
  constructor(
    private readonly participants: string[],
    private readonly config: GameConfig,
    words: Word[],
    private readonly emitter: EngineEmitter,
    random: () => number = Math.random,
  ) {
    // Por tiempo (contrarreloj) se barajan todas las palabras: la tanda no la
    // limita un número sino el reloj. Por número, solo las de la tanda.
    this.deck =
      config.ending === 'timed'
        ? dealWords(words, words.length, random)
        : dealWords(words, config.wordCount, random);
  }

  /** Arranca la partida repartiendo la primera palabra. */
  start(): void {
    if (this.config.ending === 'timed') {
      this.deadlineMs = Date.now() + this.config.durationSeconds * 1000;
    }
    if (this.deck.length === 0) {
      this.finish();
      return;
    }
    this.beginRound();
  }

  /** true si la partida ya terminó. */
  get isFinished(): boolean {
    return this.done;
  }

  /** Instante (epoch ms) en que acaba el contrarreloj, o null si no es por tiempo. */
  get deadline(): number | null {
    return this.deadlineMs;
  }

  /** Fuerza el fin de la partida porque se agotó el tiempo. */
  timeUp(): void {
    this.finish();
  }

  // --- Acceso al estado para la vista de la sala ----------------------------

  /** Palabra en juego, o undefined si no hay ronda activa. */
  private get currentWord(): Word | undefined {
    return this.deck[this.index];
  }

  /**
   * @brief Palabra en juego, para uso interno del servidor (la IA que da pistas
   *        necesita conocerla). No se expone nunca a los clientes.
   * @return La palabra actual, o null si no hay ronda activa.
   */
  wordInPlay(): Word | null {
    return this.done ? null : (this.currentWord ?? null);
  }

  /** Id del dador de la ronda actual (los roles se alternan cada palabra). */
  private get giverId(): string {
    return this.participants[this.index % 2] ?? this.participants[0];
  }

  /** Id del adivinador de la ronda actual. */
  private get guesserId(): string {
    return this.participants[(this.index + 1) % 2] ?? this.participants[0];
  }

  /** Vista pública de la ronda (sin la palabra secreta), o null si no hay. */
  roundView(): RoundView | null {
    const word = this.currentWord;
    if (this.done || !word) return null;
    return {
      index: this.index + 1,
      total: this.config.ending === 'timed' ? 0 : this.deck.length,
      giverId: this.giverId,
      guesserId: this.guesserId,
      category: word.categoria,
      clues: [...this.clues],
      guesses: [...this.guesses],
      waitingFor: this.waitingFor,
    };
  }

  /** Marcador actual de la pareja. */
  scoreView(): ScoreView {
    return { points: this.points, solved: this.solved, played: this.played };
  }

  /**
   * @brief Reenvía la palabra secreta a quien corresponda. Se usa cuando un
   *        jugador se reconecta y el cliente ha perdido su estado privado.
   */
  resendSecrets(): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    this.emitter.secret(this.giverId, word.palabra);
    this.emitter.secret(this.guesserId, null);
  }

  // --- Acciones de los jugadores --------------------------------------------

  /**
   * @brief Registra una pista del dador. Si no cumple las reglas, se le avisa a
   *        él en privado y la ronda no avanza.
   * @param playerId Quién envía la pista.
   * @param text Pista escrita.
   */
  submitClue(playerId: string, text: string): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    if (playerId !== this.giverId || this.waitingFor !== 'giver') return;

    const validation = validateClue(text, word.palabra, this.config.clueRule, this.config, word.prohibidas);
    if (!validation.ok) {
      this.emitter.clueRejected(playerId, validation.reason);
      return;
    }

    this.clues.push(text.trim());
    this.emitter.event({ kind: 'clueGiven', clue: text.trim(), byPlayerId: playerId });
    this.waitingFor = 'guesser';
    this.emitter.stateChanged();
  }

  /**
   * @brief Registra un intento del adivinador. Si acierta, puntúa y pasa de
   *        palabra; si falla, la vez vuelve al dador para otra pista.
   * @param playerId Quién intenta.
   * @param text Palabra propuesta.
   */
  submitGuess(playerId: string, text: string): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    if (playerId !== this.guesserId || this.waitingFor !== 'guesser') return;

    const correct = checkGuess(text, word.palabra);
    this.guesses.push({ playerId, text: text.trim(), correct });
    this.emitter.event({ kind: 'guessMade', text: text.trim(), correct, byPlayerId: playerId });

    if (correct) {
      const gained = pointsForClues(this.clues.length);
      this.points += gained;
      this.solved += 1;
      this.cluesOnSolved += this.clues.length;
      this.emitter.event({ kind: 'wordSolved', word: word.palabra, points: gained });
      this.nextWord();
    } else {
      this.waitingFor = 'giver';
      this.emitter.stateChanged();
    }
  }

  /**
   * @brief Salta la palabra actual sin puntuar. La puede pedir cualquiera de los
   *        dos (el dador no la ve clara, o el adivinador se rinde).
   * @param playerId Quién pide pasar.
   */
  pass(playerId: string): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    if (playerId !== this.giverId && playerId !== this.guesserId) return;
    this.emitter.event({ kind: 'wordSkipped', word: word.palabra });
    this.nextWord();
  }

  // --- Flujo interno --------------------------------------------------------

  /** Prepara y anuncia la ronda de la palabra actual. */
  private beginRound(): void {
    const word = this.currentWord;
    if (!word) {
      this.finish();
      return;
    }
    this.clues = [];
    this.guesses = [];
    this.waitingFor = 'giver';

    this.emitter.event({
      kind: 'roundStarted',
      index: this.index + 1,
      total: this.config.ending === 'timed' ? 0 : this.deck.length,
      category: word.categoria,
      giverId: this.giverId,
      guesserId: this.guesserId,
    });
    // La palabra secreta va solo al dador; al adivinador se le borra por si fue
    // dador en la ronda anterior (los roles se alternan).
    this.emitter.secret(this.giverId, word.palabra);
    this.emitter.secret(this.guesserId, null);
    this.emitter.stateChanged();
  }

  /** Cierra la palabra actual (acertada o pasada) y avanza a la siguiente. */
  private nextWord(): void {
    this.played += 1;
    this.index += 1;
    if (this.index >= this.deck.length) this.finish();
    else this.beginRound();
  }

  /** Termina la partida y entrega el resumen. */
  private finish(): void {
    if (this.done) return;
    this.done = true;
    const avgClues = this.solved > 0 ? Math.round((this.cluesOnSolved / this.solved) * 10) / 10 : 0;
    this.emitter.finished({
      solved: this.solved,
      played: this.played,
      points: this.points,
      avgClues,
    });
  }
}
