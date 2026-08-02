/**
 * Tests de la IA offline: que el bot da sus pistas preescritas una a una y que,
 * al adivinar, elige por coincidencia de pistas y no repite fallos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { botClue, botGuess } from './bot.js';
import type { Word } from './words_repo.js';

const gato: Word = {
  palabra: 'gato',
  categoria: 'animales',
  dificultad: 'facil',
  pistas: ['maullido', 'bigotes', 'ronroneo'],
  prohibidas: [],
};
const perro: Word = {
  palabra: 'perro',
  categoria: 'animales',
  dificultad: 'facil',
  pistas: ['ladrido', 'hueso', 'fiel'],
  prohibidas: [],
};
const coche: Word = {
  palabra: 'coche',
  categoria: 'transporte',
  dificultad: 'facil',
  pistas: ['ruedas', 'motor', 'conducir'],
  prohibidas: [],
};
const bank = [gato, perro, coche];

test('botClue da las pistas preescritas una a una y luego se queda sin', () => {
  assert.equal(botClue(gato, []), 'maullido');
  assert.equal(botClue(gato, ['maullido']), 'bigotes');
  assert.equal(botClue(gato, ['maullido', 'bigotes']), 'ronroneo');
  assert.equal(botClue(gato, ['maullido', 'bigotes', 'ronroneo']), null);
});

test('botGuess elige la palabra cuya pista coincide con la recibida', () => {
  // "ladrido" es pista preescrita de perro: un bot competente lo elige.
  const guess = botGuess(['ladrido'], 'animales', bank, [], 'dificil', () => 0);
  assert.equal(guess, 'perro');
});

test('botGuess no repite una palabra ya fallada', () => {
  // Aun con la pista de perro, si ya se falló "perro", elige otra cosa.
  const guess = botGuess(['ladrido'], 'animales', bank, ['perro'], 'dificil', () => 0);
  assert.notEqual(guess, 'perro');
});

test('botGuess usa la categoría cuando no hay coincidencia de pistas', () => {
  // Sin pistas útiles, prefiere una candidata de la categoría dada.
  const guess = botGuess(['xyzinventada'], 'transporte', bank, [], 'dificil', () => 0);
  assert.equal(guess, 'coche');
});

test('botGuess devuelve null si no quedan candidatas', () => {
  const guess = botGuess(['ladrido'], 'animales', bank, ['gato', 'perro', 'coche'], 'dificil', () => 0);
  assert.equal(guess, null);
});
