/**
 * Tests del motor de partida. Cubren el ciclo de una ronda (dar pista, adivinar,
 * puntuar, pasar, alternar roles, terminar con el resumen) y que el marcador va
 * al equipo correcto según el plan (cooperativa y uno contra uno). Se usa un
 * emisor de mentira para leer lo que el motor mandaría a la red, incluida la
 * palabra secreta que solo recibe el dador.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameConfig, GameEvent, GameSummaryView } from '../shared/protocol.js';
import { DEFAULT_CONFIG } from '../shared/protocol.js';
import { GameEngine, pointsForClues, type EngineEmitter } from './engine.js';
import { coopPlan, oneVsOnePlan } from './plans.js';
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
/** Configuración por tiempo (contrarreloj). */
const timedConfig: GameConfig = { ...DEFAULT_CONFIG, ending: 'timed', durationSeconds: 120 };
/** El random fijo hace el reparto determinista. */
const fixedRandom = () => 0;

test('pointsForClues premia acertar con menos pistas y nunca baja de 1', () => {
  assert.equal(pointsForClues(1), 5);
  assert.equal(pointsForClues(3), 3);
  assert.equal(pointsForClues(10), 1);
});

test('cooperativa: pista válida, acierto, puntúa y alterna roles', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(coopPlan('A', 'B'), config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  // El dador es A; recibe la palabra en privado, B no la ve.
  const word0 = fe.secrets.get('A');
  assert.ok(typeof word0 === 'string' && word0.length > 0);
  assert.equal(fe.secrets.get('B'), null);

  engine.submitClue('A', 'animal');
  assert.equal(engine.roundView()?.waitingFor, 'guesser');
  engine.submitGuess('B', word0 as string);
  assert.ok(fe.events.some((e) => e.kind === 'wordSolved'));

  // Segunda palabra: los roles se alternan (ahora da pistas B).
  const round2 = engine.roundView();
  assert.equal(round2?.giverId, 'B');
  assert.equal(round2?.guesserId, 'A');
  const word1 = fe.secrets.get('B') as string;
  engine.submitClue('B', 'objeto');
  engine.submitGuess('A', word1);

  assert.ok(engine.isFinished);
  // Un solo equipo, dos aciertos a la primera pista: 10 puntos, sin ganador.
  assert.equal(fe.summary?.teams.length, 1);
  assert.equal(fe.summary?.teams[0].points, 10);
  assert.equal(fe.summary?.teams[0].solved, 2);
  assert.equal(fe.summary?.played, 2);
  assert.equal(fe.summary?.avgClues, 1);
  assert.equal(fe.summary?.winnerTeamId, null);
});

test('una pista que canta la palabra se rechaza en privado y no avanza', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(coopPlan('A', 'B'), config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();
  const secret = fe.secrets.get('A') as string;

  engine.submitClue('A', secret);
  assert.equal(fe.rejected.length, 1);
  assert.equal(engine.roundView()?.waitingFor, 'giver');
  assert.ok(!fe.events.some((e) => e.kind === 'clueGiven'));
});

test('un fallo devuelve la vez al dador para otra pista', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(coopPlan('A', 'B'), config, bank('gato', 'perro'), fe, fixedRandom);
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
  const engine = new GameEngine(coopPlan('A', 'B'), config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  engine.pass('A');
  assert.ok(fe.events.some((e) => e.kind === 'wordSkipped'));
  const score = engine.scoreViews()[0];
  assert.equal(score.solved, 0);
  assert.equal(score.played, 1);
});

test('contrarreloj: sin número fijo de palabras y termina al agotarse el tiempo', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(coopPlan('A', 'B'), timedConfig, bank('gato', 'perro', 'coche'), fe, fixedRandom);
  engine.start();
  assert.equal(engine.roundView()?.total, 0);
  assert.ok(engine.deadline && engine.deadline > Date.now());
  engine.timeUp();
  assert.ok(engine.isFinished);
  assert.ok(fe.summary);
});

test('solo el dador da pistas y solo el adivinador adivina', () => {
  const fe = new FakeEmitter();
  const engine = new GameEngine(coopPlan('A', 'B'), config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  engine.submitClue('B', 'animal'); // B es adivinador: no puede dar pistas
  assert.ok(!fe.events.some((e) => e.kind === 'clueGiven'));
  engine.submitGuess('A', 'gato'); // A es dador: no puede adivinar
  assert.ok(!fe.events.some((e) => e.kind === 'guessMade'));
});

test('uno contra uno: puntúa quien adivina, y gana quien más suma', () => {
  const fe = new FakeEmitter();
  const plan = oneVsOnePlan({ id: 'A', name: 'Ana' }, { id: 'B', name: 'Ben' });
  const engine = new GameEngine(plan, config, bank('gato', 'perro'), fe, fixedRandom);
  engine.start();

  // Palabra 1: adivina A (da pistas B). El equipo que puntúa es el de A.
  const round0 = engine.roundView();
  assert.equal(round0?.guesserId, 'A');
  assert.equal(round0?.giverId, 'B');
  assert.equal(round0?.teamId, 'A');
  const word0 = fe.secrets.get('B') as string; // el dador es B
  engine.submitClue('B', 'animal');
  engine.submitGuess('A', word0);

  // Palabra 2: ahora adivina B; pasa la palabra para que A quede por delante.
  const round1 = engine.roundView();
  assert.equal(round1?.guesserId, 'B');
  engine.pass('B');

  assert.ok(engine.isFinished);
  const teamA = fe.summary?.teams.find((t) => t.id === 'A');
  const teamB = fe.summary?.teams.find((t) => t.id === 'B');
  assert.equal(teamA?.points, 5);
  assert.equal(teamB?.points, 0);
  assert.equal(fe.summary?.winnerTeamId, 'A');
});
