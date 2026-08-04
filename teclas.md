# Teclas y controles

Controles de teclado del Password accesible, por contexto. El juego se maneja con
controles estándar de página web, pensados para funcionar con lector de pantalla:
**no hay atajos de una sola letra**, para no chocar con la navegación rápida de los
lectores. Los únicos atajos propios usan `Alt`, que el lector no intercepta.

## En cualquier pantalla

| Tecla | Acción |
|-------|--------|
| `Tab` / `Mayús+Tab` | Moverse al siguiente / anterior control (botón o campo). |
| `Intro` o `Espacio` | Activar el botón que tiene el foco. |
| `Intro` (en un campo de texto) | Enviar el formulario (entrar en la sala, enviar pista, adivinar). |
| `Alt+1` … `Alt+9`, `Alt+0` | Repetir un aviso reciente: `Alt+1` el último, … `Alt+0` el décimo. |

## Vestíbulo (entrar y configurar)

Todo son campos y botones: código de sala, nombre, «Entrar en la sala»,
«Cómo se juega», «Tema» y, para quien crea la sala, los botones de configuración
(reglas de pista, estructura, fin, número de palabras o duración), «Añadir bot»,
«Quitar» y «Empezar partida». En el modo **duelo de parejas** aparecen además los
botones «Equipo 1» / «Equipo 2» para asignar la pareja de cada jugador o bot. Se
recorren con `Tab` y se activan con `Intro` o `Espacio`.

## En partida

| Control | Acción |
|---------|--------|
| Campo «Tu pista» + «Enviar pista» | El que da pistas escribe una pista y la envía (`Intro` o el botón). |
| Campo «Tu respuesta» + «Adivinar» | El que adivina escribe su intento y lo envía. |
| «Pasar palabra» | Salta la palabra actual (no puntúa). |
| «Silenciar sonidos» / «Activar sonidos» | Quita o pone los efectos de sonido. |
| «Leer en voz alta» / «No leer en voz alta» | Activa o desactiva que el juego lea los avisos (para quien juega sin lector de pantalla). |
| «Tema: automático / claro / oscuro» | Cambia el aspecto. Cada pulsación pasa al siguiente: automático (el del sistema), claro, oscuro. |
| «Repasar la ronda» | Dice tu palabra secreta (si eres quien da las pistas), la categoría, todas las pistas dadas y lo ya probado sin acertar. |
| «Cuánto tiempo queda» | Solo en contrarreloj: dice en voz alta el tiempo restante. |
| «Cómo se juega» | Abre el manual. |

## Manual de ayuda

| Tecla | Acción |
|-------|--------|
| `Tab` / `Mayús+Tab` | Recorrer el contenido y los botones «Volver». |
| Navegación por encabezados del lector | Saltar entre las secciones del manual. |
| `Escape` | Cerrar el manual y volver. |
| Botón «Volver» (al principio y al final) | Cerrar el manual y volver. |

## Solapamientos a tener en cuenta

- No hay atajos de una sola tecla, así que no compiten con la navegación rápida del
  lector de pantalla (teclas como `B`, `H`, `1`… siguen siendo del lector).
- Los atajos propios llevan siempre `Alt` (`Alt`+número), que el lector no captura,
  de modo que funcionan tanto en modo foco como en modo exploración y también
  mientras se escribe en un campo.
