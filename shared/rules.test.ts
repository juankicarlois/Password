/**
 * Tests de las reglas del Password. Cubren lo que rompe el juego si falla: que
 * una pista no delate la palabra, que se respete el número de palabras y que un
 * acierto correcto (con o sin tilde, singular o plural) se dé por bueno.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG, type GameConfig } from './protocol.js';
import { normalize, stem, validateClue, checkGuess } from './rules.js';

const classic: GameConfig = { ...DEFAULT_CONFIG, clueRule: 'classic' };
const phrase: GameConfig = { ...DEFAULT_CONFIG, clueRule: 'phrase', maxClueWords: 3 };

test('normalize quita tildes, signos y mayúsculas', () => {
  assert.equal(normalize('  ¡Perú! '), 'peru');
  assert.equal(normalize('Camión, rápido'), 'camion rapido');
  assert.equal(normalize('niño'), 'niño');
});

test('stem quita plurales comunes pero respeta palabras cortas', () => {
  assert.equal(stem('gatos'), 'gato');
  assert.equal(stem('flores'), 'flor');
  assert.equal(stem('mes'), 'mes');
});

test('modo clásico: la pista debe ser una sola palabra', () => {
  assert.equal(validateClue('animal', 'perro', 'classic', classic).ok, true);
  const dos = validateClue('animal peludo', 'perro', 'classic', classic);
  assert.equal(dos.ok, false);
});

test('modo frase: se permite hasta el máximo de palabras', () => {
  assert.equal(validateClue('animal muy peludo', 'perro', 'phrase', phrase).ok, true);
  const cuatro = validateClue('animal muy peludo casero', 'perro', 'phrase', phrase);
  assert.equal(cuatro.ok, false);
});

test('una pista no puede contener la palabra secreta ni una variante', () => {
  assert.equal(validateClue('perro', 'perro', 'classic', classic).ok, false);
  assert.equal(validateClue('perros', 'perro', 'phrase', phrase).ok, false);
});

test('las palabras prohibidas también invalidan la pista', () => {
  const res = validateClue('ladrido', 'perro', 'classic', classic, ['ladrido', 'guau']);
  assert.equal(res.ok, false);
});

test('checkGuess acepta tildes, mayúsculas y plurales', () => {
  assert.equal(checkGuess('Perú', 'peru'), true);
  assert.equal(checkGuess('gatos', 'gato'), true);
  assert.equal(checkGuess('gato', 'gatos'), true);
  assert.equal(checkGuess('perro', 'gato'), false);
  assert.equal(checkGuess('', 'gato'), false);
});
