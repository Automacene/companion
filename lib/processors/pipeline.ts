import type { PostProcessor, RawDOMPayload, ProcessedResult } from './types';
import { RawProcessor } from './rawProcessor';

export class ProcessingPipeline {
  private processors = new Map<string, PostProcessor>();

  constructor() {
    // Register baseline default processor
    this.register(new RawProcessor());
  }

  register(processor: PostProcessor): void {
    this.processors.set(processor.name, processor);
  }

  async run(processorName: string, payload: RawDOMPayload): Promise<ProcessedResult> {
    const processor = this.processors.get(processorName);
    if (!processor) {
      throw new Error(`Processor '${processorName}' is not registered in the pipeline.`);
    }
    return await processor.process(payload);
  }
}

export const defaultPipeline = new ProcessingPipeline();