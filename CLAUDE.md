# Password accesible

Juego del **Password**: un jugador da pistas de una palabra secreta y otro la
adivina. **Accesible con lectores de pantalla** (NVDA/JAWS/VoiceOver) y jugable
también por videntes. Web: servidor Node + TypeScript con WebSocket (`server/`),
cliente TypeScript + DOM plano (`client/`), tipos y reglas compartidos
(`shared/`), banco de palabras en JSON (`content/`). Se juega en solitario contra
la IA o en red (salas por código). Diseño en `docs/DISENO.md`; puesta en marcha y
controles en `README.md`.

## Accesibilidad — reglas OBLIGATORIAS

Están heredadas del proyecto hermano de trivial, ya probadas con lector real. No
se rebajan sin motivo:

- **Todo lo jugable se anuncia por voz.** Los cambios importantes van a una región
  `aria-live` (`#announce`); la repetición a demanda (Alt+número) a otra región
  aparte (`#history`) para que no se pisen. Nada del juego depende de ver la
  pantalla.
- **Botones, no teclas sueltas**, para las acciones. Los lectores en modo
  exploración capturan las letras sueltas como navegación rápida y no llegarían a
  la página. Los atajos solo con **Alt+tecla** (Alt no lo intercepta el lector).
- **HTML semántico**: encabezados para navegar, `role="group"` con etiqueta en los
  grupos de botones, `role="alert"` en errores, `.sr-only` para texto solo-lector,
  `aria-hidden` en lo puramente decorativo, `skip-link` al principio.
- **Estado privado por rol.** La palabra secreta es privada del jugador que da
  pistas: viaja en un mensaje aparte (`secret`), nunca en la vista pública.
- **Nada de TTS propio activado por defecto** (pelearía con el lector). El toggle
  "leer en voz alta" es opcional y para quien juega SIN lector.

Antes de dar algo por terminado, **verifícalo de verdad** (tests + prueba real en
el navegador con el árbol de accesibilidad), no solo que compile.

## Estilo de código

- C++/TS moderno, claro y documentado. Prohibido nombres con versión/fase
  (`v0`, `new`, `old`, `final`, `2`…): el nombre describe la responsabilidad.
- Doxygen/JSDoc en todo lo público: `@brief`, `@param`, `@return` y condiciones
  especiales. No hace falta en getters triviales.
- Cada capa en su sitio: el servidor es la fuente de verdad; el cliente pinta y
  manda intenciones. Las reglas puras (`shared/rules.ts`) van con tests.

## Flujo de trabajo

Nunca se commitea directo a `main`: rama con prefijo semántico (`feat/`, `fix/`,
`chore/`, `docs/`, `refactor/`) + PR + squash-merge.

## Comandos

- `npm run dev` — compila el cliente y arranca el servidor en el puerto 3000.
- `npm run typecheck` — comprobación de tipos (sin emitir).
- `npm test` — tests de la lógica pura (reglas, motor, etc.).
- `npm run build:client` / `npm run watch:client` — empaquetado del cliente con esbuild.
