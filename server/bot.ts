/**
 * IA del juego en modo offline (sin conexión ni API): decide la pista que da un
 * bot y la palabra que arriesga cuando adivina. Son funciones **puras** para
 * poder probarlas; la sala es quien las llama con un retardo para que el bot no
 * responda instantáneamente.
 *
 * Cuando da pistas, el bot usa las pistas preescritas de la palabra (una por
 * turno). Cuando adivina, puntúa las palabras del banco según cuántas de las
 * pistas recibidas coinciden con las pistas preescritas de cada candidata: es
 * una heurística limitada (con pistas humanas inventadas puede fallar), pero
 * permite jugar en solitario sin depender de una API.
 */

import type { BotDifficulty } from '../shared/protocol.js';
import { normalize, stem } from '../shared/rules.js';
import type { Word } from './words_repo.js';

/** Conjunto de raíces de un texto, para comparar por palabras sin plurales. */
function stems(text: string): Set<string> {
  const clean = normalize(text);
  if (!clean) return new Set();
  return new Set(clean.split(' ').map(stem));
}

/**
 * @brief Elige la siguiente pista que dará el bot, de las preescritas de la
 *        palabra, saltando las que ya se han dado.
 *
 * @param word Palabra secreta con sus pistas preescritas.
 * @param cluesGiven Pistas ya dadas en esta ronda.
 * @return La pista a dar, o null si no quedan (el bot pasará de palabra).
 */
export function botClue(word: Word, cluesGiven: readonly string[]): string | null {
  const used = new Set(cluesGiven.map((c) => normalize(c)));
  for (const pista of word.pistas) {
    if (!used.has(normalize(pista))) return pista;
  }
  return null;
}

/** Probabilidad de que el bot acierte con su mejor candidata, por dificultad. */
const SKILL: Record<BotDifficulty, number> = { facil: 0.45, media: 0.75, dificil: 1 };

/**
 * @brief Elige la palabra que el bot arriesga a partir de las pistas recibidas.
 *
 * Puntúa cada palabra del banco por las pistas que comparte (misma raíz) con sus
 * pistas preescritas, más un punto si coincide la categoría. Descarta las que ya
 * ha fallado. Según la dificultad, a veces arriesga una candidata peor (los bots
 * fáciles fallan más). Devuelve null solo si no hay ninguna candidata posible.
 *
 * @param clues Pistas recibidas hasta ahora.
 * @param category Categoría de la palabra (pista de contexto).
 * @param bank Banco de palabras entre las que elegir.
 * @param wrongGuesses Palabras ya falladas, para no repetirlas.
 * @param difficulty Dificultad del bot.
 * @param random Fuente de aleatoriedad, inyectable para los tests.
 * @return La palabra a arriesgar, o null si no queda ninguna.
 */
export function botGuess(
  clues: readonly string[],
  category: string,
  bank: readonly Word[],
  wrongGuesses: readonly string[],
  difficulty: BotDifficulty,
  random: () => number = Math.random,
): string | null {
  const clueStems = new Set<string>();
  for (const clue of clues) for (const s of stems(clue)) clueStems.add(s);

  const failed = new Set(wrongGuesses.map((g) => normalize(g)));
  const candidates = bank.filter((w) => !failed.has(normalize(w.palabra)));
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((w) => {
      const pistaStems = new Set<string>();
      for (const p of w.pistas) for (const s of stems(p)) pistaStems.add(s);
      let score = 0;
      for (const s of clueStems) if (pistaStems.has(s)) score += 2;
      if (w.categoria === category) score += 1;
      return { word: w, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // Bot competente (o suerte): arriesga la mejor candidata. Si no, simula un
  // fallo eligiendo una candidata al azar (los bots fáciles aciertan menos).
  if (random() <= SKILL[difficulty]) return best.word.palabra;
  const alt = scored[Math.floor(random() * scored.length)] ?? best;
  return alt.word.palabra;
}
