import type { PageSource, PostProcessor, ProcessedResult } from './types';
import { RawProcessor } from './rawProcessor';
import { BasicProcessor } from './basicProcessor';

/**
 * The registry of processors.
 *
 * Registering a name twice replaces the first, which is deliberate so an addon
 * can override a built-in. It is also how `raw` used to disappear: it named
 * itself `'basic'` through a constant, and registering `BasicProcessor`
 * afterwards overwrote it. Both now name themselves directly.
 */
export class ProcessingPipeline {
  private processors = new Map<string, PostProcessor>();

  constructor() {
    this.register(new RawProcessor());
    this.register(new BasicProcessor());
  }

  register(processor: PostProcessor): void {
    this.processors.set(processor.name, processor);
  }

  /** Every registered processor, for a picker. */
  list(): { name: string; description: string }[] {
    return [...this.processors.values()].map(({ name, description }) => ({ name, description }));
  }

  has(name: string): boolean {
    return this.processors.has(name);
  }

  async run(name: string, source: PageSource): Promise<ProcessedResult> {
    const processor = this.processors.get(name);
    if (!processor) {
      throw new Error(
        `[processors] '${name}' is not registered. Have: ${[...this.processors.keys()].join(', ')}`
      );
    }
    return processor.process(source);
  }
}

export const defaultPipeline = new ProcessingPipeline();
