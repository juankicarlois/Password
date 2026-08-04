/**
 * Tema visual: claro, oscuro o automático (el del sistema operativo).
 *
 * Por defecto va en **automático**, que es lo que respeta la preferencia que el
 * jugador ya tiene configurada en su equipo. El interruptor existe para quien
 * quiere forzar uno concreto: hay gente con baja visión que necesita el claro
 * aunque su sistema esté en oscuro, y al revés. La elección se recuerda.
 *
 * El tema se aplica poniendo `data-theme` en el elemento raíz; el CSS hace el
 * resto. En automático se quita el atributo para que mande `prefers-color-scheme`.
 */

/** Temas posibles, en el orden en que los recorre el botón. */
export const THEMES = ['auto', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/** Clave en localStorage para recordar el tema elegido. */
const THEME_KEY = 'password-theme';

/** Nombre de cada tema tal y como se le dice al jugador. */
const LABELS: Record<Theme, string> = {
  auto: 'automático',
  light: 'claro',
  dark: 'oscuro',
};

/** true si el valor guardado es un tema conocido. */
function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

export class ThemeSwitcher {
  private theme: Theme;

  constructor() {
    const saved = localStorage.getItem(THEME_KEY);
    this.theme = isTheme(saved) ? saved : 'auto';
    this.apply();
  }

  /** Tema activo ahora mismo. */
  get current(): Theme {
    return this.theme;
  }

  /** Nombre del tema activo, para decírselo al jugador. */
  get label(): string {
    return LABELS[this.theme];
  }

  /**
   * @brief Pasa al siguiente tema del ciclo (automático, claro, oscuro), lo
   *        aplica y lo recuerda.
   * @return El tema que queda activo.
   */
  next(): Theme {
    const index = THEMES.indexOf(this.theme);
    this.theme = THEMES[(index + 1) % THEMES.length];
    localStorage.setItem(THEME_KEY, this.theme);
    this.apply();
    return this.theme;
  }

  /** Vuelca el tema al documento para que el CSS lo recoja. */
  private apply(): void {
    const root = document.documentElement;
    // En automático no se fija nada: manda la preferencia del sistema.
    if (this.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.theme);
  }
}
