/**
 * Tests del historial de avisos.
 *
 * Lo importante aquí no es solo que se recuerden los últimos diez, sino que la
 * versión hablada y la escrita **no se mezclen**: si `recall` devolviera el
 * texto íntegro para la voz del juego, repetir un aviso con Alt+número cantaría
 * por los altavoces la palabra secreta que el aviso original se calló.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageHistory, HISTORY_SIZE, historyIndexFromKey, plain } from './history.js';

test('recall devuelve el aviso pedido, numerado', () => {
  const history = new MessageHistory();
  history.record('Primero.');
  history.record('Segundo.');

  assert.equal(history.recall(1).text, 'Mensaje 1. Segundo.');
  assert.equal(history.recall(2).text, 'Mensaje 2. Primero.');
});

test('sin versión hablada, se habla el mismo texto', () => {
  const history = new MessageHistory();
  history.record('Pista: piscina.');

  const aviso = history.recall(1);
  assert.equal(aviso.spoken, aviso.text);
});

test('la versión hablada no arrastra lo que el aviso escondía', () => {
  const history = new MessageHistory();
  history.record('Tu palabra secreta: natación.', 'Tu palabra secreta está en la pantalla.');

  const aviso = history.recall(1);
  assert.match(aviso.text, /natación/);
  assert.doesNotMatch(aviso.spoken, /natación/);
  assert.equal(aviso.spoken, 'Mensaje 1. Tu palabra secreta está en la pantalla.');
});

test('solo se guardan los últimos HISTORY_SIZE avisos', () => {
  const history = new MessageHistory();
  for (let i = 1; i <= HISTORY_SIZE + 3; i++) history.record(`Aviso ${i}.`);

  assert.equal(history.size, HISTORY_SIZE);
  assert.equal(history.recall(1).text, `Mensaje 1. Aviso ${HISTORY_SIZE + 3}.`);
  assert.equal(history.recall(HISTORY_SIZE).text, `Mensaje ${HISTORY_SIZE}. Aviso 4.`);
});

test('los avisos vacíos no ocupan sitio', () => {
  const history = new MessageHistory();
  history.record('   ');
  assert.equal(history.size, 0);
});

test('pedir un aviso que no existe explica por qué, en ambas versiones', () => {
  const history = new MessageHistory();
  const vacio = history.recall(1);
  assert.equal(vacio.text, 'Todavía no hay mensajes.');
  assert.equal(vacio.spoken, vacio.text);

  history.record('Uno.');
  assert.equal(history.recall(3).text, 'No hay mensaje 3. Solo hay 1 mensaje.');
  assert.equal(history.recall(99).text, 'No hay ningún mensaje con ese número.');
});

test('plain deja el aviso igual por escrito y hablado', () => {
  assert.deepEqual(plain('Sin secretos.'), { text: 'Sin secretos.', spoken: 'Sin secretos.' });
});

test('el 0 es el décimo aviso y las teclas no numéricas se ignoran', () => {
  assert.equal(historyIndexFromKey('1'), 1);
  assert.equal(historyIndexFromKey('0'), HISTORY_SIZE);
  // Con Alt, algunos teclados mandan un símbolo en `key`: manda la tecla física.
  assert.equal(historyIndexFromKey('¡', 'Digit1'), 1);
  assert.equal(historyIndexFromKey('a'), null);
});
