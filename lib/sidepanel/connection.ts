import { OLLAMA_HOST } from '../constants';
import { checkOllamaConnection } from '../model';

/**
 * Renders Ollama reachability into the header dot and badge.
 *
 * The same two elements exist on the options page, styled by the same
 * `.ac-status-dot` and `.ac-badge` components, so the two surfaces cannot drift
 * apart the way they did when each wrote its own classes.
 */
export class ConnectionManager {
  constructor(
    private statusDot: HTMLElement,
    private statusPill: HTMLElement
  ) {}

  public async updateStatus(hostUrl = OLLAMA_HOST): Promise<boolean> {
    const { success } = await checkOllamaConnection(hostUrl);

    if (success) {
      this.render('ok', '[ 200 OK ]');
      return true;
    }

    this.render('error', '[ OFFLINE ]');
    return false;
  }

  /**
   * Show a check in progress, before the request settles.
   */
  public setChecking(): void {
    this.render('warn', '[ CHECKING... ]');
  }

  /**
   * Both elements move together, so one method writes both rather than four
   * call sites remembering to.
   */
  private render(state: 'ok' | 'warn' | 'error', label: string): void {
    this.statusDot.className = `ac-status-dot ac-status-dot--${state}`;
    this.statusPill.className = `ac-badge ac-badge--${state}`;
    this.statusPill.textContent = label;
  }
}
