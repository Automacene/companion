import { OLLAMA_HOST } from '../constants';
import { checkOllamaConnection } from '../model';

export class ConnectionManager {
  constructor(
    private statusDot: HTMLElement,
    private statusPill: HTMLElement
  ) {}

  public async updateStatus(hostUrl = OLLAMA_HOST): Promise<boolean> {
    const { success } = await checkOllamaConnection(hostUrl);

    if (success) {
      this.statusDot.className = 'status-indicator-dot connected';
      this.statusPill.className = 'status-badge connected';
      this.statusPill.innerText = '[ 200 OK ]';
      return true;
    }

    this.statusDot.className = 'status-indicator-dot error';
    this.statusPill.className = 'status-badge error';
    this.statusPill.innerText = '[ OFFLINE ]';
    return false;
  }
}