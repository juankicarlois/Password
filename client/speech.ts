/**
 * Lectura en voz alta opcional (síntesis de voz del navegador).
 *
 * Está pensada para quien juega **sin** lector de pantalla: el juego lee sus
 * propios avisos. Por eso viene **desactivada por defecto**: si estuviera activa
 * a la vez que un lector de pantalla, se oirían dos voces pisándose. La
 * preferencia se recuerda.
 *
 * Lee el mismo texto que se manda a la región aria-live, así que no hay que
 * mantener dos guiones distintos.
 */

/** Clave en localStorage para recordar si el jugador activó la lectura en voz alta. */
const ENABLED_KEY = 'password-speak';

export class Speech {
  private enabled: boolean;
  private readonly synth: SpeechSynthesis | null;

  constructor() {
    this.synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.enabled = localStorage.getItem(ENABLED_KEY) === 'true';
  }

  /** true si el navegador ofrece síntesis de voz. */
  get available(): boolean {
    return this.synth !== null;
  }

  /** true si la lectura en voz alta está activada. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * @brief Activa o desactiva la lectura y lo recuerda. Al desactivar, corta lo
   *        que se esté leyendo.
   * @return El nuevo estado (true si queda activada).
   */
  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem(ENABLED_KEY, String(this.enabled));
    if (!this.enabled) this.synth?.cancel();
    return this.enabled;
  }

  /**
   * @brief Lee un texto en voz alta, si la lectura está activada.
   *
   * Cancela lo anterior antes de hablar, igual que la región aria-live sustituye
   * su contenido: así el último aviso no queda en cola detrás de los viejos.
   *
   * @param text Texto a leer.
   */
  speak(text: string): void {
    if (!this.enabled || !this.synth || !text.trim()) return;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    this.synth.speak(utterance);
  }
}
