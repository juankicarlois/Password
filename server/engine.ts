/**
 * Motor de una partida del Password. Reparte la tanda de palabras y lleva el
 * ciclo de cada ronda —dar pistas, adivinar, puntuar— hasta agotar la tanda o el
 * reloj (contrarreloj).
 *
 * El motor no sabe de estructuras (cooperativa, duelo, uno contra uno): recibe un
 * "plan de juego" (`PlayPlan`) que le dice, para cada palabra, quién da pistas,
 * quién adivina y qué equipo puntúa. Así una sola pieza sirve para todos los
 * modos y el reparto de roles vive en la sala.
 *
 * El motor es la fuente de verdad de la ronda; no conoce la red. Se comunica por
 * un emisor (`EngineEmitter`) que la sala traduce a mensajes, de modo que se
 * puede probar toda la lógica con un emisor de mentira, sin sockets. La palabra
 * secreta es privada del dador: se le manda solo a él y nunca va en la vista.
 */

import { checkGuess, validateClue } from '../shared/rules.js';
import type {
  GameConfig,
  GameEvent,
  GameSummaryView,
  GuessView,
  Role,
  RoundView,
  TeamScoreView,
} from '../shared/protocol.js';
import { dealWords, type Word } from './words_repo.js';

/** Reparto de roles de una palabra: quién da pistas, quién adivina y quién puntúa. */
export interface Matchup {
  giverId: string;
  guesserId: string;
  /** Equipo que se lleva los puntos si se acierta. */
  teamId: string;
}

/** Un equipo, para el marcador y el resumen. */
export interface TeamPlan {
  id: string;
  name: string;
  memberIds: string[];
}

/**
 * Plan de juego: los equipos y una función que, para cada índice de palabra, dice
 * el reparto de roles. La sala lo construye según la estructura elegida.
 */
export interface PlayPlan {
  teams: TeamPlan[];
  matchup: (wordIndex: number) => Matchup;
}

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

/** Marcador interno de un equipo (incluye datos para la media de pistas). */
interface TeamTally {
  points: number;
  solved: number;
  played: number;
  cluesOnSolved: number;
}

export class GameEngine {
  private readonly deck: Word[];
  /** Índice de la palabra actual dentro de la tanda. */
  private index = 0;
  private clues: string[] = [];
  private guesses: GuessView[] = [];
  private waitingFor: Role = 'giver';
  private done = false;
  /** Instante (epoch ms) en que acaba el contrarreloj; null si no es por tiempo. */
  private deadlineMs: number | null = null;
  /** Marcador por equipo, indexado por id de equipo. */
  private readonly tallies = new Map<string, TeamTally>();

  /**
   * @param plan Equipos y reparto de roles por palabra.
   * @param config Configuración de la partida (regla de pista, fin, tamaño).
   * @param words Banco del que repartir la tanda.
   * @param emitter Salida hacia la sala.
   * @param random Fuente de aleatoriedad, inyectable para los tests.
   */
  constructor(
    private readonly plan: PlayPlan,
    private readonly config: GameConfig,
    words: Word[],
    private readonly emitter: EngineEmitter,
    random: () => number = Math.random,
  ) {
    for (const team of plan.teams) {
      this.tallies.set(team.id, { points: 0, solved: 0, played: 0, cluesOnSolved: 0 });
    }
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

  /** Reparto de roles de la palabra actual. */
  private get matchup(): Matchup {
    return this.plan.matchup(this.index);
  }

  /**
   * @brief Palabra en juego, para uso interno del servidor (la IA que da pistas
   *        necesita conocerla). No se expone nunca a los clientes.
   * @return La palabra actual, o null si no hay ronda activa.
   */
  wordInPlay(): Word | null {
    return this.done ? null : (this.currentWord ?? null);
  }

  /** Vista pública de la ronda (sin la palabra secreta), o null si no hay. */
  roundView(): RoundView | null {
    const word = this.currentWord;
    if (this.done || !word) return null;
    const m = this.matchup;
    return {
      index: this.index + 1,
      total: this.config.ending === 'timed' ? 0 : this.deck.length,
      giverId: m.giverId,
      guesserId: m.guesserId,
      teamId: m.teamId,
      category: word.categoria,
      clues: [...this.clues],
      guesses: [...this.guesses],
      waitingFor: this.waitingFor,
    };
  }

  /** Marcador de todos los equipos. */
  scoreViews(): TeamScoreView[] {
    return this.plan.teams.map((team) => {
      const tally = this.tallies.get(team.id)!;
      return {
        id: team.id,
        name: team.name,
        memberIds: [...team.memberIds],
        points: tally.points,
        solved: tally.solved,
        played: tally.played,
      };
    });
  }

  /**
   * @brief Reenvía la palabra secreta a quien corresponda. Se usa cuando un
   *        jugador se reconecta y el cliente ha perdido su estado privado.
   */
  resendSecrets(): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    const m = this.matchup;
    this.emitter.secret(m.giverId, word.palabra);
    this.emitter.secret(m.guesserId, null);
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
    if (playerId !== this.matchup.giverId || this.waitingFor !== 'giver') return;

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
   * @brief Registra un intento del adivinador. Si acierta, puntúa su equipo y se
   *        pasa de palabra; si falla, la vez vuelve al dador para otra pista.
   * @param playerId Quién intenta.
   * @param text Palabra propuesta.
   */
  submitGuess(playerId: string, text: string): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    const m = this.matchup;
    if (playerId !== m.guesserId || this.waitingFor !== 'guesser') return;

    const correct = checkGuess(text, word.palabra);
    this.guesses.push({ playerId, text: text.trim(), correct });
    this.emitter.event({ kind: 'guessMade', text: text.trim(), correct, byPlayerId: playerId });

    if (correct) {
      const gained = pointsForClues(this.clues.length);
      const tally = this.tallies.get(m.teamId)!;
      tally.points += gained;
      tally.solved += 1;
      tally.cluesOnSolved += this.clues.length;
      this.emitter.event({ kind: 'wordSolved', word: word.palabra, points: gained });
      this.nextWord();
    } else {
      this.waitingFor = 'giver';
      this.emitter.stateChanged();
    }
  }

  /**
   * @brief Salta la palabra actual sin puntuar. La puede pedir cualquiera de los
   *        dos de la ronda (el dador no la ve clara, o el adivinador se rinde).
   * @param playerId Quién pide pasar.
   */
  pass(playerId: string): void {
    const word = this.currentWord;
    if (this.done || !word) return;
    const m = this.matchup;
    if (playerId !== m.giverId && playerId !== m.guesserId) return;
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
    const m = this.matchup;

    this.emitter.event({
      kind: 'roundStarted',
      index: this.index + 1,
      total: this.config.ending === 'timed' ? 0 : this.deck.length,
      category: word.categoria,
      giverId: m.giverId,
      guesserId: m.guesserId,
    });
    // La palabra secreta va solo al dador; al adivinador se le borra por si fue
    // dador en la ronda anterior (los roles se alternan).
    this.emitter.secret(m.giverId, word.palabra);
    this.emitter.secret(m.guesserId, null);
    this.emitter.stateChanged();
  }

  /** Cierra la palabra actual (acertada o pasada) y avanza a la siguiente. */
  private nextWord(): void {
    this.tallies.get(this.matchup.teamId)!.played += 1;
    this.index += 1;
    if (this.index >= this.deck.length) this.finish();
    else this.beginRound();
  }

  /** Termina la partida y entrega el resumen con el resultado por equipo. */
  private finish(): void {
    if (this.done) return;
    this.done = true;

    let totalSolved = 0;
    let totalClues = 0;
    let totalPlayed = 0;
    for (const tally of this.tallies.values()) {
      totalSolved += tally.solved;
      totalClues += tally.cluesOnSolved;
      totalPlayed += tally.played;
    }
    const avgClues = totalSolved > 0 ? Math.round((totalClues / totalSolved) * 10) / 10 : 0;

    const teams = this.plan.teams.map((team) => {
      const tally = this.tallies.get(team.id)!;
      return { id: team.id, name: team.name, points: tally.points, solved: tally.solved };
    });

    this.emitter.finished({
      teams,
      played: totalPlayed,
      avgClues,
      winnerTeamId: winner(teams),
    });
  }
}

/**
 * @brief Determina el equipo ganador por puntos.
 *
 * Con un solo equipo (cooperativa) no hay ganador. Con varios, gana el de más
 * puntos; si el máximo está empatado, tampoco hay ganador.
 *
 * @param teams Resultados por equipo.
 * @return Id del ganador, o null si no lo hay.
 */
function winner(teams: readonly { id: string; points: number }[]): string | null {
  if (teams.length <= 1) return null;
  const max = Math.max(...teams.map((t) => t.points));
  const leaders = teams.filter((t) => t.points === max);
  return leaders.length === 1 ? leaders[0].id : null;
}
