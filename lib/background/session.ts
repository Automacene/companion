import { VercelConversation } from '../conversation';
import type { ExtensionSettings } from '../../types/state';

/**
 * Manages the lifecycle of tab-specific AI conversations in memory.
 * Ensures each browser tab maintains its own isolated message history 
 * and configuration settings.
 */
export class SessionManager {
  private tabSessions = new Map<number, VercelConversation>();

  /**
   * Retrieves an existing conversation session for a tab, or creates a new one
   * pre-configured with the latest extension settings.
   */
  public getSession(tabId: number, settings?: Partial<ExtensionSettings>): VercelConversation {
    let conversation = this.tabSessions.get(tabId);

    if (!conversation) {
      conversation = new VercelConversation();
      if (settings) {
        this.applySettingsToConversation(conversation, settings);
      }
      this.tabSessions.set(tabId, conversation);
    }

    return conversation;
  }

  /**
   * Cleans up memory when a tab is closed.
   */
  public removeSession(tabId: number): void {
    this.tabSessions.delete(tabId);
  }

  /**
   * Checks if a session currently exists for a given tab.
   */
  public hasSession(tabId: number): boolean {
    return this.tabSessions.has(tabId);
  }

  /**
   * Clears the message history of a specific tab without deleting the session.
   */
  public clearSessionHistory(tabId: number): void {
    const conversation = this.tabSessions.get(tabId);
    if (conversation) {
      conversation.clear();
    }
  }

  /**
   * Broadcasts updated extension settings (system prompt, host, active model)
   * to all active in-memory conversation sessions.
   */
  public applySettingsToAll(settings: Partial<ExtensionSettings>): void {
    for (const conversation of this.tabSessions.values()) {
      this.applySettingsToConversation(conversation, settings);
    }
  }

  /**
   * Helper to safely update systemic conversation parameters.
   */
  private applySettingsToConversation(
    conversation: VercelConversation,
    settings: Partial<ExtensionSettings>
  ): void {
    if (settings.systemPrompt) {
      conversation.updateSystemPrompt(settings.systemPrompt);
    }
    if (settings.ollamaHost || settings.activeModel) {
      conversation.updateConfig(settings.ollamaHost, settings.activeModel);
    }
  }
}