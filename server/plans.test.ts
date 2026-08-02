/**
 * Tests de los planes de juego: la alternancia de roles de cada estructura, que
 * es lo que distingue un modo de otro. Se comprueban las primeras palabras, que
 * es donde se ve el patrón.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coopPlan, oneVsOnePlan, duelPlan } from './plans.js';

test('cooperativa: una pareja, roles alternos, siempre el mismo equipo', () => {
  const plan = coopPlan('A', 'B');
  assert.equal(plan.teams.length, 1);
  assert.deepEqual(plan.matchup(0), { giverId: 'A', guesserId: 'B', teamId: 'team' });
  assert.deepEqual(plan.matchup(1), { giverId: 'B', guesserId: 'A', teamId: 'team' });
  assert.deepEqual(plan.matchup(2), { giverId: 'A', guesserId: 'B', teamId: 'team' });
});

test('uno contra uno: puntúa siempre quien adivina, alternando', () => {
  const plan = oneVsOnePlan({ id: 'A', name: 'Ana' }, { id: 'B', name: 'Ben' });
  assert.equal(plan.teams.length, 2);
  // Palabra 0: adivina A (su equipo puntúa), da pistas B.
  assert.deepEqual(plan.matchup(0), { giverId: 'B', guesserId: 'A', teamId: 'A' });
  // Palabra 1: adivina B.
  assert.deepEqual(plan.matchup(1), { giverId: 'A', guesserId: 'B', teamId: 'B' });
});

test('duelo: parejas por turnos y roles alternos dentro de cada pareja', () => {
  const plan = duelPlan(['A', 'B'], ['C', 'D']);
  assert.equal(plan.teams.length, 2);
  // Pares -> pareja 1 (A,B); impares -> pareja 2 (C,D).
  assert.deepEqual(plan.matchup(0), { giverId: 'A', guesserId: 'B', teamId: 't1' });
  assert.deepEqual(plan.matchup(1), { giverId: 'C', guesserId: 'D', teamId: 't2' });
  // Segundo turno de cada pareja: se alternan sus roles internos.
  assert.deepEqual(plan.matchup(2), { giverId: 'B', guesserId: 'A', teamId: 't1' });
  assert.deepEqual(plan.matchup(3), { giverId: 'D', guesserId: 'C', teamId: 't2' });
});
