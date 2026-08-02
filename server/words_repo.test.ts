/**
 * Tests del banco de palabras: que se carga bien y que el reparto es una tanda
 * barajada sin repetir palabras ni salirse del tamaño pedido.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from '../shared/rules.js';
import { loadWords, shuffle, dealWords, type Word } from './words_repo.js';

test('loadWords carga el banco con la forma esperada', () => {
  const words = loadWords();
  assert.ok(words.length >= 100, 'debería haber un banco amplio');
  for (const w of words) {
    assert.equal(typeof w.palabra, 'string');
    assert.ok(w.palabra.length > 0);
    assert.equal(typeof w.categoria, 'string');
    assert.ok(Array.isArray(w.pistas));
    assert.ok(Array.isArray(w.prohibidas));
  }
});

test('el banco no tiene palabras duplicadas', () => {
  const counts = new Map<string, number>();
  for (const w of loadWords()) {
    const key = normalize(w.palabra);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicadas = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(duplicadas, [], `palabras duplicadas: ${duplicadas.join(', ')}`);
});

test('shuffle no modifica la lista original', () => {
  const original: number[] = [1, 2, 3, 4, 5];
  const copy = original.slice();
  shuffle(original, () => 0.5);
  assert.deepEqual(original, copy);
});

test('dealWords devuelve como mucho las pedidas y sin repetir', () => {
  const bank: Word[] = Array.from({ length: 8 }, (_, i) => ({
    palabra: `p${i}`,
    categoria: 'test',
    dificultad: 'facil',
    pistas: [],
    prohibidas: [],
  }));
  const dealt = dealWords(bank, 5, () => 0.3);
  assert.equal(dealt.length, 5);
  assert.equal(new Set(dealt.map((w) => w.palabra)).size, 5);
});

test('dealWords no falla si se piden más de las que hay', () => {
  const bank: Word[] = [
    { palabra: 'a', categoria: 't', dificultad: 'facil', pistas: [], prohibidas: [] },
    { palabra: 'b', categoria: 't', dificultad: 'facil', pistas: [], prohibidas: [] },
  ];
  assert.equal(dealWords(bank, 10).length, 2);
});
