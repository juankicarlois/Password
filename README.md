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

Luego abre `http://localhost:3100` en el navegador. Para que otra persona de tu
red local entre, comparte la dirección `http://TU-IP-LOCAL:3100` (el servidor la
imprime al arrancar) y usad el mismo código de sala.

> El password usa el puerto **3100**; el proyecto de trivial usa el **3000**. Así
> puedes tener los dos abiertos a la vez sin que se confundan.

### Jugar por internet (túnel accesible)

Para jugar con alguien que no está en tu red, se abre un **túnel de Cloudflare**
que da una URL pública temporal. Requiere `cloudflared` instalado una sola vez:

```bash
winget install Cloudflare.cloudflared
```

Con el servidor levantado (`npm run dev`), en otra terminal:

```bash
npm run tunnel
```

El túnel imprime **solo la URL** en una línea limpia (pensado para lector de
pantalla) y la **copia al portapapeles**: pégala (Ctrl+V) a quien vaya a jugar,
que la abra y entre con tu mismo código de sala. Ctrl+C cierra el túnel.

### Lanzadores rápidos (Windows)

En `scripts/` hay dos accesos directos que hacen todo lo anterior de una vez:

- **`jugar-local.bat`** — arranca el servidor y abre el juego en el navegador.
- **`jugar-online.bat`** — arranca el servidor y el túnel, cada uno en su ventana;
  la ventana del túnel muestra y copia la URL para compartir.

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
