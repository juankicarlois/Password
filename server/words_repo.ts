/**
 * Carga y reparto del banco de palabras. Las palabras viven en `content/` como
 * ficheros JSON (`words.<pack>.json`); aquí se leen todas y se barajan para
 * repartir la tanda de una partida.
 *
 * Cada palabra trae, además de su categoría y dificultad, unas pistas de una
 * sola palabra (que usa la IA cuando da pistas) y unas palabras prohibidas que
 * la delatarían (que refuerzan la validación de las pistas humanas).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { BotDifficulty } from '../shared/protocol.js';

/** Una palabra del banco con todo lo necesario para jugarla. */
export interface Word {
  palabra: string;
  categoria: string;
  dificultad: BotDifficulty;
  /** Pistas de una sola palabra, para la IA que da pistas. */
  pistas: string[];
  /** Palabras que delatan la secreta y no valen como pista. */
  prohibidas: string[];
}

/** Forma del fichero de un pack de palabras. */
interface WordPackFile {
  id: string;
  nombre: string;
  palabras: Word[];
}

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTENT_DIR = join(here, '..', 'content');

/**
 * @brief Carga todas las palabras de los packs disponibles.
 *
 * @param contentDir Carpeta con los `words.*.json` (por defecto, `content/`).
 * @return Lista de todas las palabras encontradas.
 * @throws Si un fichero no es un JSON válido con la forma esperada.
 */
export function loadWords(contentDir: string = DEFAULT_CONTENT_DIR): Word[] {
  const files = readdirSync(contentDir).filter(
    (name) => name.startsWith('words.') && name.endsWith('.json'),
  );
  const words: Word[] = [];
  for (const file of files) {
    const raw = readFileSync(join(contentDir, file), 'utf-8');
    const pack = JSON.parse(raw) as WordPackFile;
    for (const w of pack.palabras) {
      words.push({
        palabra: w.palabra,
        categoria: w.categoria,
        dificultad: w.dificultad,
        pistas: w.pistas ?? [],
        prohibidas: w.prohibidas ?? [],
      });
    }
  }
  return words;
}

/**
 * @brief Baraja una copia de la lista (Fisher-Yates) sin tocar la original.
 *
 * @param items Lista a barajar.
 * @param random Fuente de aleatoriedad en [0,1); inyectable para los tests.
 * @return Copia barajada.
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * @brief Reparte una tanda de palabras barajadas.
 *
 * Si se piden más palabras de las que hay, devuelve todas las que haya (una tanda
 * más corta es preferible a repetir palabras en la misma partida).
 *
 * @param words Banco del que repartir.
 * @param count Cuántas palabras se quieren.
 * @param random Fuente de aleatoriedad, inyectable para los tests.
 * @return Palabras barajadas, como mucho `count`.
 */
export function dealWords(words: readonly Word[], count: number, random: () => number = Math.random): Word[] {
  return shuffle(words, random).slice(0, Math.max(0, count));
}
