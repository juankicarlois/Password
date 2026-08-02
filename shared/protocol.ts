/**
 * Protocolo compartido entre cliente y servidor del juego del Password.
 *
 * Define los mensajes que viajan por el WebSocket y las "vistas" (estado que el
 * servidor manda al cliente para que lo pinte). El servidor es la única fuente
 * de verdad: el cliente solo pinta lo que recibe y manda intenciones.
 *
 * Nota de accesibilidad: hay estado **público** (lo ve toda la sala) y estado
 * **privado** (solo su dueño). La palabra secreta de una ronda es privada del
 * jugador que da pistas; por eso viaja en un mensaje aparte (`secret`) y nunca
 * en la vista pública que reciben los demás.
 */

// --- Configuración de la partida (la fija el anfitrión en el vestíbulo) ------

/**
 * Regla que deben cumplir las pistas que da el jugador.
 * - `classic`: una sola palabra (Password de toda la vida).
 * - `phrase`: se permite una frase corta (hasta `maxCluewords` palabras).
 */
export type ClueRule = 'classic' | 'phrase';

/**
 * Estructura de la partida. Determina cómo se reparten roles y puntos.
 * - `coop`: una pareja (dos jugadores, o un jugador y la IA) colabora; uno da
 *   pistas y otro adivina, sumando puntos en común.
 * - `duel`: dos parejas compiten por la misma palabra; puntúa quien acierta antes.
 * - `oneVsOne`: dos jugadores alternan; en cada palabra uno da pistas y el otro
 *   adivina, y luego se cambian.
 */
export type GameStructure = 'coop' | 'duel' | 'oneVsOne';

/**
 * Condición de fin de partida.
 * - `wordCount`: se juega una tanda fija de palabras.
 * - `timed`: se juega contra reloj durante una duración fija.
 */
export type GameEnding = 'wordCount' | 'timed';

/** Dificultad de un jugador manejado por la IA. */
export type BotDifficulty = 'facil' | 'media' | 'dificil';

/** Catálogo de dificultades, para pintar los botones del vestíbulo. */
export const BOT_DIFFICULTIES: readonly { id: BotDifficulty; label: string }[] = [
  { id: 'facil', label: 'Fácil' },
  { id: 'media', label: 'Media' },
  { id: 'dificil', label: 'Difícil' },
];

/**
 * Papel que puede desempeñar la IA. La IA puede dar pistas, adivinar o ambos;
 * el rol concreto de cada ronda lo asigna el motor según la estructura.
 */
export type BotRole = 'giver' | 'guesser' | 'both';

/** Configuración completa de una partida, editable en el vestíbulo. */
export interface GameConfig {
  clueRule: ClueRule;
  /** Máximo de palabras por pista en el modo `phrase`. Se ignora en `classic`. */
  maxClueWords: number;
  structure: GameStructure;
  ending: GameEnding;
  /** Palabras de la tanda cuando `ending` es `wordCount`. */
  wordCount: number;
  /** Duración en segundos cuando `ending` es `timed`. */
  durationSeconds: number;
}

/** Configuración por defecto: cooperativa, clásica, tanda de 10 palabras. */
export const DEFAULT_CONFIG: GameConfig = {
  clueRule: 'classic',
  maxClueWords: 3,
  structure: 'coop',
  ending: 'wordCount',
  wordCount: 10,
  durationSeconds: 180,
};

// --- Vistas del estado -------------------------------------------------------

/** Fase en la que se encuentra la partida. */
export type GamePhase = 'lobby' | 'playing' | 'gameOver';

/** Vista pública de un jugador (la ve toda la sala). */
export interface PlayerView {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  /** Solo en bots: su dificultad. */
  difficulty?: BotDifficulty;
  /** Índice de equipo (1..N) cuando la estructura usa equipos; si no, null. */
  team: number | null;
}

/** Vista pública completa del estado de la sala. */
export interface GameView {
  roomCode: string;
  phase: GamePhase;
  /** Quién creó la sala; solo esa persona configura y empieza la partida. */
  hostId: string | null;
  players: PlayerView[];
  config: GameConfig;
}

// --- Eventos puntuales (disparan sonido y anuncio, no pintan estado) ---------

/**
 * Eventos que ocurren en un instante y se anuncian por voz. A diferencia de la
 * vista (que describe "cómo están las cosas ahora"), un evento describe "algo
 * que acaba de pasar" y puede perderse si no se anuncia al llegar.
 */
export type GameEvent =
  | { kind: 'playerJoined'; playerId: string; name: string }
  | { kind: 'playerLeft'; playerId: string; name: string }
  | { kind: 'gameStarted' }
  | { kind: 'gameOver' };

// --- Mensajes del cliente al servidor ---------------------------------------

export type ClientMessage =
  | { type: 'join'; roomCode: string; name: string }
  | { type: 'start' }
  | { type: 'addBot'; difficulty: BotDifficulty }
  | { type: 'removeBot'; playerId: string }
  | { type: 'setConfig'; config: Partial<GameConfig> };

// --- Mensajes del servidor al cliente ---------------------------------------

export type ServerMessage =
  | { type: 'joined'; playerId: string }
  | { type: 'state'; state: GameView }
  | { type: 'event'; event: GameEvent }
  | { type: 'error'; message: string };
