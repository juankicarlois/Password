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
  type GameView,
} from '../shared/protocol.js';
import { Net } from './net.js';
import { MessageHistory, historyIndexFromKey } from './history.js';

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
}

function nameOf(playerId: string): string {
  return lastState?.players.find((p) => p.id === playerId)?.name ?? 'Alguien';
}

// --- Eventos → anuncio ------------------------------------------------------

function handleEvent(event: GameEvent): void {
  switch (event.kind) {
    case 'playerJoined':
      if (event.playerId !== myId) announce(`${event.name} se ha unido a la sala.`);
      break;
    case 'playerLeft':
      announce(`${nameOf(event.playerId)} ha salido de la sala.`);
      break;
    case 'gameStarted':
      announce('¡Empieza la partida!');
      break;
    case 'gameOver':
      announce('Fin de la partida.');
      break;
  }
}

// --- Render -----------------------------------------------------------------

function render(state: GameView): void {
  renderStatus(state);
  renderPlayers(state);
  renderConfig(state);
  renderActions(state);
}

function renderStatus(state: GameView): void {
  let text: string;
  switch (state.phase) {
    case 'lobby':
      text = `Sala ${state.roomCode}. ${state.players.length} jugador(es). Esperando para empezar.`;
      break;
    case 'playing':
      text = 'Partida en curso.';
      break;
    case 'gameOver':
      text = 'Fin de la partida.';
      break;
  }
  statusLine.textContent = text;
}

function renderPlayers(state: GameView): void {
  playersTitle.textContent = 'Jugadores';
  playersList.replaceChildren();
  const soyAnfitrion = state.hostId != null && state.hostId === myId;

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

    if (!player.connected && !player.isBot) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = 'desconectado';
      li.append(meta);
    }

    // El anfitrión puede quitar bots durante el vestíbulo.
    if (player.isBot && soyAnfitrion && state.phase === 'lobby') {
      const remove = button('Quitar', () => net.send({ type: 'removeBot', playerId: player.id }), 'secondary');
      remove.setAttribute('aria-label', `Quitar ${player.name}`);
      li.append(remove);
    }

    playersList.append(li);
  }
}

/**
 * Panel de configuración de la partida. Solo el anfitrión lo edita; a los demás
 * se les muestra la configuración elegida en texto, para que sepan a qué van a
 * jugar. Se oculta fuera del vestíbulo (la configuración no cambia a media
 * partida).
 */
function renderConfig(state: GameView): void {
  configSection.hidden = state.phase !== 'lobby';
  if (state.phase !== 'lobby') return;

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
    choiceRow<GameStructure>('Estructura', state.config.structure, [
      { id: 'coop', label: 'Cooperativa' },
      { id: 'duel', label: 'Duelo de parejas' },
      { id: 'oneVsOne', label: 'Uno contra uno' },
    ], (structure) => net.send({ type: 'setConfig', config: { structure } })),
    choiceRow<GameEnding>('Fin de partida', state.config.ending, [
      { id: 'wordCount', label: 'Tanda de palabras' },
      { id: 'timed', label: 'Contrarreloj' },
    ], (ending) => net.send({ type: 'setConfig', config: { ending } })),
  );
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
      actions.append(bots);

      const startBtn = button('Empezar partida', () => net.send({ type: 'start' }));
      startBtn.id = 'start-game';
      startBtn.disabled = state.players.length < 2;
      if (startBtn.disabled) startBtn.title = 'Hacen falta al menos dos participantes.';
      actions.append(startBtn);
      focusTarget = startBtn;
    }
  } else if (state.phase === 'playing') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'La partida está en marcha. El juego de pistas se añade en la siguiente fase del desarrollo.';
    actions.append(hint);
  } else if (state.phase === 'gameOver') {
    if (soyAnfitrion) {
      const again = button('Jugar otra vez', () => net.send({ type: 'start' }));
      again.id = 'play-again';
      actions.append(again);
      focusTarget = again;
    }
  }

  manageFocus(state, focusTarget, focusedId);
}

/**
 * Mueve el foco al mando principal solo cuando cambia el conjunto de acciones,
 * para no robar el foco en cada actualización de estado.
 */
function manageFocus(state: GameView, target: HTMLElement | null, previousFocusId: string): void {
  const key = [state.phase, state.players.length, state.hostId ?? ''].join('|');
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

function button(label: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (variant) btn.className = variant;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
