/**
 * Reglas del Password: validación de las pistas que da un jugador y comprobación
 * de los intentos de adivinar. Es pura (sin DOM ni red) para poder probarla a
 * fondo: una regla mal hecha aquí (aceptar una pista que canta la palabra, o
 * rechazar un acierto correcto) rompe el juego sin que salte ningún test de red.
 */

import type { ClueRule, GameConfig } from './protocol.js';

/**
 * @brief Normaliza un texto para compararlo: minúsculas, sin tildes ni signos,
 *        con los espacios sobrantes colapsados. La eñe se conserva.
 *
 * Se usa tanto para comparar aciertos ("Perú" == "peru") como para detectar si
 * una pista contiene la palabra secreta. La eñe se protege antes de quitar las
 * tildes, porque al descomponerse (NFD) es una n con tilde encima y, si no, se
 * quedaría en una simple n ("niño" pasaría a "nino").
 *
 * @param text Texto a normalizar.
 * @return Texto normalizado (puede quedar vacío si solo había signos).
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/ñ/gi, '') // protege la eñe (n + tilde combinante)
    .replace(/[̀-ͯ]/g, '') // quita el resto de marcas de acento
    .replace(//g, 'ñ') // restaura la eñe
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ') // signos fuera
    .replace(/\s+/g, ' ')
    .trim();
}

/** Separa un texto normalizado en palabras. */
function words(text: string): string[] {
  const clean = normalize(text);
  return clean ? clean.split(' ') : [];
}

/**
 * @brief Reduce una palabra a una raíz aproximada para comparar variantes.
 *
 * No es un lematizador: solo quita el plural más común del español (`-s`, `-es`)
 * para que "gatos" y "gato" se traten como la misma palabra, tanto al validar
 * pistas como al comprobar aciertos. Palabras muy cortas se dejan intactas para
 * no confundir "mes" con "me".
 *
 * @param word Palabra ya normalizada.
 * @return Raíz aproximada.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Resultado de validar una pista: válida, o inválida con su motivo. */
export type ClueValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * @brief Comprueba que una pista cumple las reglas de la partida y no delata la
 *        palabra secreta.
 *
 * Reglas comunes a los dos modos: la pista no puede contener la palabra secreta,
 * ni una variante suya (misma raíz), ni ninguna de las palabras prohibidas
 * asociadas a la palabra. Además, en modo clásico la pista debe ser una sola
 * palabra; en modo frase, hasta `config.maxClueWords`.
 *
 * @param clue Pista escrita por el jugador.
 * @param secret Palabra secreta de la ronda.
 * @param rule Regla de pista en vigor.
 * @param config Configuración de la partida (para el máximo de palabras).
 * @param forbidden Palabras adicionales prohibidas para esta palabra.
 * @return Validación con el motivo si la pista no vale.
 */
export function validateClue(
  clue: string,
  secret: string,
  rule: ClueRule,
  config: GameConfig,
  forbidden: readonly string[] = [],
): ClueValidation {
  const clueWords = words(clue);
  if (clueWords.length === 0) {
    return { ok: false, reason: 'La pista está vacía.' };
  }

  const maxWords = rule === 'classic' ? 1 : Math.max(1, config.maxClueWords);
  if (clueWords.length > maxWords) {
    return {
      ok: false,
      reason:
        rule === 'classic'
          ? 'En el modo clásico la pista debe ser una sola palabra.'
          : `La pista no puede tener más de ${maxWords} palabras.`,
    };
  }

  // Raíces prohibidas: la propia palabra secreta y las que la delatan.
  const banned = new Set<string>();
  for (const w of words(secret)) banned.add(stem(w));
  for (const f of forbidden) for (const w of words(f)) banned.add(stem(w));

  for (const w of clueWords) {
    if (banned.has(stem(w))) {
      return { ok: false, reason: 'La pista no puede contener la palabra secreta ni una variante suya.' };
    }
  }

  return { ok: true };
}

/**
 * @brief Comprueba si un intento acierta la palabra secreta.
 *
 * Compara sin distinguir mayúsculas, tildes ni signos, y tolera el plural (una
 * respuesta en plural acierta una palabra en singular y viceversa), porque al
 * oír la pista mucha gente responde con la variante que le sale.
 *
 * @param guess Intento del jugador.
 * @param secret Palabra secreta.
 * @return true si el intento se considera acierto.
 */
export function checkGuess(guess: string, secret: string): boolean {
  const g = normalize(guess);
  const s = normalize(secret);
  if (!g) return false;
  if (g === s) return true;
  // Comparación por raíz palabra a palabra, para tolerar plurales.
  const gw = g.split(' ').map(stem).join(' ');
  const sw = s.split(' ').map(stem).join(' ');
  return gw === sw;
}
