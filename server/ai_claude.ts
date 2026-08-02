/**
 * Proveedor de IA opcional basado en la API de Claude. Si hay una clave de API
 * configurada (`ANTHROPIC_API_KEY`), el bot puede dar pistas y adivinar con un
 * modelo de lenguaje, más natural y variado que el modo offline. Sin clave, este
 * módulo no se activa y la sala usa la IA offline (`bot.ts`).
 *
 * Todo error (sin conexión, respuesta rara, límite de la API) se traga y se
 * devuelve null: la sala interpreta el null como "no sé" y recurre al modo
 * offline, de modo que la partida nunca se queda bloqueada por la API.
 */

import type { ClueRule } from '../shared/protocol.js';

/** Fuente de pistas y respuestas de la IA. */
export interface AiProvider {
  /**
   * @brief Genera una pista para una palabra, respetando la regla en vigor.
   * @return La pista, o null si no se pudo obtener una válida.
   */
  clue(
    word: string,
    category: string,
    cluesGiven: readonly string[],
    rule: ClueRule,
    maxWords: number,
  ): Promise<string | null>;

  /**
   * @brief Propone una palabra a partir de las pistas recibidas.
   * @return La palabra propuesta, o null si no se pudo obtener.
   */
  guess(clues: readonly string[], category: string): Promise<string | null>;
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * @brief Crea el proveedor de Claude si hay clave de API; si no, null.
 *
 * El modelo se puede fijar con `PASSWORD_AI_MODEL`; por defecto usa un modelo
 * rápido y económico, suficiente para un bot de juego.
 *
 * @return El proveedor, o null si no hay `ANTHROPIC_API_KEY`.
 */
export function createClaudeProvider(): AiProvider | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.PASSWORD_AI_MODEL ?? DEFAULT_MODEL;
  return new ClaudeProvider(apiKey, model);
}

class ClaudeProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async clue(
    word: string,
    category: string,
    cluesGiven: readonly string[],
    rule: ClueRule,
    maxWords: number,
  ): Promise<string | null> {
    const limite =
      rule === 'classic'
        ? 'Responde con UNA sola palabra.'
        : `Responde con como mucho ${maxWords} palabras.`;
    const previas = cluesGiven.length
      ? `Ya has dado estas pistas, no las repitas: ${cluesGiven.join(', ')}.`
      : '';
    const prompt =
      `Juegas al Password en español. La palabra secreta es "${word}" (categoría: ${category}). ` +
      `Da una pista para que otra persona la adivine, sin decir la palabra secreta ni ninguna ` +
      `variante o derivado suyo. ${limite} ${previas} Responde solo con la pista, sin explicaciones.`;
    const text = await this.ask(prompt);
    return text ? firstWords(text, rule === 'classic' ? 1 : maxWords) : null;
  }

  async guess(clues: readonly string[], category: string): Promise<string | null> {
    const prompt =
      `Juegas al Password en español. Te dan pistas para adivinar una palabra ` +
      `(categoría: ${category}). Pistas, en orden: ${clues.join(', ')}. ` +
      `Responde solo con tu mejor palabra, sin explicaciones.`;
    const text = await this.ask(prompt);
    return text ? firstWords(text, 3) : null;
  }

  /** Llama a la API y devuelve el texto de la respuesta, o null si algo falla. */
  private async ask(prompt: string): Promise<string | null> {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 32,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = data.content?.find((c) => c.type === 'text')?.text;
      return text?.trim() ?? null;
    } catch {
      return null;
    }
  }
}

/** Recorta la respuesta del modelo a las primeras `n` palabras, sin signos. */
function firstWords(text: string, n: number): string | null {
  const words = text
    .replace(/["“”'`.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, n).join(' ');
}
