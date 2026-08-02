/**
 * Motor de sonido del cliente: reproduce efectos cortos en los momentos clave
 * (acierto, fallo, pista nueva, fin de partida…).
 *
 * Regla de accesibilidad: los sonidos son un **apoyo**, no la vía principal. Todo
 * lo importante se anuncia por voz en la región aria-live; los efectos solo la
 * acompañan. Por eso son breves y suenan a volumen moderado, para no tapar al
 * lector de pantalla, y se pueden silenciar (la preferencia se recuerda).
 *
 * Los efectos proceden de la librería general de Sound Ideas (Series 2000),
 * recortados a un cue corto por evento (ver docs).
 */

/** Nombre lógico de cada efecto; coincide con su fichero en `sounds/`. */
export type SoundName =
  | 'correct'
  | 'wrong'
  | 'clue'
  | 'round'
  | 'start'
  | 'gameover'
  | 'timeup'
  | 'warn'
  | 'join';

const FILES: Record<SoundName, string> = {
  correct: 'sounds/correct.mp3',
  wrong: 'sounds/wrong.mp3',
  clue: 'sounds/clue.mp3',
  round: 'sounds/round.mp3',
  start: 'sounds/start.mp3',
  gameover: 'sounds/gameover.mp3',
  timeup: 'sounds/timeup.mp3',
  warn: 'sounds/warn.mp3',
  join: 'sounds/join.mp3',
};

/** Clave en localStorage para recordar si el jugador silenció los sonidos. */
const MUTED_KEY = 'password-muted';
/** Volumen general, por debajo del máximo para no competir con la voz. */
const VOLUME = 0.45;

export class SoundEngine {
  /** Un elemento de audio precargado por efecto; se clona para poder solaparlos. */
  private readonly sources = new Map<SoundName, HTMLAudioElement>();
  private muted: boolean;

  constructor() {
    this.muted = localStorage.getItem(MUTED_KEY) === 'true';
    for (const [name, file] of Object.entries(FILES) as [SoundName, string][]) {
      const audio = new Audio(file);
      audio.preload = 'auto';
      audio.volume = VOLUME;
      this.sources.set(name, audio);
    }
  }

  /** true si los sonidos están silenciados. */
  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * @brief Cambia el estado de silencio y lo recuerda.
   * @return El nuevo estado (true si queda silenciado).
   */
  toggleMuted(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(MUTED_KEY, String(this.muted));
    return this.muted;
  }

  /**
   * @brief Reproduce un efecto, salvo que esté silenciado.
   *
   * Se clona el elemento precargado para que dos efectos seguidos (o el mismo
   * repetido) puedan solaparse sin cortarse. Un fallo de reproducción (política
   * de autoplay antes del primer clic) se ignora en silencio.
   *
   * @param name Efecto a reproducir.
   */
  play(name: SoundName): void {
    if (this.muted) return;
    const base = this.sources.get(name);
    if (!base) return;
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = VOLUME;
    void node.play().catch(() => {
      /* autoplay bloqueado hasta el primer gesto del usuario: se ignora */
    });
  }
}
