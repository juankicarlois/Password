/**
 * Orquestación del cliente: vestíbulo accesible, configuración de la partida y
 * traducción de los eventos del servidor a anuncios para el lector de pantalla.
 *
 * Principio de accesibilidad (heredado del proyecto hermano de trivial): el
 * estado visible controla los mandos; los eventos puntuales controlan los
 * anuncios. Nada del juego depende de ver la pantalla. Los avisos van a una
 * región `aria-live` y se pueden repetir con Alt+número.
 *
 * En esta fase el cliente cubre el vestíbulo. Las pantallas de dar pistas y
 * adivinar se añaden sobre esta base en fases posteriores.
 */

import {
  BOT_DIFFICULTIES,
  type ClueRule,
  type GameConfig,
  type GameEnding,
  type GameEvent,
  type GameStructure,
  type GameSummaryView,
  type GameView,
  type RoundView,
} from '../shared/protocol.js';
import { Net } from './net.js';
import { SoundEngine } from './audio.js';
import { Speech } from './speech.js';
import { ThemeSwitcher } from './theme.js';
import { HelpScreen } from './help.js';
import { MessageHistory, historyIndexFromKey } from './history.js';

/** Motor de efectos de sonido; acompaña a los anuncios de voz, sin sustituirlos. */
const sound = new SoundEngine();
/** Lectura en voz alta opcional (para quien juega sin lector de pantalla). */
const speech = new Speech();
/** Tema visual: automático (el del sistema), claro u oscuro. */
const theme = new ThemeSwitcher();

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
};

const joinScreen = $('join-screen');
const gameScreen = $('game-screen');
const joinForm = $<HTMLFormElement>('join-form');
const roomInput = $<HTMLInputElement>('room-input');
const nameInput = $<HTMLInputElement>('name-input');
const joinError = $('join-error');
const roomLabel = $('room-label');
const announceRegion = $('announce');
const historyRegion = $('history');
const statusLine = $('status');
const clockLine = $('clock');
const muteButton = $<HTMLButtonElement>('btn-mute');
const speakButton = $<HTMLButtonElement>('btn-speak');
const playersTitle = $('players-title');
const playersList = $('players');
const configSection = $('config-section');
const actions = $('actions');

// --- Estado local -----------------------------------------------------------

let myId: string | null = null;
let roomCode = '';
let myName = '';
let lastState: GameView | null = null;
let lastActionKey = '';
/** Palabra secreta de la ronda: solo la tiene el dador. La borra un `secret` null. */
let secretWord: string | null = null;
/** Resumen de la última partida, para pintarlo en la pantalla de fin. */
let lastSummary: GameSummaryView | null = null;
/** Estado de la cuenta atrás del contrarreloj. */
let countdownTimer: number | null = null;
let currentDeadline: number | null = null;
/** Umbrales de tiempo (segundos) ya anunciados en esta cuenta atrás. */
let announcedThresholds = new Set<number>();
/** Alterna un carácter invisible para forzar que el lector repita anuncios. */
let announceToggle = false;
let historyToggle = false;
/** Avisos acumulados de la ráfaga actual, pendientes de anunciarse juntos. */
let pendingAnnouncements: string[] = [];
let announceTimer: number | null = null;
/** Ventana de agrupación: cubre los avisos de una acción sin notarse lento. */
const ANNOUNCE_BATCH_MS = 150;
const messageHistory = new MessageHistory();

// --- Red --------------------------------------------------------------------

const net = new Net({
  onOpen: () => {
    if (roomCode && myName) net.send({ type: 'join', roomCode, name: myName });
  },
  onMessage: (message) => {
    switch (message.type) {
      case 'joined':
        myId = message.playerId;
        showGameScreen();
        break;
      case 'state':
        lastState = message.state;
        render(message.state);
        break;
      case 'event':
        handleEvent(message.event);
        break;
      case 'secret':
        secretWord = message.word;
        if (lastState) renderActions(lastState);
        break;
      case 'clueRejected':
        announce(`Pista no válida. ${message.reason}`);
        break;
      case 'summary':
        lastSummary = message.summary;
        announce(spokenSummary(message.summary));
        if (lastState) renderActions(lastState);
        break;
      case 'error':
        showError(message.message);
        break;
    }
  },
  onClose: () => {
    const message = 'Conexión perdida. Reintentando…';
    if (gameScreen.hidden) joinError.textContent = message;
    else announce(message);
  },
});
net.connect();

// --- Vestíbulo --------------------------------------------------------------

joinForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const code = roomInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!code || !name) {
    showError('Escribe un código de sala y tu nombre.');
    return;
  }
  roomCode = code;
  myName = name;
  if (!net.send({ type: 'join', roomCode, name })) {
    joinError.textContent = 'Conectando con el servidor… entrarás en cuanto haya conexión.';
  }
});

function showGameScreen(): void {
  joinScreen.hidden = true;
  gameScreen.hidden = false;
  roomLabel.textContent = roomCode;
}

function showError(message: string): void {
  if (!gameScreen.hidden) announce(message);
  else joinError.textContent = message;
}

// --- Anuncios ---------------------------------------------------------------

/**
 * @brief Encola un aviso para que el lector de pantalla lo pronuncie.
 *
 * Una sola acción puede generar varios avisos casi a la vez; si cada uno se
 * escribiera directo en la región aria-live, el siguiente pisaría al anterior.
 * Por eso se agrupan y se anuncian juntos, en orden, como una sola frase.
 */
function announce(text: string): void {
  pendingAnnouncements.push(text);
  if (announceTimer !== null) return;
  announceTimer = window.setTimeout(flushAnnouncements, ANNOUNCE_BATCH_MS);
}

function flushAnnouncements(): void {
  announceTimer = null;
  const text = pendingAnnouncements.join(' ');
  pendingAnnouncements = [];
  messageHistory.record(text);
  // El carácter invisible alterna el contenido: si el texto fuese idéntico al
  // anterior, el lector no lo repetiría.
  announceToggle = !announceToggle;
  announceRegion.textContent = announceToggle ? text : text + '​';
  // Lectura en voz alta opcional (para quien juega sin lector de pantalla).
  speech.speak(text);
}

function nameOf(playerId: string): string {
  return lastState?.players.find((p) => p.id === playerId)?.name ?? 'Alguien';
}

// --- Eventos → anuncio ------------------------------------------------------

function handleEvent(event: GameEvent): void {
  switch (event.kind) {
    case 'playerJoined':
      if (event.playerId !== myId) {
        sound.play('join');
        announce(`${event.name} se ha unido a la sala.`);
      }
      break;
    case 'playerLeft':
      announce(`${nameOf(event.playerId)} ha salido de la sala.`);
      break;
    case 'gameStarted':
      lastSummary = null;
      sound.play('start');
      announce('¡Empieza la partida!');
      break;
    case 'roundStarted': {
      // El comienzo de partida ya suena con 'start'; a partir de la segunda palabra
      // se marca el cambio de ronda para no encadenar dos efectos a la vez.
      if (event.index > 1) sound.play('round');
      const daPistas = event.giverId === myId ? 'Tú das las pistas' : `Da pistas ${nameOf(event.giverId)}`;
      const adivina = event.guesserId === myId ? 'tú adivinas' : `adivina ${nameOf(event.guesserId)}`;
      const cual = event.total > 0 ? `Palabra ${event.index} de ${event.total}` : `Palabra ${event.index}`;
      announce(`${cual}. Categoría: ${event.category}. ${daPistas} y ${adivina}.`);
      break;
    }
    case 'clueGiven':
      // A quien da la pista se lo confirma su propio repintado; a los demás se les
      // canta la pista nueva, que es lo que necesita el que adivina.
      if (event.byPlayerId !== myId) {
        sound.play('clue');
        announce(`Pista: ${event.clue}.`);
      }
      break;
    case 'guessMade':
      // El acierto lo anuncia `wordSolved` (con la palabra); aquí solo los fallos.
      if (!event.correct) {
        sound.play('wrong');
        announce(
          event.byPlayerId === myId
            ? `${event.text}: no es. Sigue con más pistas.`
            : `${nameOf(event.byPlayerId)} prueba ${event.text}: no es.`,
        );
      }
      break;
    case 'wordSolved':
      sound.play('correct');
      announce(`¡Correcto! La palabra era ${event.word}. ${event.points} punto${event.points === 1 ? '' : 's'}.`);
      break;
    case 'wordSkipped':
      announce(`Palabra saltada. Era: ${event.word}.`);
      break;
    case 'gameOver':
      // El resumen llega en su propio mensaje y ya se anuncia allí.
      sound.play('gameover');
      break;
  }
}

// --- Render -----------------------------------------------------------------

function render(state: GameView): void {
  renderStatus(state);
  renderClock(state);
  renderPlayers(state);
  renderConfig(state);
  renderActions(state);
}

/**
 * Gestiona la cuenta atrás del contrarreloj: la arranca cuando empieza una
 * partida por tiempo y la para al terminar. El reloj se actualiza solo, al
 * margen de los repintados de estado, y anuncia por voz los últimos avisos.
 */
function renderClock(state: GameView): void {
  const timed = state.phase === 'playing' && state.config.ending === 'timed' && state.deadline != null;
  if (!timed) {
    stopCountdown();
    return;
  }
  if (state.deadline !== currentDeadline) {
    currentDeadline = state.deadline;
    startCountdown(state.deadline!);
  }
}

/** Segundos en los que se avisa por voz de cuánto queda. */
const TIME_WARNINGS = [60, 30, 10];

function startCountdown(deadline: number): void {
  stopCountdown();
  announcedThresholds = new Set();
  clockLine.hidden = false;
  const tick = (): void => {
    const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    clockLine.textContent = `Tiempo restante: ${formatTime(remaining)}.`;
    for (const t of TIME_WARNINGS) {
      if (remaining <= t && remaining > 0 && !announcedThresholds.has(t)) {
        announcedThresholds.add(t);
        sound.play('warn');
        announce(`Quedan ${t} segundos.`);
      }
    }
    if (remaining <= 0) {
      sound.play('timeup');
      stopCountdown(false); // el servidor cierra la partida
    }
  };
  tick();
  countdownTimer = window.setInterval(tick, 500);
}

function stopCountdown(hide = true): void {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (hide) {
    clockLine.hidden = true;
    currentDeadline = null;
  }
}

/** Formatea segundos como minutos y segundos (p. ej. 1:05). */
function formatTime(totalSeconds: number): string {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function renderStatus(state: GameView): void {
  let text: string;
  switch (state.phase) {
    case 'lobby':
      text = `Sala ${state.roomCode}. ${state.players.length} jugador(es). Esperando para empezar.`;
      break;
    case 'playing': {
      const round = state.round;
      if (!round) {
        text = 'Partida en curso.';
        break;
      }
      const rol = round.giverId === myId ? 'das pistas' : round.guesserId === myId ? 'adivinas' : 'miras';
      const cual = round.total > 0 ? `Palabra ${round.index} de ${round.total}` : `Palabra ${round.index}`;
      text = `${cual}. Categoría: ${round.category}. Tú ${rol}.${scoreboardSuffix(state)}`;
      break;
    }
    case 'gameOver':
      text = `Fin de la partida.${scoreboardSuffix(state)}`;
      break;
  }
  statusLine.textContent = text;
}

/**
 * Coletilla de marcador para la línea de estado. En cooperativa, los puntos de la
 * pareja; en competitivo, un marcador compacto de todos los equipos.
 */
function scoreboardSuffix(state: GameView): string {
  if (state.scores.length === 0) return '';
  if (state.scores.length === 1) {
    const t = state.scores[0];
    return ` Puntos: ${t.points} (${t.solved} acertadas).`;
  }
  return ` Marcador: ${state.scores.map((t) => `${t.name}, ${t.points}`).join('; ')}.`;
}

/**
 * true si se está preparando una partida: en el vestíbulo o con una ya
 * terminada. Al acabar se puede volver a jugar, así que se vuelven a ofrecer la
 * configuración, los bots y el reparto de equipos; si no, habría que crear otra
 * sala solo para cambiar de modo.
 */
function preparandoPartida(state: GameView): boolean {
  return state.phase === 'lobby' || state.phase === 'gameOver';
}

function renderPlayers(state: GameView): void {
  // Preparando partida se listan los jugadores (con su equipo y mandos); en
  // partida, el marcador por equipo, que es lo que de verdad compite. Al acabar
  // el resultado ya lo cuenta el resumen, así que la lista vuelve a ser la de
  // preparar la siguiente.
  if (preparandoPartida(state)) {
    renderLobbyPlayers(state);
  } else {
    renderScoreboard(state);
  }
}

/** Lista de jugadores del vestíbulo, con selección de pareja en el duelo. */
function renderLobbyPlayers(state: GameView): void {
  playersTitle.textContent = 'Jugadores';
  playersList.replaceChildren();
  const soyAnfitrion = state.hostId != null && state.hostId === myId;
  const esDuelo = state.config.structure === 'duel';

  for (const player of state.players) {
    const li = document.createElement('li');
    li.className = 'player';

    const name = document.createElement('span');
    name.className = 'name';
    const tag = player.isBot
      ? ` (bot${player.difficulty ? ', ' + difficultyLabel(player.difficulty) : ''})`
      : player.id === myId
        ? ' (tú)'
        : player.id === state.hostId
          ? ' (anfitrión)'
          : '';
    name.textContent = player.name + tag;
    li.append(name);

    if (esDuelo) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = player.team ? `Equipo ${player.team}` : 'sin equipo';
      li.append(meta);
    }

    if (!player.connected && !player.isBot) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = 'desconectado';
      li.append(meta);
    }

    // En el duelo se elige la pareja: tú la tuya; el anfitrión, la de los bots.
    if (esDuelo && (player.id === myId || (player.isBot && soyAnfitrion))) {
      li.append(buildTeamPicker(player.id, player.team, player.id === myId));
    }

    // El anfitrión puede quitar bots durante el vestíbulo.
    if (player.isBot && soyAnfitrion) {
      const remove = button('Quitar', () => net.send({ type: 'removeBot', playerId: player.id }), 'secondary');
      remove.setAttribute('aria-label', `Quitar ${player.name}`);
      li.append(remove);
    }

    playersList.append(li);
  }
}

/** Botones para elegir el equipo (1 o 2) de un jugador o bot en el duelo. */
function buildTeamPicker(playerId: string, current: number | null, isMe: boolean): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'team-picker';
  for (let n = 1; n <= 2; n++) {
    const btn = button(
      `Equipo ${n}`,
      () => net.send(isMe ? { type: 'chooseTeam', team: n } : { type: 'setBotTeam', playerId, team: n }),
      'secondary',
    );
    btn.setAttribute('aria-label', `Poner en el equipo ${n}`);
    if (current === n) btn.setAttribute('aria-pressed', 'true');
    wrap.append(btn);
  }
  return wrap;
}

/** Marcador por equipo durante la partida y al terminar. */
function renderScoreboard(state: GameView): void {
  const varios = state.scores.length > 1;
  playersTitle.textContent = varios ? 'Marcador' : 'Jugadores';
  playersList.replaceChildren();

  for (const team of state.scores) {
    const li = document.createElement('li');
    const activo = state.round?.teamId === team.id;
    li.className = 'player' + (activo ? ' current' : '');

    const name = document.createElement('span');
    name.className = 'name';
    const mio = myId != null && team.memberIds.includes(myId);
    // En parejas se nombran los miembros; en individual el nombre ya es la persona.
    const quienes = varios ? team.memberIds.map((id) => nameOf(id)).join(' y ') : '';
    name.textContent = team.name + (mio ? ' (tú)' : '') + (quienes && quienes !== team.name ? ` · ${quienes}` : '');
    li.append(name);

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${team.points} punto${team.points === 1 ? '' : 's'}, ${team.solved} acertada${team.solved === 1 ? '' : 's'}`;
    li.append(meta);

    playersList.append(li);
  }
}

/**
 * Panel de configuración de la partida. Solo el anfitrión lo edita; a los demás
 * se les muestra la configuración elegida en texto, para que sepan a qué van a
 * jugar. Solo se oculta con una partida en marcha, porque los ajustes no cambian
 * a media partida; al terminar vuelve, para poder montar la siguiente distinta.
 */
function renderConfig(state: GameView): void {
  configSection.hidden = !preparandoPartida(state);
  if (!preparandoPartida(state)) return;

  const soyAnfitrion = state.hostId != null && state.hostId === myId;
  configSection.replaceChildren();

  const title = document.createElement('h2');
  title.textContent = 'Configuración de la partida';
  configSection.append(title);

  if (!soyAnfitrion) {
    const info = document.createElement('p');
    info.className = 'hint';
    info.textContent = `${describeConfig(state.config)} (lo decide quien creó la sala).`;
    configSection.append(info);
    return;
  }

  configSection.append(
    choiceRow<ClueRule>('Reglas de pista', state.config.clueRule, [
      { id: 'classic', label: 'Clásica: una palabra' },
      { id: 'phrase', label: 'Frase corta' },
    ], (clueRule) => net.send({ type: 'setConfig', config: { clueRule } })),
  );

  // Con "frase corta", cuántas palabras se permiten como máximo por pista.
  if (state.config.clueRule === 'phrase') {
    configSection.append(
      numberRow('Palabras por pista', state.config.maxClueWords, [2, 3, 4], (n) =>
        net.send({ type: 'setConfig', config: { maxClueWords: n } }),
      ),
    );
  }

  configSection.append(
    choiceRow<GameStructure>('Estructura', state.config.structure, [
      { id: 'coop', label: 'Cooperativa' },
      { id: 'oneVsOne', label: 'Uno contra uno' },
      { id: 'duel', label: 'Duelo de parejas' },
    ], (structure) => net.send({ type: 'setConfig', config: { structure } })),
    choiceRow<GameEnding>('Fin de partida', state.config.ending, [
      { id: 'wordCount', label: 'Tanda de palabras' },
      { id: 'timed', label: 'Contrarreloj' },
    ], (ending) => net.send({ type: 'setConfig', config: { ending } })),
  );

  // El detalle del fin: cuántas palabras (tanda) o cuánto tiempo (contrarreloj).
  if (state.config.ending === 'wordCount') {
    configSection.append(
      numberRow('Cuántas palabras', state.config.wordCount, [5, 10, 15, 20], (n) =>
        net.send({ type: 'setConfig', config: { wordCount: n } }),
      ),
    );
  } else {
    configSection.append(
      numberRow(
        'Duración',
        state.config.durationSeconds,
        [60, 120, 180, 300],
        (n) => net.send({ type: 'setConfig', config: { durationSeconds: n } }),
        (n) => `${n / 60} min`,
      ),
    );
  }

  // Requisitos de participantes según la estructura, para saber qué falta.
  const req = document.createElement('p');
  req.className = 'hint';
  if (state.config.structure === 'oneVsOne') {
    req.textContent = 'Uno contra uno: exactamente dos jugadores; puntúa quien adivina.';
  } else if (state.config.structure === 'duel') {
    req.textContent = 'Duelo: cuatro jugadores repartidos en dos parejas (dos y dos). Asigna el equipo de cada uno abajo.';
  } else {
    req.textContent = 'Cooperativa: dos jugadores que colaboran con un marcador común.';
  }
  configSection.append(req);
}

/**
 * @brief Fila para elegir un valor numérico entre varios (mismo patrón accesible
 *        que `choiceRow`, con `aria-pressed`).
 *
 * @param label Nombre del grupo.
 * @param current Valor seleccionado ahora.
 * @param values Valores posibles.
 * @param onPick Qué hacer al elegir uno.
 * @param format Cómo mostrar cada valor (por defecto, el número tal cual).
 */
function numberRow(
  label: string,
  current: number,
  values: readonly number[],
  onPick: (value: number) => void,
  format: (value: number) => string = (v) => String(v),
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config-row';
  const legend = document.createElement('p');
  legend.className = 'config-legend';
  legend.id = `cfg-${label.replace(/\s+/g, '-').toLowerCase()}`;
  legend.textContent = label;
  wrap.append(legend);

  const row = document.createElement('div');
  row.className = 'action-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', legend.id);
  for (const value of values) {
    const btn = button(format(value), () => onPick(value), 'secondary');
    if (value === current) btn.setAttribute('aria-pressed', 'true');
    row.append(btn);
  }
  wrap.append(row);
  return wrap;
}

/** Frase con la configuración elegida, para informar a quien no es anfitrión. */
function describeConfig(config: GameConfig): string {
  const regla = config.clueRule === 'classic' ? 'pista de una palabra' : 'pista de frase corta';
  const estructura =
    config.structure === 'coop' ? 'cooperativa' : config.structure === 'duel' ? 'duelo de parejas' : 'uno contra uno';
  const fin = config.ending === 'wordCount' ? `tanda de ${config.wordCount} palabras` : `contrarreloj de ${config.durationSeconds} segundos`;
  return `Partida ${estructura}, ${regla}, ${fin}`;
}

/**
 * @brief Fila de botones para elegir una opción entre varias (patrón "grupo de
 *        botones" con `aria-pressed`), accesible con lector de pantalla.
 *
 * @param label Nombre del grupo (rótulo del `role="group"`).
 * @param current Valor seleccionado ahora.
 * @param options Opciones posibles.
 * @param onPick Qué hacer al elegir una.
 */
function choiceRow<T extends string>(
  label: string,
  current: T,
  options: readonly { id: T; label: string }[],
  onPick: (id: T) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'config-row';

  const legend = document.createElement('p');
  legend.className = 'config-legend';
  legend.id = `cfg-${label.replace(/\s+/g, '-').toLowerCase()}`;
  legend.textContent = label;
  wrap.append(legend);

  const row = document.createElement('div');
  row.className = 'action-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-labelledby', legend.id);
  for (const opt of options) {
    const btn = button(opt.label, () => onPick(opt.id), 'secondary');
    if (opt.id === current) btn.setAttribute('aria-pressed', 'true');
    row.append(btn);
  }
  wrap.append(row);
  return wrap;
}

function difficultyLabel(id: string): string {
  return BOT_DIFFICULTIES.find((d) => d.id === id)?.label ?? id;
}

// --- Acciones ---------------------------------------------------------------

/** Fila de botones para añadir bots; sirve igual antes y después de una partida. */
function buildBotRow(): HTMLElement {
  const bots = document.createElement('div');
  bots.className = 'action-row';
  bots.setAttribute('role', 'group');
  bots.setAttribute('aria-label', 'Añadir bot');
  for (const diff of BOT_DIFFICULTIES) {
    const botBtn = button(
      `Añadir bot ${diff.label.toLowerCase()}`,
      () => net.send({ type: 'addBot', difficulty: diff.id }),
      'secondary',
    );
    botBtn.id = `add-bot-${diff.id}`;
    bots.append(botBtn);
  }
  return bots;
}

function renderActions(state: GameView): void {
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  actions.replaceChildren();
  const soyAnfitrion = state.hostId != null && state.hostId === myId;
  let focusTarget: HTMLElement | null = null;

  if (state.phase === 'lobby') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = soyAnfitrion
      ? 'Comparte el código de la sala. Añade bots para jugar en solitario o rellenar. Cuando estéis, pulsa Empezar.'
      : 'Comparte el código de la sala con quien quieras que juegue. Quien creó la sala empezará la partida.';
    actions.append(hint);

    if (soyAnfitrion) {
      actions.append(buildBotRow());

      const startBtn = button('Empezar partida', () => net.send({ type: 'start' }));
      startBtn.id = 'start-game';
      startBtn.disabled = state.players.length < 2;
      if (startBtn.disabled) startBtn.title = 'Hacen falta al menos dos participantes.';
      actions.append(startBtn);
      focusTarget = startBtn;
    }
  } else if (state.phase === 'playing' && state.round) {
    focusTarget = renderPlaying(state.round);
  } else if (state.phase === 'gameOver') {
    if (lastSummary) actions.append(buildSummaryPanel(lastSummary));
    if (soyAnfitrion) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent =
        'Puedes cambiar la configuración de arriba, añadir o quitar bots, y volver a jugar.';
      actions.append(hint, buildBotRow());

      const again = button('Jugar otra vez', () => net.send({ type: 'start' }));
      again.id = 'play-again';
      again.disabled = state.players.length < 2;
      if (again.disabled) again.title = 'Hacen falta al menos dos participantes.';
      actions.append(again);
      focusTarget = again;
    }
  }

  manageFocus(state, focusTarget, focusedId);
}

/**
 * Pinta la pantalla de juego según el papel de este jugador en la ronda: el
 * dador ve la palabra secreta y da pistas; el adivinador ve las pistas y prueba;
 * quien no juega esta ronda mira. Devuelve el mando que debe recibir el foco.
 *
 * @param round Ronda en curso.
 * @return Elemento a enfocar, o null.
 */
function renderPlaying(round: RoundView): HTMLElement | null {
  const soyDador = round.giverId === myId;
  const soyAdivinador = round.guesserId === myId;

  // Historial de pistas e intentos, común a los tres papeles: es la información
  // que sostiene la ronda y debe verse (y oírse) en cualquier momento. Los
  // intentos van también en pantalla, no solo por voz, para que quien ve siga
  // lo que se ha probado.
  const roundInfo = document.createDocumentFragment();
  roundInfo.append(buildCluesList(round));
  const guessesBlock = buildGuessesList(round);
  if (guessesBlock) roundInfo.append(guessesBlock);

  if (soyDador) {
    const secret = document.createElement('p');
    secret.className = 'secret-word';
    secret.textContent = secretWord
      ? `Palabra secreta: ${secretWord}. Categoría: ${round.category}.`
      : `Categoría: ${round.category}. (Esperando la palabra…)`;
    actions.append(secret, roundInfo);

    if (round.waitingFor === 'giver') {
      const reglaHint = document.createElement('p');
      reglaHint.className = 'hint';
      const rule = lastState?.config;
      reglaHint.textContent =
        rule && rule.clueRule === 'phrase'
          ? `Escribe una pista de hasta ${rule.maxClueWords} palabras que ayude a adivinar, sin decir la palabra secreta.`
          : 'Escribe una pista de una sola palabra que ayude a adivinar, sin decir la palabra secreta.';
      const field = formField('Tu pista', 'Enviar pista', (value) => net.send({ type: 'clue', text: value }));
      actions.append(reglaHint, field.wrap);
      actions.append(passButton());
      return field.input;
    }
    const wait = document.createElement('p');
    wait.className = 'hint';
    wait.textContent = `Pista enviada. Esperando a que ${nameOf(round.guesserId)} adivine…`;
    actions.append(wait, passButton());
    return null;
  }

  if (soyAdivinador) {
    const catLine = document.createElement('p');
    catLine.className = 'hint';
    catLine.textContent = `Categoría: ${round.category}. Escucha las pistas y adivina la palabra.`;
    actions.append(catLine, roundInfo);

    if (round.waitingFor === 'guesser') {
      const field = formField('Tu respuesta', 'Adivinar', (value) => net.send({ type: 'guess', text: value }));
      actions.append(field.wrap, passButton());
      return field.input;
    }
    const wait = document.createElement('p');
    wait.className = 'hint';
    wait.textContent = `Esperando la pista de ${nameOf(round.giverId)}…`;
    actions.append(wait, passButton());
    return null;
  }

  // Espectador: no juega esta ronda, pero sigue la partida.
  const info = document.createElement('p');
  info.className = 'hint';
  info.textContent = `Da pistas ${nameOf(round.giverId)} y adivina ${nameOf(round.guesserId)}. Categoría: ${round.category}.`;
  actions.append(info, roundInfo);
  return null;
}

/** Lista de las pistas dadas hasta ahora, numeradas, o un aviso si no hay. */
function buildCluesList(round: RoundView): HTMLElement {
  const wrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'clues-title';
  title.textContent = `Pistas (${round.clues.length})`;
  wrap.append(title);

  if (round.clues.length === 0) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = 'Todavía no hay pistas.';
    wrap.append(none);
    return wrap;
  }
  const list = document.createElement('ol');
  list.className = 'clues';
  for (const clue of round.clues) {
    const li = document.createElement('li');
    li.textContent = clue;
    list.append(li);
  }
  wrap.append(list);
  return wrap;
}

/**
 * Lista de intentos hechos en la ronda, para que TODOS (dador, adivinador y
 * espectador) vean lo que se ha probado, no solo lo oigan. El resultado se dice
 * con palabras ("acierto" / "no es"), nunca solo con color, para que se entienda
 * sin ver. Devuelve null si aún no hay intentos.
 */
function buildGuessesList(round: RoundView): HTMLElement | null {
  if (round.guesses.length === 0) return null;
  const wrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'clues-title';
  title.textContent = `Intentos (${round.guesses.length})`;
  wrap.append(title);

  const list = document.createElement('ul');
  list.className = 'guesses';
  for (const guess of round.guesses) {
    const li = document.createElement('li');
    li.className = 'guess' + (guess.correct ? ' correct' : ' wrong');
    const quien = guess.playerId === myId ? 'Tú' : nameOf(guess.playerId);
    li.textContent = `${quien}: ${guess.text} — ${guess.correct ? 'acierto' : 'no es'}`;
    list.append(li);
  }
  wrap.append(list);
  return wrap;
}

/** Botón para pasar de palabra, disponible para dador y adivinador. */
function passButton(): HTMLButtonElement {
  return button('Pasar palabra', () => net.send({ type: 'pass' }), 'secondary');
}

/**
 * @brief Campo de texto con su botón de envío, accesible: etiqueta asociada,
 *        envío con Enter o con el botón, y se vacía tras enviar.
 *
 * @param labelText Rótulo del campo.
 * @param buttonText Texto del botón de envío.
 * @param onSubmit Qué hacer con el valor (no se llama si está vacío).
 * @return El contenedor y el input (para poder enfocarlo).
 */
function formField(
  labelText: string,
  buttonText: string,
  onSubmit: (value: string) => void,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const form = document.createElement('form');
  form.className = 'play-form';

  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.maxLength = 40;
  input.id = 'play-input';
  label.htmlFor = input.id;
  label.textContent = labelText;
  field.append(label, input);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = buttonText;

  form.append(field, submit);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    onSubmit(value);
    input.value = '';
  });
  return { wrap: form, input };
}

// --- Resumen final ----------------------------------------------------------

/** Nombre del equipo ganador, o null si no lo hay. */
function winnerName(s: GameSummaryView): string | null {
  if (!s.winnerTeamId) return null;
  return s.teams.find((t) => t.id === s.winnerTeamId)?.name ?? null;
}

/** Frases del resumen; se comparten entre la voz y el panel visible. */
function summaryLines(s: GameSummaryView): string[] {
  const lines: string[] = [];
  if (s.teams.length > 1) {
    // Competitivo: primero el resultado (ganador o empate), luego cada equipo.
    const ganador = winnerName(s);
    lines.push(ganador ? `Gana ${ganador}.` : 'Empate.');
    for (const t of s.teams) {
      lines.push(`${t.name}: ${t.points} punto${t.points === 1 ? '' : 's'}, ${t.solved} acertada${t.solved === 1 ? '' : 's'}.`);
    }
  } else {
    // Cooperativo: los datos de la única pareja.
    const t = s.teams[0];
    if (t) lines.push(`Palabras acertadas: ${t.solved} de ${s.played}. Puntos: ${t.points}.`);
  }
  if (s.avgClues > 0) lines.push(`Pistas de media por acierto: ${s.avgClues}.`);
  return lines;
}

/** Texto hablado del resumen (una sola frase), para el lector al acabar. */
function spokenSummary(s: GameSummaryView): string {
  const cabecera = winnerName(s) ? `¡${winnerName(s)} gana!` : 'Se acabó.';
  return `${cabecera} Resumen: ${summaryLines(s).join(' ')}`;
}

/** Panel visible del resumen para la pantalla de fin de partida. */
function buildSummaryPanel(s: GameSummaryView): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'summary';
  panel.setAttribute('aria-label', 'Resumen de la partida');
  const title = document.createElement('h3');
  title.textContent = 'Resumen de la partida';
  panel.append(title);
  const list = document.createElement('ul');
  for (const linea of summaryLines(s)) {
    const li = document.createElement('li');
    li.textContent = linea;
    list.append(li);
  }
  panel.append(list);
  return panel;
}

/**
 * Mueve el foco al mando principal solo cuando cambia el conjunto de acciones,
 * para no robar el foco en cada actualización de estado.
 */
function manageFocus(state: GameView, target: HTMLElement | null, previousFocusId: string): void {
  const round = state.round;
  const key = [
    state.phase,
    state.players.length,
    state.hostId ?? '',
    // Dentro de una partida, cada cambio de turno o de pista es una acción nueva:
    // así el foco baja al campo de pista o de respuesta en cuanto aparece.
    round ? `${round.index}|${round.waitingFor}|${round.giverId}|${round.clues.length}` : '',
  ].join('|');
  if (key !== lastActionKey && target) {
    target.focus();
  } else if (key === lastActionKey && previousFocusId) {
    document.getElementById(previousFocusId)?.focus();
  }
  lastActionKey = key;
}

// --- Repetición de avisos (Alt+número) --------------------------------------

function announceHistory(n: number): void {
  const text = messageHistory.recall(n);
  historyToggle = !historyToggle;
  historyRegion.textContent = historyToggle ? text : text + '​';
}

document.addEventListener('keydown', (ev) => {
  // Alt+número repite un aviso ya dicho: Alt+1 el último, Alt+0 el décimo. Con
  // Alt sí llega, porque el lector no lo captura como navegación rápida.
  if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    const n = historyIndexFromKey(ev.key, ev.code);
    if (n !== null) {
      ev.preventDefault();
      announceHistory(n);
    }
  }
});

// --- Silenciar / activar sonidos --------------------------------------------

/** Refleja en el botón si los sonidos están activos o silenciados. */
function updateMuteButton(): void {
  muteButton.textContent = sound.isMuted ? 'Activar sonidos' : 'Silenciar sonidos';
  muteButton.setAttribute('aria-pressed', String(sound.isMuted));
}
muteButton.addEventListener('click', () => {
  const muted = sound.toggleMuted();
  updateMuteButton();
  announce(muted ? 'Sonidos silenciados.' : 'Sonidos activados.');
});
updateMuteButton();

/** Refleja en el botón si la lectura en voz alta está activa. Se oculta si el
 *  navegador no ofrece síntesis de voz. */
function updateSpeakButton(): void {
  if (!speech.available) {
    speakButton.hidden = true;
    return;
  }
  speakButton.textContent = speech.isEnabled ? 'No leer en voz alta' : 'Leer en voz alta';
  speakButton.setAttribute('aria-pressed', String(speech.isEnabled));
}
speakButton.addEventListener('click', () => {
  const enabled = speech.toggle();
  updateSpeakButton();
  announce(enabled ? 'Lectura en voz alta activada.' : 'Lectura en voz alta desactivada.');
});
updateSpeakButton();

// --- Tema visual ------------------------------------------------------------

/**
 * Botones del tema, uno en el vestíbulo y otro en la partida. Los dos hacen lo
 * mismo y muestran siempre el tema activo, para que se sepa en cuál se está sin
 * tener que mirar la pantalla.
 */
const themeButtons = [$<HTMLButtonElement>('btn-theme-join'), $<HTMLButtonElement>('btn-theme-game')];

function updateThemeButtons(): void {
  for (const btn of themeButtons) btn.textContent = `Tema: ${theme.label}`;
}
for (const btn of themeButtons) {
  btn.addEventListener('click', () => {
    theme.next();
    updateThemeButtons();
    announce(
      theme.current === 'auto'
        ? 'Tema automático: el que tenga tu sistema.'
        : `Tema ${theme.label}.`,
    );
  });
}
updateThemeButtons();

/** Manual "cómo se juega", superpuesto a la pantalla que hubiera. */
const help = new HelpScreen({ help: $('help-screen'), others: [joinScreen, gameScreen] });
$<HTMLButtonElement>('btn-help-join').addEventListener('click', (ev) => help.show(ev.currentTarget as HTMLElement));
$<HTMLButtonElement>('btn-help-game').addEventListener('click', (ev) => help.show(ev.currentTarget as HTMLElement));

function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (variant) btn.className = variant;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
