/**
 * Planes de juego: traducen la estructura elegida (cooperativa, uno contra uno,
 * duelo de parejas) en el reparto de roles palabra a palabra que consume el
 * motor. Son funciones puras, fáciles de probar, para que la alternancia de
 * turnos —lo más delicado de cada modo— quede verificada.
 */

import type { PlayPlan } from './engine.js';

/**
 * @brief Plan cooperativo: una pareja comparte marcador; en cada palabra uno da
 *        pistas y el otro adivina, y se alternan.
 * @param a Primer miembro.
 * @param b Segundo miembro.
 * @param teamName Nombre del equipo.
 */
export function coopPlan(a: string, b: string, teamName = 'Equipo'): PlayPlan {
  return {
    teams: [{ id: 'team', name: teamName, memberIds: [a, b] }],
    matchup: (i) => ({
      giverId: i % 2 === 0 ? a : b,
      guesserId: i % 2 === 0 ? b : a,
      teamId: 'team',
    }),
  };
}

/**
 * @brief Plan uno contra uno: dos jugadores, cada uno su marcador. En cada
 *        palabra uno da pistas y el otro adivina, y se alternan; puntúa quien
 *        adivina (el id del jugador hace de id de su equipo).
 * @param a Primer jugador (id y nombre).
 * @param b Segundo jugador (id y nombre).
 */
export function oneVsOnePlan(
  a: { id: string; name: string },
  b: { id: string; name: string },
): PlayPlan {
  return {
    teams: [
      { id: a.id, name: a.name, memberIds: [a.id] },
      { id: b.id, name: b.name, memberIds: [b.id] },
    ],
    matchup: (i) => {
      // En cada palabra adivina uno; el otro da las pistas. Puntúa quien adivina.
      const guesser = i % 2 === 0 ? a : b;
      const giver = i % 2 === 0 ? b : a;
      return { giverId: giver.id, guesserId: guesser.id, teamId: guesser.id };
    },
  };
}

/**
 * @brief Plan de duelo de parejas: dos parejas juegan por turnos (una palabra
 *        cada una, alternando). Dentro de cada pareja se alternan dador y
 *        adivinador entre sus turnos. Cada pareja tiene su marcador.
 * @param team1 Los dos miembros de la pareja 1.
 * @param team2 Los dos miembros de la pareja 2.
 */
export function duelPlan(
  team1: [string, string],
  team2: [string, string],
  names: { team1: string; team2: string } = { team1: 'Equipo 1', team2: 'Equipo 2' },
): PlayPlan {
  const teams = [
    { id: 't1', name: names.team1, memberIds: [...team1] },
    { id: 't2', name: names.team2, memberIds: [...team2] },
  ];
  return {
    teams,
    matchup: (i) => {
      // Las palabras pares las juega la pareja 1; las impares, la pareja 2.
      const team = i % 2 === 0 ? teams[0] : teams[1];
      // Cuántas palabras ha jugado ya esta pareja, para alternar sus roles.
      const turns = Math.floor(i / 2);
      return {
        giverId: team.memberIds[turns % 2],
        guesserId: team.memberIds[(turns + 1) % 2],
        teamId: team.id,
      };
    },
  };
}
