/**
 * Tests del motor de partida. Cubren el ciclo completo de una ronda cooperativa:
 * dar pista, adivinar, puntuar, pasar de palabra, alternar roles y terminar con
 * el resumen. Se usa un emisor de mentira para leer lo que el motor mandaría a la
 * red, incluida la palabra secreta que solo recibe el dador.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameConfig, GameEvent, GameSummaryView } from '../shared/protocol.js';
import { DEFAULT_CONFIG } from '../shared/protocol.js';
import { GameEngine, pointsForClues, type EngineEmitter } from './engine.js';
import type { Word } from './words_repo.js';

class FakeEmitter implements EngineEmitter {
  events: GameEvent[] = [];
  secrets = new Map<string, string | null>();
  rejected: { playerId: string; reason: string }[] = [];
  summary: GameSummaryView | null = null;
  stateChanges = 0;
  stateChanged(): void {
    this.stateChanges++;
  }
  event(e: GameEvent): void {
    this.events.push(e);
  }
  secret(playerId: string, word: string | null): void {
    this.secrets.set(playerId, word);
  }
  clueRejected(playerId: string, reason: string): void {
    this.rejected.push({ playerId, reason });
  }
  finished(summary: GameSummaryView): void {
    this.summary = summary;
  }
}

function bank(...palabras: string[]): Word[] {
  return palabras.map((palabra) => ({
    palabra,
    categoria: 'test',
    dificultad: 'facil' as const,
    pistas: [],
    prohibidas: [],
  }));
}

/** Configuración de dos palabras, clásica, para los tests. */
const config: GameConfig = { ...DEFAULT_CONFIG, clueRule: 'classic', wordCount: 2 };

/** El random fijo hace el reparto determinista. */
const fixedRandom = () => 0;

test('pointsForClues premia acertar con menos pistas y nunca baja de 1', () => {
  assert.equal(pointsForClues(1), 5);
  assert.equal(pointsForClues(3), 3);
  assert.equal(pointsForClues(10), 1);
});

test('ronda completa: pista válida, acierto, puntúa y pasa de palabra', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(['A', 'B'], config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  // El dador es A; recibe la palabra en privado, B no la ve.
  const word0 = fe.secrets.get('A');
  assert.ok(typeof word0 === 'string' && word0.length > 0);
  assert.equal(fe.secrets.get('B'), null);

  engine.submitClue('A', 'animal');
  assert.equal(engine.roundView()?.waitingFor, 'guesser');
  assert.ok(fe.events.some((e) => e.kind === 'clueGiven'));

  engine.submitGuess('B', word0 as string);
  assert.ok(fe.events.some((e) => e.kind === 'wordSolved'));

  // Segunda palabra: los roles se alternan (ahora da pistas B).
  const round2 = engine.roundView();
  assert.equal(round2?.giverId, 'B');
  assert.equal(round2?.guesserId, 'A');
  assert.equal(fe.secrets.get('A'), null);
  const word1 = fe.secrets.get('B') as string;

  engine.submitClue('B', 'objeto');
  engine.submitGuess('A', word1);

  // Dos aciertos a la primera pista: 5 + 5 puntos, media de 1 pista.
  assert.ok(engine.isFinished);
  assert.deepEqual(fe.summary, { solved: 2, played: 2, points: 10, avgClues: 1 });
});

test('una pista que canta la palabra se rechaza en privado y no avanza', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(['A', 'B'], config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();
  const secret = fe.secrets.get('A') as string;

  engine.submitClue('A', secret);
  assert.equal(fe.rejected.length, 1);
  assert.equal(engine.roundView()?.waitingFor, 'giver');
  assert.ok(!fe.events.some((e) => e.kind === 'clueGiven'));
});

test('un fallo devuelve la vez al dador para otra pista', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(['A', 'B'], config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  engine.submitClue('A', 'animal');
  engine.submitGuess('B', 'zzzznoexiste');
  const round = engine.roundView();
  assert.equal(round?.waitingFor, 'giver');
  assert.equal(round?.guesses.length, 1);
  assert.equal(round?.guesses[0]?.correct, false);
});

test('pasar salta la palabra sin puntuar', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(['A', 'B'], config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  engine.pass('A');
  assert.ok(fe.events.some((e) => e.kind === 'wordSkipped'));
  assert.equal(engine.scoreView().solved, 0);
  assert.equal(engine.scoreView().played, 1);
});

test('solo el dador da pistas y solo el adivinador adivina', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(['A', 'B'], config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  // B es el adivinador: no puede dar pistas.
  engine.submitClue('B', 'animal');
  assert.ok(!fe.events.some((e) => e.kind === 'clueGiven'));

  // A es el dador: no puede adivinar.
  engine.submitGuess('A', 'gato');
  assert.ok(!fe.events.some((e) => e.kind === 'guessMade'));
});
