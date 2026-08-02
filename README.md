# Password accesible

Juego del **Password** pensado para jugarse **escuchando**, con lector de pantalla
(NVDA, JAWS, VoiceOver), aunque también se ve. Un jugador da pistas de una palabra
secreta y otro intenta adivinarla. Se puede jugar en solitario contra la IA o en
red con otras personas (salas por código).

> Estado: **en desarrollo**. Ahora mismo funciona el vestíbulo (crear/unirse a
> sala, añadir bots, configurar la partida y empezar). El juego de pistas se está
> construyendo por fases; ver `docs/` y el plan de desarrollo.

## Puesta en marcha

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run dev
```

Luego abre `http://localhost:3000` en el navegador. Para que otra persona de tu
red local entre, comparte la dirección `http://TU-IP-LOCAL:3000` (el servidor la
imprime al arrancar) y usad el mismo código de sala.

## Cómo se juega (resumen)

1. **Entra en una sala**: escribe un código (invéntalo y compártelo) y tu nombre.
   Quien use el mismo código juega contigo. ¿Sin nadie? Entra igual y añade bots.
2. **Configura la partida** (lo hace quien creó la sala):
   - **Reglas de pista**: clásica (una sola palabra) o frase corta.
   - **Estructura**: cooperativa, duelo de parejas o uno contra uno.
   - **Fin**: tanda de palabras o contrarreloj.
3. **Empieza** cuando estéis. Uno da pistas de la palabra secreta y otro adivina.

## Accesibilidad

- Todo lo importante se anuncia por voz en una región `aria-live`.
- Con **Alt + número** (Alt+1 el último, Alt+0 el décimo) repites un aviso que se
  te haya pasado.
- Las acciones son **botones** (funcionan con el lector en modo exploración); los
  atajos usan siempre **Alt** para no chocar con la navegación rápida del lector.

## Estructura del proyecto

- `server/` — servidor Node + WebSocket, salas y lógica de partida.
- `client/` — cliente TypeScript + DOM plano, empaquetado con esbuild.
- `shared/` — protocolo y reglas del juego, compartidos y con tests.
- `content/` — banco de palabras con sus pistas.
- `public/` — HTML, CSS y el bundle del cliente.

## Desarrollo

- `npm run typecheck` — tipos.
- `npm test` — tests de la lógica pura.
- `npm run dev` — desarrollo (build del cliente + servidor).
