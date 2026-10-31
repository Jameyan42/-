import { AI_SYSTEM_PROMPT } from './ai-prompt';
import { localDemoAnalysis } from './ai-demo';
import { AnalysisFailure, validateAIOutput, failureMessages } from './ai-output';
import type { Analysis, AIContext, AIConfig, AIOutput, DemoFault } from './ai-types';
export type ServiceAdapter = {
    provider: string;
    analyze: (request: Readonly<{
        systemPrompt: string;
        context: AIContext;
        config: AIConfig;
    }>, signal: AbortSignal) => Promise<unknown>;
};
export type Completion = {
    analysisStatus: 'COMPLETED' | 'FAILED';
    structuredResult: AIOutput | null;
    errorCode: string | null;
    durationMs: number | null;
};
export function localDemoAdapter(fault: DemoFault = 'NONE'): ServiceAdapter {
    return { provider: 'LOCAL_DEMO', analyze: async ({ context, config }, signal) => {
            if (fault === 'TIMEOUT')
                return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new AnalysisFailure('CANCELLED')), { once: true }); });
            await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 50); signal.addEventListener('abort', () => { clearTimeout(timer); reject(new AnalysisFailure('CANCELLED')); }, { once: true }); });
            if (fault === 'UNAVAILABLE')
                throw new AnalysisFailure('SERVICE_UNAVAILABLE');
            if (fault === 'INVALID_JSON')
                return '{not JSON';
            const result = localDemoAnalysis(context, config);
            if (fault === 'UNSUPPORTED_ACTION')
                return { ...result, tool_calls: [{ action: 'approve_claim' }] };
            if (fault === 'INVALID_EVIDENCE')
                return { ...result, ruleExplanation: { ...result.ruleExplanation, summary: '根据公司第12条制度需要驳回。', evidenceRefs: ['policy.COMPANY-12'] } };
            if (fault === 'UNSUPPORTED_NUMBER')
                return { ...result, summary: '本次分析准确率99.99%。' };
            return result;
        } };
}
export function unavailableRealAdapter(): ServiceAdapter { return { provider: 'NOT_CONFIGURED', analyze: async () => { throw new AnalysisFailure('REAL_NOT_CONFIGURED'); } }; }
// No fetch, environment values, filesystem, SDK, or financial operations are available to the adapter.
export async function executeAIService(record: Analysis, adapter = localDemoAdapter(record.fault), outerSignal?: AbortSignal): Promise<Completion> {
    const started = performance.now(), controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, abortListener: (() => void) | undefined;
    try {
        if (outerSignal?.aborted)
            throw new AnalysisFailure('CANCELLED');
        if (record.analysisStatus !== 'RUNNING')
            throw new AnalysisFailure('OUTPUT_SCHEMA');
        if (adapter.provider !== 'LOCAL_DEMO')
            throw new AnalysisFailure('REAL_NOT_CONFIGURED');
        const deadline = new Promise<never>((_res, reject) => { timer = setTimeout(() => { reject(new AnalysisFailure('TIMEOUT')); controller.abort(); }, record.config.config.timeoutMs); });
        const cancelled = new Promise<never>((_res, reject) => { abortListener = () => { reject(new AnalysisFailure('CANCELLED')); controller.abort(); }; if (outerSignal?.aborted)
            abortListener();
        else
            outerSignal?.addEventListener('abort', abortListener, { once: true }); });
        const raw = await Promise.race([adapter.analyze({ systemPrompt: AI_SYSTEM_PROMPT, context: structuredClone(record.context), config: structuredClone(record.config.config) }, controller.signal), deadline, cancelled]);
        return { analysisStatus: 'COMPLETED', structuredResult: validateAIOutput(raw, record.context, record.config.config), errorCode: null, durationMs: Math.max(0, Math.round(performance.now() - started)) };
    }
    catch (err) {
        return { analysisStatus: 'FAILED', structuredResult: null, errorCode: err instanceof AnalysisFailure && Object.hasOwn(failureMessages, err.code) ? err.code : 'SERVICE_UNAVAILABLE', durationMs: Math.max(0, Math.round(performance.now() - started)) };
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (abortListener)
            outerSignal?.removeEventListener('abort', abortListener);
        controller.abort();
    }
}
